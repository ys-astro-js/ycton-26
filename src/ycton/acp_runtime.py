"""Run one ACP turn in a fresh local process."""

import argparse
import asyncio
import os
import sys
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from acp import PROTOCOL_VERSION, Client, RequestError, connect_to_agent
from acp.schema import (
    AgentMessageChunk,
    AllowedOutcome,
    DeniedOutcome,
    McpServerStdio,
    PermissionOption,
    RequestPermissionResponse,
    SessionNotification,
    StopReason,
    TextContentBlock,
    ToolCallUpdate,
    ToolCallProgress,
    ToolCallStart,
)

from .agent_process import spawn_owned_agent
from .room_mcp import ROOM_CHAT_TOOLS, ROOM_MCP_NAME, ROOM_WORK_TOOLS, is_room_mcp_server, room_mcp_for_work


@dataclass(frozen=True, slots=True)
class SessionResult:
    session_id: str
    stop_reason: StopReason
    text: str


class _SessionClient(Client):
    def __init__(self, on_update: Callable[[SessionNotification], None] | None, *, room_tools: tuple[str, ...]) -> None:
        self.on_update = on_update
        self.text_parts: list[str] = []
        self.last_message_id: str | None = None
        self.last_message_offset = 0
        self.room_tools = room_tools
        self._pending_room_calls: set[tuple[str, str]] = set()

    async def session_update(self, session_id: str, update: Any, **kwargs: Any) -> None:
        if isinstance(update, AgentMessageChunk) and isinstance(update.content, TextContentBlock):
            if update.message_id is not None and update.message_id != self.last_message_id:
                self.last_message_id = update.message_id
                self.last_message_offset = len(self.text_parts)
            self.text_parts.append(update.content.text)
        if self.room_tools and isinstance(update, ToolCallStart):
            tool = update.raw_input
            if (
                update.field_meta
                and update.field_meta.get("is_mcp_tool_call") is True
                and isinstance(tool, dict)
                and tool.get("server") == ROOM_MCP_NAME
                and tool.get("tool") in self.room_tools
            ):
                self._pending_room_calls.add((session_id, update.tool_call_id))
        elif isinstance(update, ToolCallProgress) and update.status in ("completed", "failed"):
            self._pending_room_calls.discard((session_id, update.tool_call_id))
        if self.on_update is not None:
            self.on_update(SessionNotification(session_id=session_id, update=update))

    async def request_permission(
        self, session_id: str, tool_call: ToolCallUpdate, options: list[PermissionOption], **kwargs: Any
    ) -> RequestPermissionResponse:
        # Codex ACP links the approval to the preceding MCP tool call by ID.
        key = (session_id, tool_call.tool_call_id)
        if kwargs.get("is_mcp_tool_approval") is True and key in self._pending_room_calls:
            self._pending_room_calls.remove(key)
            for option in options:
                if option.kind == "allow_once":
                    return RequestPermissionResponse(outcome=AllowedOutcome(option_id=option.option_id))
        return RequestPermissionResponse(outcome=DeniedOutcome())


async def run_session(
    executable: str,
    *args: str,
    cwd: Path,
    prompt: str,
    timeout: float = 600,
    mcp_servers: list[McpServerStdio] | None = None,
    on_update: Callable[[SessionNotification], None] | None = None,
    config: dict[str, str] | None = None,
) -> SessionResult:
    """Run one chat prompt, then shut down the adapter before returning.

    The optional observer runs inside the ACP receive loop and must not block.
    A timed-out turn raises TimeoutError; launch and protocol errors propagate.
    """
    return await _run_session(
        executable, *args, cwd=cwd, prompt=prompt, timeout=timeout,
        mcp_servers=mcp_servers, on_update=on_update, work=False, config=config,
    )


async def describe_session(executable: str, *args: str, cwd: Path, timeout: float = 60) -> dict[str, dict[str, str]]:
    """Open a read-only session without a prompt and report each config option's values and display names.

    Returns {category: {value: name}}, e.g. {"model": {"opus": "Opus 5.5"}}.
    """
    env = {**os.environ, "INITIAL_AGENT_MODE": "read-only"}
    async with spawn_owned_agent(executable, *args, cwd=cwd.resolve(), env=env) as process:
        assert process.stdin is not None and process.stdout is not None
        connection = connect_to_agent(_SessionClient(None, room_tools=()), process.stdin, process.stdout)
        try:
            async with asyncio.timeout(timeout):
                await connection.initialize(protocol_version=PROTOCOL_VERSION)
                session = await connection.new_session(cwd=str(cwd.resolve()), mcp_servers=[])
        finally:
            with suppress(TimeoutError):
                async with asyncio.timeout(2):
                    await connection.close()
    described = {}
    for option in getattr(session, "config_options", None) or []:
        category = getattr(option, "category", None)
        if not category:
            continue
        names = {}
        for item in getattr(option, "options", None) or []:
            for value in getattr(item, "options", None) or [item]:
                names[value.value] = getattr(value, "name", None) or value.value
        described[category] = names
    return described


