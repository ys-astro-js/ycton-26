"""사용자 할 일 등록과 에이전트 claim/release/delegate의 HTTP 입구."""
from fastapi import APIRouter, Depends
from ycton.orchestration.api.dependencies import human, service
from ycton.orchestration.schemas import TaskCreate, Delegate, Note, MessageCreate
from ycton.orchestration.services.task_service import require, DomainError

router = APIRouter(prefix="/api", tags=["프론트: 할 일"], dependencies=[Depends(human)])


@router.post("/rooms/{room_id}/tasks", status_code=201)
def create(room_id: int, body: TaskCreate, svc=Depends(service)):
    return svc.create_task(room_id, **body.model_dump())


@router.get("/tasks/{task_id}/events")
def events(task_id: int, svc=Depends(service)):
    with svc.db.connect() as c:
        require(c, "tasks", task_id)
        return [dict(r) for r in c.execute("SELECT * FROM task_events WHERE task_id=? ORDER BY id", (task_id,))]


@router.post("/tasks/{task_id}/retry")
def retry(task_id: int, body: Note, svc=Depends(service)):
    return svc.manual_task_action(task_id, "retry", body.note)


@router.post("/tasks/{task_id}/drop")
def drop(task_id: int, body: Note, svc=Depends(service)):
    return svc.manual_task_action(task_id, "drop", body.note)


