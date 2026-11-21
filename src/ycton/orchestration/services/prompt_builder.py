"""채팅에는 방의 요약 상태를, 작업에는 할 일과 지시만 전달한다."""
import json


def chat_message(message, agent_id):
    """사람 메시지에는 이 에이전트가 답할 차례인지(for_you)만 남긴다."""
    addressed = json.loads(message.get("addressed_to") or "[]")
    message = {key: value for key, value in message.items() if key != "addressed_to"}
    if message["author"] == "human":
        message["for_you"] = agent_id in addressed
    return message


def build_prompt(service, session):
    state = service.snapshot(session["room_id"])
    if session["kind"] == "chat":
        return json.dumps({
            "rules": "담당은 Jev가 정한다. 내게 배정된 할 일은 delegate. 방 발언은 send, 다른 에이전트는 @이름으로 부른다.",
            "agent_id": session["agent_id"],
            "agents": state["agents"],
            "messages": [chat_message(m, session["agent_id"]) for m in state["messages"][-40:]],
            "tasks": [t for t in state["tasks"] if t["status"] in ("open", "claimed") and not t["retry_required"]],
            "recent_sessions": state["sessions"][-10:],
        }, ensure_ascii=False)
    task = next(t for t in state["tasks"] if t["id"] == session["task_id"])
    return json.dumps({key: task[key] for key in ("title", "detail", "scope", "verify", "handoff")}
                      | {"instruction": session["instruction"]}, ensure_ascii=False)
