"""프론트가 방·참여자·메시지와 전체 상태를 조회/변경하는 API."""
from fastapi import APIRouter, Depends, Request
from ycton.orchestration.api.dependencies import human, service
from ycton.orchestration.schemas import RoomCreate, AgentCreate, MessageCreate
from ycton.orchestration.services.task_service import require
from ycton.orchestration.jev import advise

router = APIRouter(prefix="/api", tags=["프론트: 방"], dependencies=[Depends(human)])


@router.post("/rooms", status_code=201)
def create_room(body: RoomCreate, svc=Depends(service)):
    return svc.create_room(body.name)


@router.get("/rooms")
def list_rooms(svc=Depends(service)):
    with svc.db.connect() as c:
        return [dict(r) for r in c.execute("SELECT * FROM rooms ORDER BY id")]


@router.post("/rooms/{room_id}/agents", status_code=201)
def create_agent(room_id: int, body: AgentCreate, svc=Depends(service)):
    return svc.create_agent(room_id, **body.model_dump())


@router.get("/rooms/{room_id}/state")
def state(room_id: int, svc=Depends(service)):
    result = svc.snapshot(room_id)
    result["jev"] = advise(result, svc.settings)
    result["mode"] = svc.settings.mode
    return result


@router.post("/rooms/{room_id}/messages", status_code=201)
def message(room_id: int, body: MessageCreate, svc=Depends(service)):
    svc.post_message(room_id, body.content)
    return {"ok": True}


@router.post("/rooms/{room_id}/pause")
def pause(room_id: int, svc=Depends(service)):
    return svc.pause(room_id, True)


@router.post("/rooms/{room_id}/resume")
def resume(room_id: int, svc=Depends(service)):
    return svc.pause(room_id, False)
