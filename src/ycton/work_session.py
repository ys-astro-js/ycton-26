"""Run a delegated task in a new Git worktree."""

import asyncio
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from acp.schema import McpServerStdio, SessionNotification

from .acp_runtime import SessionResult, _run_session
from .room_mcp import is_room_mcp_server


@dataclass(frozen=True, slots=True)
class WorkTask:
    title: str
    detail: str
    scope: str
    verify: str
    instructions: str
    agents_md: str = ""


@dataclass(frozen=True, slots=True)
class WorkSessionResult:
    worktree: Path
    session: SessionResult


def _work_prompt(task: WorkTask, *, can_commit: bool = False) -> str:
    if can_commit:
        finish = (
            "When the change is complete and the verification passes, call the room `commit` tool with "
            "the exact worktree-relative paths of the files this task changed and a short commit message. "
            "The task does not count as done without a commit. "
            "Do not run git commit, merge, or push yourself, and do not start detached processes.\n\n"
        )
    else:
        finish = "Leave edits in the worktree. Do not commit, merge, or start detached processes.\n\n"
    return (
        "Complete the delegated task using only the current worktree. "
        "Run the requested verification here and report the exact command and observed outcome. "
        + finish +
        f"Title: {task.title}\n\nDetail:\n{task.detail}\n\nScope:\n{task.scope}\n\n"
        f"Verification:\n{task.verify}\n\nInstructions:\n{task.instructions}\n\n"
        f"Agent instructions:\n{task.agents_md}"
    )


async def _git(repo: Path, *args: str) -> str:
    process = await asyncio.create_subprocess_exec(
        "git", "-C", str(repo), *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await process.communicate()
    except asyncio.CancelledError:
        with suppress(ProcessLookupError):
            process.kill()
        await process.wait()
        raise
    if process.returncode != 0:
        error = stderr.decode(errors="replace").strip()
        raise RuntimeError(f"git {args[0]} failed in {repo}: {error}")
    return stdout.decode().rstrip("\r\n")


async def run_work_session(
    executable: str,
    *args: str,
    repo: Path,
    worktree: Path,
    task: WorkTask,
    timeout: float = 600,
    mcp_servers: list[McpServerStdio] | None = None,
    on_update: Callable[[SessionNotification], None] | None = None,
    branch: str | None = None,
) -> WorkSessionResult:
    """Run Codex at a new worktree path. Keep the checkout for review or handoff.

    With ``branch``, the worktree starts on that new branch so later commits stay reachable
    after the worktree is removed; without it, the checkout is detached.
    """
    repo_root = Path(await _git(repo.resolve(), "rev-parse", "--show-toplevel")).resolve()
    workdir = worktree.resolve()
    if workdir.is_relative_to(repo_root):
        raise ValueError("Worktree must be outside the source checkout")
    workdir.mkdir(parents=True)
    start = ("-b", branch) if branch else ("--detach",)
    await _git(repo_root, "worktree", "add", *start, "--", str(workdir), "HEAD")

    session = await _run_session(
        executable, *args, cwd=workdir,
        prompt=_work_prompt(task, can_commit=any(is_room_mcp_server(s) for s in mcp_servers or ())), timeout=timeout,
        mcp_servers=mcp_servers, on_update=on_update, work=True,
    )
    return WorkSessionResult(worktree=workdir, session=session)
