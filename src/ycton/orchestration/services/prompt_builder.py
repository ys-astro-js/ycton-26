"""채팅에는 방의 요약 상태를, 작업에는 할 일과 지시만 전달한다."""
import json


def build_prompt(service, session):
    state = service.snapshot(session["room_id"])
    if session["kind"] == "chat":
        return json.dumps({
            "rules": "담당은 send로 제안·동의한 뒤 claim 성공으로 확정. claim 후 delegate. 방 발언은 send 도구 사용.",
            "agent_id": session["agent_id"],
            "agents": state["agents"],
            "messages": state["messages"][-40:],
            "tasks": [t for t in state["tasks"] if t["status"] in ("open", "claimed") and not t["retry_required"]],
            "recent_sessions": state["sessions"][-10:],
        }, ensure_ascii=False)
    task = next(t for t in state["tasks"] if t["id"] == session["task_id"])
    return json.dumps({key: task[key] for key in ("title", "detail", "scope", "verify", "handoff")}
                      | {"instruction": session["instruction"]}, ensure_ascii=False)
