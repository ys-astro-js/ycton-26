"""환경 변수로 데이터 위치·동시 실행 수·시간 제한을 설정한다."""
import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    db_path: Path = field(default_factory=lambda: Path(os.getenv("ORCH_DB", "data/team.db")))
    origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173",
                                "http://localhost:8000", "http://127.0.0.1:8000")
    mode: str = "mock"
    runtime_config: str = "runtime.toml"
    max_work: int = 2
    max_chat: int = 2
    max_attempts: int = 2
    max_chat_rounds: int = 6
    # 사람 입력 없이 에이전트가 스스로 만들 수 있는 할 일 수. 무한 반복을 막는 안전장치다.
    max_auto_tasks: int = 30
    timeout_seconds: float = 60
    tick_seconds: float = 0.1
    chat_delay_seconds: float = 0.2
    fake_work_seconds: float = 0.3
    openrouter_api_key: str = field(default="", repr=False)
    jev_model: str = "typesafe/jev-1.14"

    @classmethod
    def from_env(cls):
        settings = cls()
        settings.mode = os.getenv("ORCH_MODE", "mock")
        if settings.mode not in ("mock", "acp"):
            raise ValueError("ORCH_MODE는 mock 또는 acp여야 합니다")
        settings.runtime_config = os.getenv("ORCH_RUNTIME_CONFIG", "runtime.toml")
        settings.openrouter_api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        settings.jev_model = os.getenv("ORCH_JEV_MODEL", "").strip() or settings.jev_model
        settings.origins = tuple(os.getenv("ORCH_ORIGINS", ",".join(settings.origins)).split(","))
        for name in ("max_work", "max_chat", "max_attempts", "max_chat_rounds", "max_auto_tasks"):
            value = int(os.getenv(f"ORCH_{name.upper()}", str(getattr(settings, name))))
            if value < 1:
                raise ValueError(f"{name} must be positive")
            setattr(settings, name, value)
        settings.timeout_seconds = float(os.getenv("ORCH_TIMEOUT_SECONDS", "60"))
        if settings.timeout_seconds <= 0:
            raise ValueError("timeout must be positive")
        return settings
