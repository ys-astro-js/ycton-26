"""Expose authenticated room tools over MCP stdio."""

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
ROOM_WORK_TOOLS = ("send",)
ROOM_CHAT_TOOLS = (*ROOM_WORK_TOOLS, "claim", "delegate")
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


def room_mcp_for_work(server: McpServerStdio) -> McpServerStdio:
    return server.model_copy(update={"args": [*_STDIO_ARGS, "--work"]})


async def _serve(*, work: bool) -> None:
    origin = httpx.URL(os.environ[_API_URL])
    if origin.scheme != "http" or origin.host != "127.0.0.1" or origin.userinfo or origin.raw_path != b"/" or origin.fragment:
        raise ValueError("Room API URL must be an HTTP origin on 127.0.0.1")

    token = os.environ[_TOKEN]
    room_id = os.environ[_ROOM_ID]
    participant_id = os.environ[_PARTICIPANT_ID]
    server = FastMCP("room")
    async with httpx.AsyncClient(
        base_url=origin, headers={"Authorization": f"Bearer {token}"}, trust_env=False
    ) as client:

        async def post(path: str, payload: dict[str, str | int], *, operation: str) -> None:
            try:
                response = await client.post(
                    path, json={"room_id": room_id, "participant_id": participant_id, **payload}
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise ToolError(f"Room API rejected {operation} (HTTP {error.response.status_code}).") from None
            except httpx.RequestError:
                raise ToolError(f"Could not confirm {operation} with the room API.") from None

        @server.tool()
        async def send(text: str) -> str:
            """Post a message to the current room as the current agent."""
            await post("/api/agent/messages", {"text": text}, operation="the message")
            return "Message sent."

        if not work:
            @server.tool()
            async def claim(task_id: int) -> str:
                """Take ownership of an open task by its numeric ID in the current room."""
                await post("/api/agent/tasks/claim", {"task_id": task_id}, operation="the claim")
                return "Task claimed."

            @server.tool()
            async def delegate(task_id: int, instructions: str) -> str:
                """Queue a work session for a task you already claimed. Does not wait for the work to finish."""
                await post(
                    "/api/agent/tasks/delegate", {"task_id": task_id, "instructions": instructions},
                    operation="the delegation",
                )
                return "Work session queued."

        await server.run_stdio_async()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--work", action="store_true")
    asyncio.run(_serve(work=parser.parse_args().work))
