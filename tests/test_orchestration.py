"""중복 요청·경합·실패·재시작 등 실제 상태 손상 위험을 검증한다."""
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from ycton.orchestration.config import Settings
from ycton.orchestration.db import Database
from ycton.orchestration.main import create_app
from ycton.orchestration.runtime_port import RuntimeResult
from ycton.orchestration.services.task_service import TaskService, DomainError


@pytest.fixture
def service(tmp_path):
    settings = Settings(db_path=tmp_path / "test.db")
    db = Database(settings.db_path)
    db.initialize()
    svc = TaskService(db, settings)
    room = svc.create_room("test")
    a = svc.create_agent(room["id"], "A", "frontend", ["UI"])
    b = svc.create_agent(room["id"], "B", "backend", ["API"])
    task = svc.create_task(room["id"], "task", "", "src/", "pytest")
    return svc, room["id"], a["id"], b["id"], task["id"]


def test_atomic_claim_under_real_threads(service):
    svc, room, a, b, task = service
    barrier = Barrier(2)
    def attempt(agent):
        barrier.wait()
        try:
            svc.claim(task, agent)
            return "won"
        except DomainError:
            return "lost"
    with ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(attempt, [a, b])) == ["lost", "won"]
    assert svc.snapshot(room)["tasks"][0]["owner_id"] in (a, b)


def test_delegate_idempotency_and_conflict(service):
    svc, room, a, b, task = service
    svc.claim(task, a)
    first = svc.delegate(task, a, "request-1", "do it")
    assert svc.delegate(task, a, "request-1", "do it")["id"] == first["id"]
    with pytest.raises(DomainError):
        svc.delegate(task, a, "request-1", "changed")
    with pytest.raises(DomainError):
        svc.delegate(task, a, "request-2", "do it")
    with pytest.raises(DomainError):
        svc.delegate(task, b, "request-3", "do it")


def test_late_result_cannot_overwrite_new_attempt(service):
    svc, room, a, b, task = service
    svc.claim(task, a)
    old = svc.delegate(task, a, "1", "")
    svc.finish(old["id"], RuntimeResult(False, "timeout"))
    svc.claim(task, b)
    current = svc.delegate(task, b, "2", "")
    assert not svc.finish(old["id"], RuntimeResult(True, "late", "passed"))
    state = svc.snapshot(room)["tasks"][0]
    assert state["active_session_id"] == current["id"]
    assert state["status"] == "claimed"
    svc.finish(current["id"], RuntimeResult(True, "done", "passed", "abc123"))
    state = svc.snapshot(room)["tasks"][0]
    assert state["status"] == "done" and state["commit_hash"] == "abc123"


def test_process_success_without_verification_is_not_done(service):
    svc, room, a, b, task = service
    svc.claim(task, a)
    run = svc.delegate(task, a, "x", "")
    svc.finish(run["id"], RuntimeResult(True, "no verification"))
    assert svc.snapshot(room)["tasks"][0]["status"] == "open"


def test_retry_limit_and_manual_reset(service):
    svc, room, a, b, task = service
    for n in range(2):
        svc.claim(task, a)
        s = svc.delegate(task, a, str(n), "")
        svc.finish(s["id"], RuntimeResult(False, "failed"))
    with pytest.raises(DomainError):
        svc.claim(task, b)
    svc.manual_task_action(task, "retry", "원인을 수정했습니다")
    assert svc.claim(task, b)["status"] == "claimed"


def test_recovery_releases_work_and_pauses_room(service):
    svc, room, a, b, task = service
    svc.claim(task, a)
    svc.delegate(task, a, "x", "")
    svc.recover()
    state = svc.snapshot(room)
    assert state["room"]["paused"] == 1
    assert state["tasks"][0]["status"] == "open"
    assert all(s["status"] not in ("queued", "running") for s in state["sessions"])


def test_cross_room_claim_rejected(service):
    svc, room, a, b, task = service
    other = svc.create_room("other")
    stranger = svc.create_agent(other["id"], "C", "x", [])
    with pytest.raises(DomainError) as exc:
        svc.claim(task, stranger["id"])
    assert exc.value.status == 403


def test_release_with_active_run_rejected(service):
    svc, room, a, b, task = service
    svc.claim(task, a)
    svc.delegate(task, a, "x", "")
    with pytest.raises(DomainError):
        svc.release(task, a, "handoff")


def test_http_auth_origin_and_validation(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "api.db"), start_scheduler=False)
    with TestClient(app, base_url="http://localhost") as client:
        assert client.post("/api/rooms", json={"name": "x"}).status_code == 403
        client.headers["X-Orch-Client"] = "web"
        assert client.post("/api/rooms", json={"name": "x"}, headers={"Origin": "https://evil.example"}).status_code == 403
        room = client.post("/api/rooms", json={"name": "x"}).json()["id"]
        a = client.post(f"/api/rooms/{room}/agents", json={"name": "A", "kind": "demo"}).json()["id"]
        task = client.post(f"/api/rooms/{room}/tasks", json={"title": "task", "verify": "pytest"}).json()["id"]
        assert client.post(f"/api/rooms/{room}/tasks", json={"title": "task"}).status_code == 422
        assert client.post("/api/agent/tasks/claim", json={"room_id": str(room), "participant_id": str(a), "task_id": str(task)}).status_code == 401
        assert client.post(f"/api/agents/{a}/token").status_code == 404
        assert client.get("/openapi.json").status_code == 200


