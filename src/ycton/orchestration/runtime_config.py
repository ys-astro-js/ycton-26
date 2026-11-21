"""실행 명령·저장소·검증 명령은 서버 소유 TOML에서만 읽는다."""
from dataclasses import dataclass
from pathlib import Path
import re
import subprocess
import tomllib
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AgentKind:
    """모델 제공자 하나. 사람은 이 가운데서 제공자, 모델, 추론 수준을 고른다."""
    command: tuple[str, ...]
    instructions: str = ""
    label: str = ""
    models: tuple[str, ...] = ()
    efforts: tuple[str, ...] = ()


def names(item, key):
    value = item.get(key, [])
    if not isinstance(value, list) or not all(isinstance(x, str) and x for x in value):
        raise ValueError(f"{key}는 문자열 배열이어야 합니다")
    return tuple(value)


def catalog_entry(name, item):
    return {"id": name, "label": item.get("label", name), "models": names(item, "models"), "efforts": names(item, "efforts")}


def read_catalog(path):
    """mock 모드처럼 전체 설정을 검증하지 않을 때, 제공자와 모델, 추론 수준만 읽는다."""
    with Path(path).open("rb") as file:
        data = tomllib.load(file)
    return [catalog_entry(name, item) for name, item in data.get("kinds", {}).items()]


@dataclass(frozen=True)
class Verification:
    command: tuple[str, ...]
    timeout: float = 60
    contains: str = ""


@dataclass(frozen=True)
class Repository:
    path: Path
    label: str
    verification_profiles: tuple[str, ...]
    default_verification_profile: str


@dataclass(frozen=True)
class RuntimeConfig:
    repositories: dict[str, Repository]
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
        worktrees, logs = (location(data[k]) for k in ("worktrees", "logs"))
        if logs.is_relative_to(worktrees):
            raise ValueError("logs는 원본 저장소와 작업 worktrees 밖이어야 합니다")
        url = data["api_url"]
        parsed = urlsplit(url)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username
                or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise ValueError("api_url은 경로 없는 http://127.0.0.1:<포트>여야 합니다")
        kinds = {name: AgentKind(command(item["command"]), item.get("instructions", ""), item.get("label", name),
                                 names(item, "models"), names(item, "efforts"))
                 for name, item in data["kinds"].items()}
        verifiers = {name: Verification(command(item["command"]), float(item.get("timeout", 60)), item.get("contains", ""))
                     for name, item in data["verify"].items()}
        timeout = float(data.get("timeout", 600))
        if not kinds or not verifiers or timeout <= 0 or any(v.timeout <= 0 for v in verifiers.values()):
            raise ValueError("종류와 검증 프로필, 양수 시간 제한이 필요합니다")

        def repository(entry, path_key, label, profile_default):
            value = entry.get(path_key)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{path_key}는 비어 있지 않은 경로 문자열이어야 합니다")
            if not isinstance(label, str) or not label.strip():
                raise ValueError("label은 비어 있지 않은 문자열이어야 합니다")
            names = entry.get("verification_profiles", profile_default)
            if not isinstance(names, list) or not names or not all(isinstance(n, str) and n in verifiers for n in names):
                raise ValueError("verification_profiles에는 등록된 검증 프로필이 필요합니다")
            if len(set(names)) != len(names):
                raise ValueError("verification_profiles에 중복된 이름이 있습니다")
            profiles = tuple(sorted(names))
            default = entry.get("default_verification_profile", "unit" if "unit" in profiles else profiles[0])
            if default not in profiles:
                raise ValueError("default_verification_profile은 허용 목록에 있어야 합니다")
            repo = location(value)
            if not repo.is_dir():
                raise ValueError(f"저장소 폴더를 찾을 수 없습니다: {repo}")
            if worktrees.is_relative_to(repo) or logs.is_relative_to(repo):
                raise ValueError("worktrees와 logs는 원본 저장소 밖이어야 합니다")
            try:
                root = subprocess.run(["git", "-C", str(repo), "rev-parse", "--show-toplevel"],
                                      check=True, capture_output=True, encoding="utf-8", timeout=10)
                subprocess.run(["git", "-C", str(repo), "rev-parse", "--verify", "HEAD"],
                               check=True, capture_output=True, timeout=10)
            except (OSError, subprocess.SubprocessError, UnicodeError) as exc:
                raise ValueError(f"커밋이 있는 Git 저장소가 필요합니다: {repo} ({exc})") from exc
            if Path(root.stdout.rstrip("\r\n")).resolve() != repo:
                raise ValueError(f"Git 저장소 루트를 지정해야 합니다: {repo}")
            return Repository(repo, label, profiles, default)

        try:
            default_repo = repository(data, "repo", "기본 저장소", list(verifiers))
        except (ValueError, OSError, RuntimeError) as exc:
            raise ValueError(f"저장소 default: {exc}") from exc
        repositories = {"default": default_repo}
        additional = data.get("repositories", {})
        if not isinstance(additional, dict):
            raise ValueError("repositories는 저장소 ID별 테이블이어야 합니다")
        for identifier, entry in additional.items():
            try:
                if identifier == "default" or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", identifier):
                    raise ValueError("허용되지 않는 ID입니다")
                if not isinstance(entry, dict):
                    raise ValueError("저장소 설정은 테이블이어야 합니다")
                repositories[identifier] = repository(entry, "path", entry.get("label", identifier), None)
            except (ValueError, OSError, RuntimeError) as exc:
                raise ValueError(f"저장소 {identifier}: {exc}") from exc
        return cls(repositories, worktrees, logs, url.rstrip("/"), kinds, verifiers, timeout)
