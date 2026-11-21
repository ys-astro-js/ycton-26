"""Dashboard actions should reflect server state without exposing raw runtime data."""
import asyncio
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient

from ycton.orchestration import main
from ycton.orchestration.config import Settings
from ycton.orchestration.event_log import EventLog
from ycton.orchestration.services.prompt_builder import build_prompt

HEADERS = {"X-Orch-Client": "web"}


def test_session_events_are_paginated_and_exclude_raw_acp_data(tmp_path):
    app = main.create_app(Settings(db_path=tmp_path / "state.db"), start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        svc = app.state.service
        logs = tmp_path / "logs"
        svc.runtime_config = SimpleNamespace(logs=logs, repositories={})
        room = svc.create_room("room")["id"]
        svc.create_agent(room, "adapter", "demo", [])
        sid = svc.snapshot(room)["sessions"][0]["id"]
        path = logs / f"{sid}.jsonl"
        svc.execution_metadata(sid, log_path=str(path), acp_session_id="actual-acp-id")

        async def record():
            async with EventLog(path, svc, sid, secrets=("token-do-not-show",)) as log:
                log.on_update({"update": {"session_update": "tool_call", "title": "private-shell-command", "raw_input": {"secret": "private-argument"}}})
                for index in range(41):
                    log.on_update({"update": {"session_update": "agent_message_chunk", "content": {"type": "text", "text": f"message {index} token-do-not-show"}}})
                log.on_update({"update": {"session_update": "agent_thought_chunk", "content": {"type": "text", "text": "private-reasoning"}}})

        asyncio.run(record())
        endpoint = f"/api/sessions/{sid}"
        assert client.get(f"{endpoint}/events", headers={"Authorization": "Bearer any"}).status_code == 403
        assert client.get(f"{endpoint}/events?cursor=1").status_code == 422
        first = client.get(f"{endpoint}/events").json()
        second = client.get(f"{endpoint}/events?cursor={first['next_cursor']}").json()
        assert first["has_more"] and not second["has_more"]
        events = first["events"] + second["events"]
        assert events[0]["text"] == "도구 실행 요청"
        assert [event["text"] for event in events[1:]] == [f"message {i} [REDACTED]" for i in range(41)]
        assert sorted({event["id"] for event in events}) == [event["id"] for event in events]
        detail = client.get(endpoint).json()
        room_session = client.get(f"/api/rooms/{room}/state").json()["sessions"][0]
        assert detail["acp_session_id"] == "actual-acp-id"
        for metadata in (detail, room_session):
            assert "latest_event" not in metadata and "log_path" not in metadata
        svc.execution_metadata(sid, log_path=str(tmp_path / "other.jsonl"))
        assert client.get(f"{endpoint}/events").status_code == 404


def test_task_scope_reaches_work_prompt(tmp_path):
    app = main.create_app(Settings(db_path=tmp_path / "state.db"), start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        svc = app.state.service
        room = svc.create_room("room")["id"]
        agent = svc.create_agent(room, "runner", "demo", [])["id"]
        task = client.post(f"/api/rooms/{room}/tasks", json={"title": "task", "scope": "src/only.py", "verify": "unit"}).json()["id"]
        svc.claim(task, agent)
        session = svc.delegate(task, agent, "scope", "")
        assert json.loads(build_prompt(svc, session))["scope"] == "src/only.py"
