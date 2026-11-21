"""Run a delegated task in a new Git worktree."""

import asyncio
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from acp.schema import McpServerStdio, SessionNotification

from .acp_runtime import SessionResult, _run_session
from .room_mcp import is_room_mcp_server
from .subprocess_env import child_environment


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


def _work_prompt(task: WorkTask, *, can_commit: bool = False, base: str = "HEAD") -> str:
    if can_commit:
        finish = (
            "When the change is complete and the verification passes, call the room `commit` tool with "
            "the exact worktree-relative paths of the files this task changed and a short commit message. "
            "The task does not count as done without a commit. If the task by its nature needs no file changes (for "
            "example a review), call the room `no_changes` tool with your findings instead of committing. Never use "
            "`no_changes` to report that you could not do the task; then end without committing so the task fails. "
            "Do not run git commit, merge, or push yourself, and do not start detached processes.\n\n"
        )
    else:
        finish = "Leave edits in the worktree. Do not commit, merge, or start detached processes.\n\n"
    if base != "HEAD":
        finish += f"This worktree starts from branch `{base}`, where verified results of earlier tasks accumulate.\n\n"
    return (
        "Complete the delegated task using only the current worktree. "
        "Run the requested verification here and report the exact command and observed outcome. "
        "Before you start, check the skills available to you and load every one that fits this task "
        "(for example UI, accessibility or writing skills for interface work), then follow them. "
        "Write your final report in Korean, short: what changed, the commit, and the verification result. "
        + finish +
        f"Title: {task.title}\n\nDetail:\n{task.detail}\n\nScope:\n{task.scope}\n\n"
        f"Verification:\n{task.verify}\n\nInstructions:\n{task.instructions}\n\n"
        f"Agent instructions:\n{task.agents_md}"
    )


async def _git(repo: Path, *args: str) -> str:
    process = await asyncio.create_subprocess_exec(
        "git", "-C", str(repo), *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        env=child_environment(),
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


async def _branch_tip(repo: Path, branch: str) -> str | None:
    try:
        return await _git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}^{{commit}}")
    except RuntimeError:
        return None


async def ensure_branch(repo: Path, branch: str) -> None:
    """Create ``branch`` at the checkout's HEAD unless it exists. The checked-out branch is untouched.

    If everything on ``branch`` is already in HEAD (for example after it was merged into the project branch),
    move it up to HEAD so the next attempt also sees what people committed there.
    """
    tip = await _branch_tip(repo, branch)
    if tip is not None:
        try:
            await _git(repo, "merge-base", "--is-ancestor", tip, "HEAD")
            await _git(repo, "update-ref", f"refs/heads/{branch}", "HEAD", tip)
        except RuntimeError:
            pass
        return
    try:
        await _git(repo, "branch", "--no-track", branch, "HEAD")
    except RuntimeError:
        # 동시에 시작한 다른 시도가 먼저 만들었으면 그대로 쓴다.
        if await _branch_tip(repo, branch) is None:
            raise


async def worktree_clean(worktree: Path) -> bool:
    """커밋하지 않은 변경이 없으면 True."""
    try:
        return not (await _git(worktree, "status", "--porcelain")).strip()
    except RuntimeError:
        return False


async def fast_forward(repo: Path, branch: str, commit: str) -> bool:
    """Move ``branch`` to ``commit`` only when it is a fast-forward. Never merges.

    ``update-ref`` with the old value makes the move fail if another attempt moved the branch meanwhile.
    """
    old = await _branch_tip(repo, branch)
    if old is None:
        return False
    try:
        await _git(repo, "merge-base", "--is-ancestor", old, commit)
        await _git(repo, "update-ref", f"refs/heads/{branch}", commit, old)
    except RuntimeError:
        return False
    return True


@dataclass(frozen=True, slots=True)
class RebaseResult:
    commit: str | None
    conflicts: tuple[str, ...] = ()
    error: str = ""


async def rebase_onto(worktree: Path, upstream: str) -> RebaseResult:
    """Replay the worktree branch's own commits onto ``upstream``. Only the worktree's branch moves.

    On a conflict the rebase is aborted, so the worktree is never left mid-rebase, and the conflicting
    paths are returned. The server is the committer of the replayed commits; authors stay as they were.
    """
    try:
        await _git(worktree, "-c", "user.name=ycton", "-c", "user.email=server@ycton.local",
                   "rebase", "--no-autostash", upstream)
    except RuntimeError as exc:
        in_progress = False
        for state in ("rebase-merge", "rebase-apply"):
            with suppress(RuntimeError):
                in_progress |= (worktree / await _git(worktree, "rev-parse", "--git-path", state)).exists()
        if not in_progress:
            return RebaseResult(None, error=str(exc))
        conflicts = ()
        with suppress(RuntimeError):
            conflicts = tuple((await _git(worktree, "diff", "--name-only", "--diff-filter=U")).splitlines())
        await _git(worktree, "rebase", "--abort")
        return RebaseResult(None, conflicts=conflicts, error=str(exc))
    return RebaseResult(await _git(worktree, "rev-parse", "HEAD"))


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
    config: dict[str, str] | None = None,
    base: str = "HEAD",
) -> WorkSessionResult:
    """Run Codex at a new worktree path. Keep the checkout for review or handoff.

    With ``branch``, the worktree starts on that new branch so later commits stay reachable
    after the worktree is removed; without it, the checkout is detached. ``base`` is the
    revision the worktree starts from.
    """
    repo_root = Path(await _git(repo.resolve(), "rev-parse", "--show-toplevel")).resolve()
    workdir = worktree.resolve()
    if workdir.is_relative_to(repo_root):
        raise ValueError("Worktree must be outside the source checkout")
    workdir.mkdir(parents=True)
    start = ("-b", branch) if branch else ("--detach",)
    await _git(repo_root, "worktree", "add", *start, "--", str(workdir), base)

    session = await _run_session(
        executable, *args, cwd=workdir,
        prompt=_work_prompt(task, can_commit=any(is_room_mcp_server(s) for s in mcp_servers or ()), base=base),
        timeout=timeout,
        mcp_servers=mcp_servers, on_update=on_update, work=True, config=config,
    )
    return WorkSessionResult(worktree=workdir, session=session)
