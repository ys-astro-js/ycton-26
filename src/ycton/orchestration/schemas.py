"""프론트·MCP에서 보내는 입력 형식. 내부 DB 모델과 분리한다."""
from pydantic import BaseModel, Field, ConfigDict


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RoomCreate(Input):
    name: str = Field(min_length=1, max_length=100)


class AgentCreate(Input):
    name: str = Field(min_length=1, max_length=100)
    kind: str = Field(min_length=1, max_length=100)
    good_at: list[str] = Field(default_factory=list, max_length=30)


class MessageCreate(Input):
    content: str = Field(min_length=1, max_length=10000)


class TaskCreate(Input):
    title: str = Field(min_length=1, max_length=200)
    detail: str = Field(default="", max_length=20000)
    scope: str = Field(default="", max_length=5000)
    verify: str = Field(min_length=1, max_length=5000)


class Delegate(Input):
    request_id: str = Field(min_length=1, max_length=128)
    instruction: str = Field(default="", max_length=10000)


class Note(Input):
    note: str = Field(min_length=1, max_length=5000)
