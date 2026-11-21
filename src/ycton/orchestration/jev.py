"""Jev의 임시 규칙판. LLM 판단·자동 spawn은 아직 구현하지 않았다."""

# rooms.paused 값. 0은 진행, 1은 사람이 멈춤, 2는 서버 재시작 복구가 멈춤.
PAUSED_BY_PERSON = 1
PAUSED_BY_RESTART = 2


def advise(state, settings):
    if state["room"]["paused"] == PAUSED_BY_RESTART:
        return {"action": "stop", "reason": "서버 재시작으로 일시 정지"}
    if state["room"]["paused"]:
        return {"action": "stop", "reason": "일시 정지"}
    opened = any(t["status"] == "open" and not t["retry_required"] and t["attempts"] < settings.max_attempts
                 for t in state["tasks"])
    if opened and not state["agents"]:
        return {"action": "spawn_suggested", "reason": "열린 작업이 있지만 참여 에이전트가 없습니다"}
    running = sum(s["kind"] == "work" and s["status"] == "running" for s in state["sessions"])
    if running >= settings.max_work:
        return {"action": "wait", "reason": "작업 실행 자리가 가득 찼습니다"}
    return {"action": "go", "reason": "설정된 한도 안에서 진행할 수 있습니다"}
