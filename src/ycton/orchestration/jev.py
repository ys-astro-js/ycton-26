"""Jev의 임시 규칙판. LLM 판단·자동 spawn은 아직 구현하지 않았다."""


def advise(state, settings):
    if state["room"]["paused"]:
        return {"action": "stop", "reason": "사용자가 자동 진행을 중지했습니다"}
    opened = [t for t in state["tasks"] if t["status"] == "open" and t["attempts"] < settings.max_attempts]
    if opened and not state["agents"]:
        return {"action": "spawn_suggested", "reason": "열린 작업이 있지만 참여 에이전트가 없습니다"}
    running = sum(s["kind"] == "work" and s["status"] == "running" for s in state["sessions"])
    if running >= settings.max_work:
        return {"action": "wait", "reason": "작업 실행 자리가 가득 찼습니다"}
    return {"action": "go", "reason": "설정된 한도 안에서 진행할 수 있습니다"}
