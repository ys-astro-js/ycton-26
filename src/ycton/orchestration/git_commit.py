"""작업 worktree에서 에이전트가 고른 파일만 커밋한다. 셸을 거치지 않고 git argv만 실행한다."""
import os
import subprocess
from pathlib import Path, PurePath

GIT_TIMEOUT_SECONDS = 120


class CommitError(Exception):
    pass


def checked_paths(worktree: Path, paths: list[str]) -> list[str]:
    """worktree 안의 상대 경로만 받는다. 절대 경로, 바깥 경로, .git 내부는 거절한다."""
    root = worktree.resolve()
    result = []
    for raw in paths:
        if not raw or "\0" in raw or PurePath(raw).is_absolute() or PurePath(raw).drive:
            raise CommitError(f"worktree 기준 상대 경로만 커밋할 수 있습니다: {raw!r}")
        target = (root / raw).resolve()
        if target == root or not target.is_relative_to(root):
            raise CommitError(f"worktree 밖의 경로는 커밋할 수 없습니다: {raw}")
        relative = target.relative_to(root)
        if relative.parts[0] == ".git":
            raise CommitError(f".git 내부는 커밋할 수 없습니다: {raw}")
        result.append(relative.as_posix())
    return list(dict.fromkeys(result))


def _git(worktree: Path, *args: str) -> str:
    # 경로를 glob·magic pathspec으로 해석하지 않게 한다.
    env = {**os.environ, "GIT_LITERAL_PATHSPECS": "1", "GIT_TERMINAL_PROMPT": "0"}
    try:
        done = subprocess.run(("git", "-C", str(worktree), *args), env=env, capture_output=True,
                              text=True, errors="replace", timeout=GIT_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        raise CommitError(f"git {args[0]} 시간 초과") from None
    if done.returncode != 0:
        detail = (done.stderr.strip() or done.stdout.strip())[-500:]
        raise CommitError(f"git {args[0]} 실패: {detail}")
    return done.stdout.strip()


def commit_paths(worktree: Path, paths: list[str], message: str, author: str, email: str) -> str:
    """고른 파일만 스테이징하고, 다른 스테이징 변경은 남긴 채 그 파일만 커밋한 뒤 해시를 반환한다."""
    selected = checked_paths(worktree, paths)
    _git(worktree, "add", "--", *selected)
    # --only: 이미 스테이징된 다른 변경이 있어도 지정한 경로만 커밋한다.
    _git(worktree, "-c", f"user.name={author}", "-c", f"user.email={email}",
         "commit", "--only", "-m", message, "--", *selected)
    return _git(worktree, "rev-parse", "HEAD")
