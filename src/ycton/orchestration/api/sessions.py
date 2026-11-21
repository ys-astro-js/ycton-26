"""실행 기록 조회와 취소. 완료 반영은 실행기의 반환값을 통해서만 수행한다."""
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from ycton.orchestration.api.dependencies import human, service
from ycton.orchestration.event_log import read_event_page
from ycton.orchestration.services.task_service import DomainError, public_session, require

router = APIRouter(prefix="/api/sessions", tags=["프론트: 실행"], dependencies=[Depends(human)])


@router.get("/{session_id}")
def get(session_id: str, svc=Depends(service)):
    with svc.db.connect() as c:
        return public_session(require(c, "sessions", session_id))


@router.get("/{session_id}/events")
def events(session_id: str, cursor: int = Query(default=0, ge=0, le=2**63 - 1), svc=Depends(service)):
    with svc.db.connect() as c:
        session = require(c, "sessions", session_id)
    config = getattr(svc, "runtime_config", None)
    if not session["log_path"] or config is None:
        return {"events": [], "next_cursor": cursor, "has_more": False}
    path = config.logs / f"{session_id}.jsonl"
    if path.resolve() != path or Path(session["log_path"]).resolve() != path:
        raise DomainError("이 세션의 실행 로그를 찾을 수 없습니다", 404)
    try:
        return read_event_page(path, cursor)
    except ValueError:
        raise DomainError("올바르지 않은 실행 로그 위치입니다", 422) from None

@router.post("/{session_id}/cancel")
async def cancel(session_id: str, request: Request, svc=Depends(service)):
    await request.app.state.scheduler.cancel(session_id)
    with svc.db.connect() as c:
        return public_session(require(c, "sessions", session_id))
