"""사람용 요청과 에이전트 토큰을 구분한다. 토큰은 재시작 시 폐기된다."""
from fastapi import Request, Header, HTTPException


def human(request: Request, x_orch_client: str = Header(default="")):
    if request.headers.get("authorization") or x_orch_client != "web":
        raise HTTPException(403, "사람용 API에는 X-Orch-Client: web 헤더가 필요합니다")


def service(request: Request):
    return request.app.state.service
