"""Dashboard actions should reflect server state without exposing raw runtime data."""
import asyncio
import json
import sys
from threading import Event

import httpx
from fastapi.testclient import TestClient

from ycton.orchestration import main
from ycton.orchestration.acp_bridge import verify_worktree
from ycton.orchestration.config import Settings
from ycton.orchestration.jev import OpenRouterJev
from ycton.orchestration.runtime_config import Verification

HEADERS = {"X-Orch-Client": "web"}


def test_jev_decisions_are_cached_async_and_do_not_control_the_scheduler(tmp_path, monkeypatch):
    requests = []
    release = Event()

    async def respond(request):
        requests.append(request)
        await asyncio.to_thread(release.wait, 5)
        return httpx.Response(200, json={"answers": {"next_action": {"type": "choice", "choice": "wait"}}})

    monkeypatch.setattr(main, "OpenRouterJev", lambda key, model: OpenRouterJev(key, model, transport=httpx.MockTransport(respond)))
    settings = Settings(db_path=tmp_path / "jev.db", openrouter_api_key="test-key", jev_model="typesafe/test-jev")
    app = main.create_app(settings, start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        room = client.post("/api/rooms", json={"name": "private project name"}).json()["id"]
        client.post(f"/api/rooms/{room}/tasks", json={"title": "private task title", "verify": "unit"})
        path = f"/api/rooms/{room}/state"
        try:
            initial = client.get(path).json()["jev"]
            assert initial["action"] == "spawn_suggested" and "recommendation" not in initial
            assert client.get(path).json()["jev"] == initial
        finally:
            release.set()

        async def finish_evaluation():
            await asyncio.gather(*app.state.jev.running.values())

        client.portal.call(finish_evaluation)
        state = client.get(path).json()
        assert state["jev"]["action"] == "spawn_suggested"
        assert state["jev"]["recommendation"]["action"] == "wait"
        assert state["room"]["paused"] == 0 and not state["agents"]
        assert client.post(f"/api/rooms/{room}/pause").status_code == 200
        assert client.get(path).json()["jev"] == {"action": "stop", "reason": "사용자가 자동 진행을 중지했습니다"}
    (request,) = requests
    assert str(request.url) == "https://openrouter.ai/api/alpha/decisions"
    assert request.headers["Authorization"] == "Bearer test-key"
    payload = json.loads(request.content)
    assert payload["model"] == "typesafe/test-jev"
    assert payload["questions"]["next_action"]["type"] == "choice"
    assert json.loads(payload["state"]) == {"unassigned_tasks": 1, "queued_work": 0, "agents": 0,
                                             "busy_agents": 0, "running_work": 0, "max_work": 2}


def test_openrouter_failure_uses_rules_without_retrying_each_poll(tmp_path, monkeypatch):
    requests = []

    def reject(request):
        requests.append(request)
        return httpx.Response(429)

    monkeypatch.setattr(main, "OpenRouterJev", lambda key, model: OpenRouterJev(key, model, transport=httpx.MockTransport(reject)))
    app = main.create_app(Settings(db_path=tmp_path / "jev.db", openrouter_api_key="test-key"), start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        svc = app.state.service
        room = svc.create_room("waiting")["id"]
        svc.create_task(room, "work", "", "", "unit")
        path = f"/api/rooms/{room}/state"
        assert client.get(path).json()["jev"]["action"] == "spawn_suggested"

        async def finish_evaluation():
            await asyncio.gather(*app.state.jev.running.values())

        client.portal.call(finish_evaluation)
        assert "recommendation" not in client.get(path).json()["jev"]
        assert "recommendation" not in client.get(path).json()["jev"]
    assert len(requests) == 1


def test_wait_reason_matches_global_scheduler_capacity(tmp_path):
    app = main.create_app(Settings(db_path=tmp_path / "state.db", max_work=1), start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        svc = app.state.service
        other = svc.create_room("busy project")["id"]
        worker = svc.create_agent(other, "busy agent", "demo", [])["id"]
        task = svc.create_task(other, "running", "", "", "unit")["id"]
        svc.claim(task, worker)
        session = svc.delegate(task, worker, "busy", "")
        with svc.db.connect(write=True) as conn:
            conn.execute("UPDATE sessions SET status='running' WHERE id=?", (session["id"],))
        room = svc.create_room("waiting project")["id"]
        svc.create_agent(room, "available agent", "demo", [])
        svc.create_task(room, "queued work", "", "", "unit")
        assert client.get(f"/api/rooms/{room}/state").json()["jev"] == {
            "action": "wait", "reason": "서버의 작업 실행 자리가 가득 찼습니다",
        }


def test_jev_key_stays_in_server(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "server-only")
    profile = Verification((sys.executable, "-c", "import os; assert 'OPENROUTER_API_KEY' not in os.environ; print('OK')"), contains="OK")
    assert asyncio.run(verify_worktree(profile, tmp_path))[0]