def wait_state(client, room, predicate, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = client.get(f"/api/rooms/{room}/state").json()
        if predicate(state):
            return state
        time.sleep(0.02)
    raise AssertionError(f"state timeout: {state}")


def test_end_to_end_mock_and_pause(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "e2e.db", fake_work_seconds=0.05, chat_delay_seconds=0.01))
    with TestClient(app, base_url="http://localhost", headers={"X-Orch-Client": "web"}) as client:
        room = client.post("/api/rooms", json={"name": "demo"}).json()["id"]
        client.post(f"/api/rooms/{room}/pause")
        client.post(f"/api/rooms/{room}/agents", json={"name": "A", "kind": "demo"})
        client.post(f"/api/rooms/{room}/tasks", json={"title": "task", "verify": "mock"})
        time.sleep(0.15)
        assert client.get(f"/api/rooms/{room}/state").json()["tasks"][0]["status"] == "open"
        client.post(f"/api/rooms/{room}/resume")
        state = wait_state(client, room, lambda s: s["tasks"][0]["status"] == "done")
        assert "[MOCK]" in state["tasks"][0]["handoff"]
        assert len([s for s in state["sessions"] if s["kind"] == "work"]) == 1


def test_failure_demo_stops_retrying(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "fail.db", fake_work_seconds=0.01, chat_delay_seconds=0.01))
    with TestClient(app, base_url="http://localhost", headers={"X-Orch-Client": "web"}) as client:
        room = client.post("/api/rooms", json={"name": "demo"}).json()["id"]
        client.post(f"/api/rooms/{room}/agents", json={"name": "A", "kind": "demo"})
        client.post(f"/api/rooms/{room}/tasks", json={"title": "[fail] task", "verify": "mock"})
        state = wait_state(client, room, lambda s: s["tasks"][0]["attempts"] == 2 and s["tasks"][0]["status"] == "open")
        time.sleep(0.2)
        assert client.get(f"/api/rooms/{room}/state").json()["tasks"][0]["attempts"] == 2


def test_scheduler_limit_timeout_and_cancel(service):
    from ycton.orchestration.scheduler import Scheduler
    svc, room, a, b, task = service
    other = svc.create_task(room, "other", "", "", "mock")
    svc.claim(task, a)
    first = svc.delegate(task, a, "1", "")
    svc.claim(other["id"], b)
    second = svc.delegate(other["id"], b, "2", "")
    svc.settings.max_work = 1
    svc.settings.timeout_seconds = 0.03
    class SlowRuntime:
        async def run(self, request):
            await asyncio.sleep(1)
            return RuntimeResult(True, "unexpected", "passed")
    async def exercise():
        scheduler = Scheduler(svc, SlowRuntime(), svc.settings)
        scheduler.dispatch()
        state = svc.snapshot(room)
        assert sum(s["kind"] == "work" and s["status"] == "running" for s in state["sessions"]) == 1
        await asyncio.sleep(0.08)
        assert svc.snapshot(room)["tasks"][0]["status"] == "open"
        await scheduler.cancel(second["id"])
        assert svc.snapshot(room)["tasks"][1]["status"] == "open"
        await scheduler.stop()
    asyncio.run(exercise())


def test_agent_models_list_example_catalog_and_validate_choice(tmp_path):
    settings = Settings(db_path=tmp_path / "models.db", runtime_config=str(tmp_path / "missing.toml"))
    app = create_app(settings, start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers={"X-Orch-Client": "web"}) as client:
        providers = client.get("/api/agent-models").json()
        assert [p["label"] for p in providers] == ["Claude", "GPT", "Gemini"]
        claude = providers[0]
        room = client.post("/api/rooms", json={"name": "r"}).json()["id"]
        body = {"name": "A", "kind": claude["id"], "model": claude["models"][0], "effort": claude["efforts"][-1],
                "good_at": ["프론트엔드"]}
        assert client.post(f"/api/rooms/{room}/agents", json={**body, "model": "nope"}).status_code == 422
        assert client.post(f"/api/rooms/{room}/agents", json={**body, "effort": "nope"}).status_code == 422
        assert client.post(f"/api/rooms/{room}/agents", json=body).status_code == 201
        agent = client.get(f"/api/rooms/{room}/state").json()["agents"][0]
        assert (agent["model"], agent["effort"], agent["good_at"]) == (body["model"], body["effort"], ["프론트엔드"])


def test_session_config_sets_matching_options_and_rejects_unknown_values():
    from types import SimpleNamespace
    from ycton.acp_runtime import apply_session_config
    calls = []

    class Connection:
        async def set_config_option(self, **kwargs):
            calls.append(kwargs)

    def select(option_id, category, *values):
        return SimpleNamespace(id=option_id, category=category, options=[SimpleNamespace(value=v) for v in values])

    session = SimpleNamespace(session_id="s", config_options=[select("m", "model", "a", "b"), select("t", "thought_level", "high")])
    asyncio.run(apply_session_config(Connection(), session, {"model": "b", "thought_level": "high"}))
    assert calls == [{"config_id": "m", "session_id": "s", "value": "b"}, {"config_id": "t", "session_id": "s", "value": "high"}]
    with pytest.raises(RuntimeError):
        asyncio.run(apply_session_config(Connection(), session, {"model": "c"}))
