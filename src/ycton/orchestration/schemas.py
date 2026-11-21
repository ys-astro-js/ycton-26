"""프론트·MCP에서 보내는 입력 형식. 내부 DB 모델과 분리한다."""
from pydantic import BaseModel, Field, ConfigDict


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RoomCreate(Input):
    name: str = Field(min_length=1, max_length=100)
    repository_id: str = Field(default="default", min_length=1, max_length=64)
    # POST /api/folders/pick가 돌려준 경로. 주면 repository_id 대신 이 폴더를 쓴다. 서버가 Git 저장소인지 다시 확인한다.
    repo: str | None = Field(default=None, min_length=1, max_length=4096)


class AgentCreate(Input):
    name: str = Field(min_length=1, max_length=100)
    kind: str = Field(min_length=1, max_length=100)
    model: str = Field(default="", max_length=100)
    effort: str = Field(default="", max_length=50)
    good_at: list[str] = Field(default_factory=list, max_length=30)


class MessageCreate(Input):
    content: str = Field(min_length=1, max_length=10000)
    reply_to_message_id: int | None = Field(default=None, gt=0, le=2**63 - 1)


class TaskCreate(Input):
    title: str = Field(min_length=1, max_length=200)
    detail: str = Field(default="", max_length=20000)
    scope: str = Field(default="", max_length=5000)
    # 비우면 Jev가 배정할 때 검증 프로필을 고른다.
    verify: str = Field(default="", max_length=5000)


class Delegate(Input):
    request_id: str = Field(min_length=1, max_length=128)
    instruction: str = Field(default="", max_length=10000)


class Note(Input):
    note: str = Field(min_length=1, max_length=5000)
