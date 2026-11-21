"""프론트가 방·참여자·메시지와 전체 상태를 조회/변경하는 API."""
import asyncio
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from ycton.orchestration.api.dependencies import human, service
from ycton.orchestration.schemas import RoomCreate, AgentCreate, MessageCreate
from ycton.orchestration.services.task_service import require
from ycton.orchestration.folders import FolderError, git_info
from ycton.orchestration.jev import advise, workload

router = APIRouter(prefix="/api", tags=["프론트: 방"], dependencies=[Depends(human)])


@router.post("/folders/pick")
async def pick_folder(request: Request, svc=Depends(service)):
    """서버 컴퓨터에 OS 폴더 선택 창을 띄운다. 취소하면 path가 null이다."""
    try:
        folder = await request.app.state.folder_picker.pick()
    except FolderError as exc:
        raise HTTPException(exc.status, exc.message)
    if folder is None:
        return {"path": None, "name": None}
    repo = await asyncio.to_thread(svc.project_folder, folder)
    return {"path": repo, "name": Path(repo).name}


@router.post("/rooms", status_code=201)
def create_room(body: RoomCreate, svc=Depends(service)):
    return svc.create_room(body.name, body.repository_id, body.repo)


@router.get("/runtime/options")
def runtime_options(svc=Depends(service)):
    return svc.runtime_options()


@router.get("/rooms")
def list_rooms(svc=Depends(service)):
    with svc.db.connect() as c:
        return [dict(r) for r in c.execute("SELECT * FROM rooms ORDER BY id")]


@router.get("/agent-models")
def agent_models(svc=Depends(service)):
    return [{**p, "models": list(p["models"]), "efforts": list(p["efforts"])} for p in svc.agent_models()]


@router.post("/rooms/{room_id}/agents", status_code=201)
def create_agent(room_id: int, body: AgentCreate, svc=Depends(service)):
    return svc.create_agent(room_id, **body.model_dump())


@router.post("/agents/{agent_id}")
def update_agent(agent_id: int, body: AgentCreate, svc=Depends(service)):
    return svc.update_agent(agent_id, **body.model_dump())


@router.post("/agents/{agent_id}/remove")
def remove_agent(agent_id: int, svc=Depends(service)):
    return svc.remove_agent(agent_id)


@router.get("/rooms/{room_id}/state")
async def state(room_id: int, request: Request, svc=Depends(service)):
    result = await run_in_threadpool(svc.snapshot, room_id, dashboard=True)
    load = workload(result, svc.settings)
    del result["running_work"]
    result["jev"] = advise(result["room"]["paused"], load)
    advisor = request.app.state.jev
    if (advisor is not None and result["jev"]["action"] in ("wait", "spawn_suggested")
            and (load["unassigned_tasks"] or load["queued_work"])):
        recommendation = advisor.recommendation(room_id, load)
        if recommendation is not None:
            result["jev"]["recommendation"] = recommendation
    result["mode"] = svc.settings.mode
    path = svc.room_path(result["room"])
    result["git"] = await run_in_threadpool(git_info, path) if path else None
    return result


@router.post("/rooms/{room_id}/messages", status_code=201)
def message(room_id: int, body: MessageCreate, request: Request, background: BackgroundTasks, svc=Depends(service)):
    posted = svc.post_message(room_id, body.content, reply_to_message_id=body.reply_to_message_id)
    if posted["needs_routing"]:
        # 아무도 부르지 않은 사람 메시지는 응답 뒤에 Jev가 답할 에이전트 하나를 고른다.
        background.add_task(request.app.state.dispatcher.route_message, room_id, posted["id"])
    return {"ok": True}


@router.post("/messages/{message_id}/resolve")
def resolve(message_id: int, svc=Depends(service)):
    return svc.resolve_question(message_id)


@router.post("/rooms/{room_id}/pause")
def pause(room_id: int, svc=Depends(service)):
    return svc.pause(room_id, True)


@router.post("/rooms/{room_id}/resume")
def resume(room_id: int, svc=Depends(service)):
    return svc.pause(room_id, False)
