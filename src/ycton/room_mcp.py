"""Expose the room send tool over MCP stdio."""

import asyncio
import os
import sys

import httpx
from acp.schema import EnvVariable, McpServerStdio
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError

_API_URL = "YCTON_ROOM_API_URL"
_TOKEN = "YCTON_AGENT_TOKEN"
_ROOM_ID = "YCTON_ROOM_ID"
_PARTICIPANT_ID = "YCTON_PARTICIPANT_ID"
ROOM_MCP_NAME = "room"
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


def build_room_server(client: httpx.AsyncClient, *, room_id: str, participant_id: str) -> FastMCP:
    """테스트와 stdio에서 같은 MCP 도구 구현을 사용한다."""
    server = FastMCP("room")
    actor = {"room_id": room_id, "participant_id": participant_id}

    async def post(path, **fields):
        try:
            response = await client.post(path, json={**actor, **fields})
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            raise ToolError(f"Room API rejected the request (HTTP {error.response.status_code}).") from None
        except httpx.RequestError:
            raise ToolError("Could not confirm delivery to the room API.") from None
        return response

    @server.tool()
    async def send(text: str) -> str:
        """Post a message to this room as this authenticated agent."""
        await post("/api/agent/messages", text=text)
        return "Message sent."

    @server.tool()
    async def list_tasks() -> dict:
        """Read tasks and agents in this room before choosing work."""
        return (await post("/api/agent/tasks/list")).json()

    @server.tool()
    async def claim(task_id: str) -> dict:
        """Atomically claim an open task. A conflict means it was not assigned to you."""
        return (await post("/api/agent/tasks/claim", task_id=task_id)).json()

    @server.tool()
    async def delegate(task_id: str, request_id: str, instructions: str = "") -> dict:
        """Queue your claimed task. Reuse request_id only when retrying this identical request."""
        return (await post("/api/agent/tasks/delegate", task_id=task_id,
                           request_id=request_id, instructions=instructions)).json()

    return server


async def _serve() -> None:
    origin = httpx.URL(os.environ[_API_URL])
    if origin.scheme != "http" or origin.host != "127.0.0.1" or origin.userinfo or origin.raw_path != b"/" or origin.fragment:
        raise ValueError("Room API URL must be an HTTP origin on 127.0.0.1")
    async with httpx.AsyncClient(
        base_url=origin, headers={"Authorization": f"Bearer {os.environ[_TOKEN]}"}, trust_env=False
    ) as client:
        server = build_room_server(client, room_id=os.environ[_ROOM_ID], participant_id=os.environ[_PARTICIPANT_ID])
        await server.run_stdio_async()


if __name__ == "__main__":
    asyncio.run(_serve())
