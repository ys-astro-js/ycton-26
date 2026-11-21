"""담당 1과의 계약. 이 모듈은 FastAPI·SQLite에 의존하지 않는다."""
from dataclasses import dataclass
from typing import Protocol, Literal


@dataclass(frozen=True)
class RuntimeRequest:
    session_id: str
    room_id: int
    agent_id: int
    kind: Literal["chat", "work"]
    prompt: str
    agent_kind: str
    repository_id: str
    task_id: int | None = None
    model: str = ""
    effort: str = ""


@dataclass(frozen=True)
class RuntimeResult:
    succeeded: bool
    summary: str
    verification: Literal["passed", "failed", "not_run"] = "not_run"
    commit_hash: str | None = None
    log_path: str | None = None


class Runtime(Protocol):
    async def run(self, request: RuntimeRequest) -> RuntimeResult:
        """취소되면 자식 프로세스 정리까지 완료하고 CancelledError를 다시 올릴 것."""
        ...