def _select_values(option: Any) -> set[str]:
    values = set()
    for item in getattr(option, "options", None) or []:
        for value in getattr(item, "options", None) or [item]:
            values.add(value.value)
    return values


async def apply_session_config(connection: Any, session: Any, config: dict[str, str]) -> None:
    """Set each requested value on the session option of the same ACP category.

    Fails instead of silently running on the adapter's default when the adapter
    does not offer that option or value.
    """
    options = getattr(session, "config_options", None) or []
    for category, value in config.items():
        option = next((o for o in options if getattr(o, "category", None) == category), None)
        if option is None:
            raise RuntimeError(f"ACP adapter offers no {category} option")
        if value not in _select_values(option):
            raise RuntimeError(f"ACP adapter does not offer {category} {value!r}")
        await connection.set_config_option(config_id=option.id, session_id=session.session_id, value=value)


async def _run_session(
    executable: str,
    *args: str,
    cwd: Path,
    prompt: str,
    timeout: float,
    mcp_servers: list[McpServerStdio] | None,
    on_update: Callable[[SessionNotification], None] | None,
    work: bool,
    config: dict[str, str] | None = None,
) -> SessionResult:
    workdir = cwd.resolve()
    servers = mcp_servers or []
    room_servers = [server for server in servers if server.name == ROOM_MCP_NAME]
    room_tools = ()
    if len(room_servers) == 1 and is_room_mcp_server(room_servers[0]):
        room_tools = ROOM_WORK_TOOLS if work else ROOM_CHAT_TOOLS
    if work:
        servers = [room_mcp_for_work(server) if is_room_mcp_server(server) else server for server in servers]
    client = _SessionClient(on_update, room_tools=room_tools)
    env = {**os.environ, "INITIAL_AGENT_MODE": "workspace-write"} if work else {**os.environ, "INITIAL_AGENT_MODE": "read-only"}
    async with spawn_owned_agent(executable, *args, cwd=workdir, env=env) as process:
        assert process.stdin is not None and process.stdout is not None
        connection = connect_to_agent(client, process.stdin, process.stdout)
        session_id = None
        try:
            async with asyncio.timeout(timeout):
                initialized = await connection.initialize(protocol_version=PROTOCOL_VERSION)
                if initialized.protocol_version != PROTOCOL_VERSION:
                    raise RuntimeError(f"Unsupported ACP protocol version: {initialized.protocol_version}")
                session = await connection.new_session(cwd=str(workdir), mcp_servers=servers)
                session_id = session.session_id
                if config:
                    await apply_session_config(connection, session, config)
                response = await connection.prompt(session_id=session_id, prompt=[TextContentBlock(text=prompt)])
        except (TimeoutError, asyncio.CancelledError):
            if session_id is not None:
                with suppress(OSError, RequestError):
                    async with asyncio.timeout(1):
                        await connection.cancel(session_id=session_id)
            raise
        finally:
            with suppress(TimeoutError):
                async with asyncio.timeout(2):
                    await connection.close()

    parts = client.text_parts[client.last_message_offset:] if work else client.text_parts
    return SessionResult(session_id, response.stop_reason, "".join(parts))


def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", type=Path, default=Path.cwd())
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("executable", help="Path or command name of the ACP adapter executable")
    parser.add_argument("args", nargs=argparse.REMAINDER, help="Arguments to the adapter executable")
    options = parser.parse_args()

    try:
        result = asyncio.run(
            run_session(options.executable, *options.args, cwd=options.cwd, prompt=options.prompt, timeout=options.timeout)
        )
    except TimeoutError:
        print(f"ACP session timed out after {options.timeout:g}s", file=sys.stderr)
        return 1
    except (OSError, RequestError, RuntimeError) as error:
        print(f"ACP session failed: {error}", file=sys.stderr)
        return 1

    print(f"session={result.session_id} stop_reason={result.stop_reason}", file=sys.stderr)
    if result.text:
        print(result.text)
    return 0 if result.stop_reason == "end_turn" else 1


if __name__ == "__main__":
    raise SystemExit(_main())
