"""API 키 없이 흐름을 재현하는 가짜 실행기. 실제 모델·코드 변경·검증은 하지 않는다."""
import asyncio
from ycton.orchestration.runtime_port import RuntimeResult
from ycton.orchestration.services.task_service import DomainError


class FakeRuntime:
    def __init__(self, service, settings):
        self.service, self.settings = service, settings

    async def run(self, request):
        if request.kind == "chat":
            await asyncio.sleep(self.settings.chat_delay_seconds)
            state = self.service.snapshot(request.room_id)
            for task in state["tasks"]:
                if (task["status"] != "open" or task["retry_required"]
                        or task["attempts"] >= self.settings.max_attempts):
                    continue
                try:
                    # 선택은 가짜 에이전트 내부에서 한다. 서버 스케줄러는 담당자를 고르지 않는다.
                    self.service.claim(task["id"], request.agent_id)
                    self.service.post_message(request.room_id,
                        f"[MOCK] #{task['id']} 작업을 맡아 별도 세션에 위임합니다.", request.agent_id)
                    self.service.delegate(task["id"], request.agent_id,
                                          f"fake:{request.session_id}:{task['id']}", "[MOCK] 데모 실행")
                    break
                except DomainError:
                    continue
            return RuntimeResult(True, "[MOCK] 채팅 턴 종료")
        await asyncio.sleep(self.settings.fake_work_seconds)
        if "[fail]" in request.prompt:
            return RuntimeResult(False, "[MOCK] 의도적으로 실패시킨 작업", "failed")
        return RuntimeResult(True, "[MOCK] 작업·검증 성공을 시뮬레이션했습니다. 실제 파일 변경 없음", "passed")
