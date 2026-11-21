"""Expose the room tools over MCP stdio: chat turns talk and assign, work sessions commit."""

import asyncio
import os
import sys
from argparse import ArgumentParser

import httpx
from acp.schema import EnvVariable, McpServerStdio
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError

_API_URL = "YCTON_ROOM_API_URL"
_TOKEN = "YCTON_AGENT_TOKEN"
_ROOM_ID = "YCTON_ROOM_ID"
_PARTICIPANT_ID = "YCTON_PARTICIPANT_ID"
ROOM_MCP_NAME = "room"
ROOM_WORK_TOOLS = ("commit", "no_changes", "ask_human")
ROOM_CHAT_TOOLS = ("send", "ask_human", "list_tasks", "create_task", "merge_to_project", "claim", "delegate")
_STDIO_ARGS = ("-I", "-m", "ycton.room_mcp")


def room_mcp_server(*, api_url: str, token: str, room_id: str, participant_id: str) -> McpServerStdio:
    """Build the MCP entry for one authenticated room participant."""
    return McpServerStdio(
        name=ROOM_MCP_NAME,
        command=sys.executable,
        args=list(_STDIO_ARGS),
        env=[
            EnvVariable(name=_API_URL, value=api_url),
            EnvVariable(name=_TOKEN, value=token),
            EnvVariable(name=_ROOM_ID, value=room_id),
            EnvVariable(name=_PARTICIPANT_ID, value=participant_id),
        ],
    )


def is_room_mcp_server(server: McpServerStdio) -> bool:
    return server.name == ROOM_MCP_NAME and server.command == sys.executable and tuple(server.args) == _STDIO_ARGS


def build_room_server(client: httpx.AsyncClient, *, room_id: str, participant_id: str, work: bool = False) -> FastMCP:
    """테스트와 stdio에서 같은 MCP 도구 구현을 사용한다."""
    server = FastMCP("room")
    actor = {"room_id": room_id, "participant_id": participant_id}

    async def post(path, **fields):
        try:
            response = await client.post(path, json={**actor, **fields})
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            # 거절 이유(예: 커밋할 변경 없음)를 알아야 에이전트가 고쳐서 다시 시도할 수 있다.
            try:
                detail = error.response.json().get("detail")
            except ValueError:
                detail = None
            reason = f": {detail[:500]}" if isinstance(detail, str) else ""
            raise ToolError(f"Room API rejected the request (HTTP {error.response.status_code}){reason}.") from None
        except httpx.RequestError:
            raise ToolError("Could not confirm delivery to the room API.") from None
        return response

    if work:
        @server.tool()
        async def commit(paths: list[str], message: str) -> dict:
            """Commit only the listed files (paths relative to the worktree root) with this message.

            Other changes, staged or not, stay uncommitted. Returns the new commit hash.
            """
            return (await post("/api/agent/commit", paths=paths, message=message)).json()

        @server.tool()
        async def no_changes(reason: str) -> dict:
            """Finish a task that by its nature needs no file changes, such as a review, with the findings.

            Never use it to report that you could not do the task; then end without committing so the task fails.
            Leave the worktree without uncommitted edits.
            """
            return (await post("/api/agent/no-changes", reason=reason)).json()

        @server.tool()
        async def ask_human(question: str) -> str:
            """Ask the person for one decision this task found but cannot make. At most 200 characters.

            Call it once per decision, with the options and your recommendation in the question itself;
            the question goes to the person's review list. Then finish the task as usual.
            """
            await post("/api/agent/questions", question=question)
            return "Question sent."

        return server

    @server.tool()
    async def send(text: str) -> str:
        """Post a message to this room as this authenticated agent.

        Write @name to wake another agent in the room; only the agents you name take a turn.
        """
        await post("/api/agent/messages", text=text)
        return "Message sent."

    @server.tool()
    async def ask_human(question: str) -> str:
        """Ask the person for a decision or answer. Write one summarized question of at most 200 characters.

        Post any background with send first; the question itself is what the person sees in their review list.
        """
        await post("/api/agent/questions", question=question)
        return "Question sent."

    @server.tool()
    async def list_tasks() -> dict:
        """Read tasks and agents in this room before choosing work."""
        return (await post("/api/agent/tasks/list")).json()

    @server.tool()
    async def create_task(title: str, detail: str = "", after: str | int | None = None) -> dict:
        """Register a task. Jev then picks its owner and verification.

        Pass after=<task id> when this task must wait for that task to finish, for example an implementation
        step after its plan, a review after the work, or another change to the same files as a running task.
        """
        return (await post("/api/agent/tasks/create", title=title, detail=detail, after=after)).json()

    @server.tool()
    async def merge_to_project() -> dict:
        """Merge this room's results branch (ycton/room-<id>) into the project's checked-out branch, such as main.

        Apply finished work only when the room is not paused, all tasks are done or dropped, and no question
        still needs a human answer. If the server refuses because the room is not ready, wait for its state
        to change. On a Git conflict, the server reports the conflicting files.
        """
        return (await post("/api/agent/merge")).json()

    @server.tool()
    async def claim(task_id: str | int) -> dict:
        """Atomically claim an open task. A conflict means it was not assigned to you."""
        return (await post("/api/agent/tasks/claim", task_id=task_id)).json()

    @server.tool()
    async def delegate(task_id: str | int, instructions: str = "", request_id: str | None = None) -> dict:
        """Queue your claimed task. Reuse request_id only when retrying this identical request."""
        return (await post("/api/agent/tasks/delegate", task_id=task_id,
                           request_id=request_id, instructions=instructions)).json()

    return server


def room_mcp_for_work(server: McpServerStdio) -> McpServerStdio:
    return server.model_copy(update={"args": [*_STDIO_ARGS, "--work"]})


async def _serve(*, work: bool = False) -> None:
    origin = httpx.URL(os.environ[_API_URL])
    if origin.scheme != "http" or origin.host != "127.0.0.1" or origin.userinfo or origin.raw_path != b"/" or origin.fragment:
        raise ValueError("Room API URL must be an HTTP origin on 127.0.0.1")
    async with httpx.AsyncClient(
        base_url=origin, headers={"Authorization": f"Bearer {os.environ[_TOKEN]}"}, trust_env=False
    ) as client:
        server = build_room_server(client, room_id=os.environ[_ROOM_ID], participant_id=os.environ[_PARTICIPANT_ID], work=work)
        await server.run_stdio_async()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--work", action="store_true")
    asyncio.run(_serve(work=parser.parse_args().work))
