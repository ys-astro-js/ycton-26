"""담당 1 room_mcp의 문자열 ID·text 요청을 내부 상태 서비스에 연결한다."""
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import Field, field_validator
from .dependencies import service
from ..identity import Identity
from ..schemas import Input
from ..services.task_service import require, DomainError

router = APIRouter(prefix="/api/agent", tags=["내부 MCP: 세션 인증"])


class Actor(Input):
    room_id: str = Field(min_length=1)
    participant_id: str = Field(min_length=1)


class Message(Actor):
    text: str = Field(min_length=1, max_length=10000)


class Assignment(Actor):
    task_id: str = Field(min_length=1)

    @field_validator("task_id", mode="before")
    @classmethod
    def normalize_task_id(cls, value):
        if type(value) is int:
            return str(value)
        return value


class Delegation(Assignment):
    request_id: str | None = Field(default=None, min_length=1, max_length=128)
    instructions: str = Field(default="", max_length=10000)


def identity(request: Request, authorization: str = Header(default="")):
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    actor = request.app.state.tokens.resolve(token)
    if actor is None:
        raise HTTPException(401, "유효한 실행 세션 토큰이 필요합니다")
    return actor


class Commit(Actor):
    paths: list[str] = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=2000)


def validate(svc, actor, body, kind="chat"):
    if body.room_id != str(actor.room_id) or body.participant_id != str(actor.agent_id):
        raise DomainError("토큰의 방·작성자와 요청이 일치하지 않습니다", 403)
    with svc.db.connect() as c:
        s = require(c, "sessions", actor.session_id)
        a = require(c, "agents", actor.agent_id)
        if (s["status"] != "running" or s["kind"] != kind or s["agent_id"] != actor.agent_id
                or s["room_id"] != actor.room_id or a["room_id"] != actor.room_id):
            label = "채팅" if kind == "chat" else "작업"
            raise DomainError(f"활성 {label} 세션만 이 도구를 사용할 수 있습니다", 403)


def task_number(value):
    if not value.isascii() or not value.isdecimal():
        raise DomainError("task_id는 문자열 형식의 정수 ID여야 합니다", 422)
    return int(value)


@router.post("/messages", status_code=201)
def send(body: Message, actor=Depends(identity), svc=Depends(service)):
    validate(svc, actor, body)
    svc.post_message(actor.room_id, body.text, actor.agent_id)
    return {"ok": True}


@router.post("/tasks/list")
def tasks(body: Actor, actor=Depends(identity), svc=Depends(service)):
    validate(svc, actor, body)
    state = svc.snapshot(actor.room_id)
    return {"tasks": [{**t, "id": str(t["id"])} for t in state["tasks"]], "agents": state["agents"]}


@router.post("/tasks/claim")
def claim(body: Assignment, actor=Depends(identity), svc=Depends(service)):
    validate(svc, actor, body)
    return svc.claim(task_number(body.task_id), actor.agent_id)


@router.post("/tasks/delegate", status_code=202)
def delegate(body: Delegation, actor=Depends(identity), svc=Depends(service)):
    validate(svc, actor, body)
    # 기존 담당 1 규격은 request_id가 없다. 같은 채팅 세션의 같은 작업은 같은 키로 합친다.
    key = body.request_id or f"session:{actor.session_id}:task:{body.task_id}"
    return svc.delegate(task_number(body.task_id), actor.agent_id, key, body.instructions)


@router.post("/commit", status_code=201)
def commit(body: Commit, actor=Depends(identity), svc=Depends(service)):
    validate(svc, actor, body, kind="work")
    return {"commit": svc.commit_work(actor.session_id, body.paths, body.message)}
