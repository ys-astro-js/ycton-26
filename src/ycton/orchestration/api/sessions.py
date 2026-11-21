"""실행 기록 조회와 취소. 완료 반영은 실행기의 반환값을 통해서만 수행한다."""
from fastapi import APIRouter, Depends, Request
from ycton.orchestration.api.dependencies import human, service
from ycton.orchestration.services.task_service import require

router = APIRouter(prefix="/api/sessions", tags=["프론트: 실행"], dependencies=[Depends(human)])


@router.get("/{session_id}")
def get(session_id: str, svc=Depends(service)):
    with svc.db.connect() as c:
        return require(c, "sessions", session_id)


@router.post("/{session_id}/cancel")
async def cancel(session_id: str, request: Request, svc=Depends(service)):
    await request.app.state.scheduler.cancel(session_id)
    with svc.db.connect() as c:
        return require(c, "sessions", session_id)
