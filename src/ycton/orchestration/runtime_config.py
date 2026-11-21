"""실행 명령·저장소·검증 명령은 서버 소유 TOML에서만 읽는다."""
from dataclasses import dataclass
from pathlib import Path
import tomllib
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AgentKind:
    command: tuple[str, ...]
    instructions: str = ""


@dataclass(frozen=True)
class Verification:
    command: tuple[str, ...]
    timeout: float = 60
    contains: str = ""


@dataclass(frozen=True)
class RuntimeConfig:
    repo: Path
    worktrees: Path
    logs: Path
    api_url: str
    kinds: dict[str, AgentKind]
    verifiers: dict[str, Verification]
    timeout: float = 600

    @classmethod
    def read(cls, path):
        path = Path(path).resolve()
        with path.open("rb") as file:
            data = tomllib.load(file)
        def location(value):
            p = Path(value).expanduser()
            return (path.parent / p).resolve() if not p.is_absolute() else p.resolve()
        def command(value):
            if not isinstance(value, list) or not value or not all(isinstance(x, str) and x for x in value):
                raise ValueError("command는 비어 있지 않은 문자열 배열이어야 합니다")
            return tuple(value)
        repo, worktrees, logs = (location(data[k]) for k in ("repo", "worktrees", "logs"))
        if not repo.is_dir():
            raise ValueError(f"저장소 폴더를 찾을 수 없습니다: {repo}")
        if worktrees.is_relative_to(repo):
            raise ValueError("worktrees는 원본 저장소 밖이어야 합니다")
        if logs.is_relative_to(repo) or logs.is_relative_to(worktrees):
            raise ValueError("logs는 원본 저장소와 작업 worktrees 밖이어야 합니다")
        url = data["api_url"]
        parsed = urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username
                or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise ValueError("api_url은 경로 없는 http://127.0.0.1:<포트>여야 합니다")
        kinds = {name: AgentKind(command(item["command"]), item.get("instructions", ""))
                 for name, item in data["kinds"].items()}
        verifiers = {name: Verification(command(item["command"]), float(item.get("timeout", 60)), item.get("contains", ""))
                     for name, item in data["verify"].items()}
        timeout = float(data.get("timeout", 600))
        if not kinds or not verifiers or timeout <= 0 or any(v.timeout <= 0 for v in verifiers.values()):
            raise ValueError("종류와 검증 프로필, 양수 시간 제한이 필요합니다")
        return cls(repo, worktrees, logs, url.rstrip("/"), kinds, verifiers, timeout)
