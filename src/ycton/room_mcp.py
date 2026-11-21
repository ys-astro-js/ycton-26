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


async def _serve() -> None:
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

        @server.tool()
        async def send(text: str) -> str:
            """Post a message to the current room as the current agent."""
            try:
                response = await client.post(
                    "/api/agent/messages",
                    json={"room_id": room_id, "participant_id": participant_id, "text": text},
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise ToolError(f"Room API rejected the message (HTTP {error.response.status_code}).") from None
            except httpx.RequestError:
                raise ToolError("Could not confirm delivery to the room API.") from None
            return "Message sent."

        await server.run_stdio_async()


if __name__ == "__main__":
    asyncio.run(_serve())
