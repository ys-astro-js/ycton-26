"""Jev가 답할 에이전트·할 일 담당·검증 프로필을 고르고, 에이전트끼리는 @이름으로만 깨우는지 검증한다."""
import asyncio
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from ycton.orchestration.config import Settings
from ycton.orchestration.db import Database
from ycton.orchestration.dispatch import Dispatcher
from ycton.orchestration.jev import OpenRouterJev
from ycton.orchestration.main import create_app
from ycton.orchestration.runtime_config import Verification
from ycton.orchestration.runtime_port import RuntimeResult
from ycton.orchestration.services.task_service import TaskService

HEADERS = {"X-Orch-Client": "web"}


@pytest.fixture
def room(tmp_path):
    settings = Settings(db_path=tmp_path / "dispatch.db")
    db = Database(settings.db_path)
    db.initialize()
    svc = TaskService(db, settings)
    rid = svc.create_room("room")["id"]
    ids = {name: svc.create_agent(rid, name, kind, good_at)["id"]
           for name, kind, good_at in (("Al", "backend", ["API"]), ("Alice", "frontend", ["UI"]), ("Bob", "docs", ["문서"]))}
    return svc, rid, ids


def queued(svc, room_id):
    with svc.db.connect() as c:
        return sorted(r["agent_id"] for r in c.execute(
            "SELECT agent_id FROM sessions WHERE room_id=? AND kind='chat' AND status='queued'", (room_id,)))


def fake_jev(answers=None, status=200, requests=None):
    def respond(request):
        if requests is not None:
            requests.append(json.loads(request.content))
        return httpx.Response(status, json={"answers": answers or {}})
    return OpenRouterJev("test-key", "typesafe/test-jev", transport=httpx.MockTransport(respond))


def run(coro_factory):
    return asyncio.run(coro_factory())


def test_creating_agents_and_tasks_wakes_nobody(room):
    svc, rid, _ = room
    svc.create_task(rid, "task", "", "", "")
    assert queued(svc, rid) == []


def test_mention_wakes_only_named_agents_and_not_name_prefixes(room):
    svc, rid, ids = room
    posted = svc.post_message(rid, "@Alice 화면 좀 봐 줘")
    assert posted["needs_routing"] is False
    assert queued(svc, rid) == [ids["Alice"]]


def test_agent_mention_wakes_named_agent_and_plain_agent_message_wakes_nobody(room):
    svc, rid, ids = room
    assert svc.post_message(rid, "진행 상황 공유합니다", ids["Bob"])["needs_routing"] is False
    assert queued(svc, rid) == []
    svc.post_message(rid, "@Al API 응답 형식 확인 부탁해요", ids["Bob"])
    assert queued(svc, rid) == [ids["Al"]]
    # 자기 자신을 부르면 깨우지 않는다.
    svc.post_message(rid, "@Bob 메모", ids["Bob"])
    assert queued(svc, rid) == [ids["Al"]]


def test_human_reply_wakes_the_agent_who_asked(room):
    svc, rid, ids = room
    svc.post_message(rid, "@human 어느 브랜치에 올릴까요?", ids["Bob"])
    question = svc.snapshot(rid)["messages"][-1]["id"]
    posted = svc.post_message(rid, "main에 올려 주세요", reply_to_message_id=question)
    assert posted["needs_routing"] is False
    assert queued(svc, rid) == [ids["Bob"]]


def test_unanswered_questions_skip_agent_to_agent_mentions(room):
    svc, rid, ids = room
    svc.post_message(rid, "@Al 스키마 확인해 줘", ids["Bob"])
    svc.post_message(rid, "@human 배포해도 될까요?", ids["Bob"])
    questions = svc.snapshot(rid, dashboard=True)["unanswered_questions"]
    assert [q["content"] for q in questions] == ["@human 배포해도 될까요?"]


def test_unmentioned_human_message_wakes_one_agent_by_fallback(room):
    svc, rid, ids = room
    posted = svc.post_message(rid, "UI 버튼 색을 바꿔 줘")
    assert posted["needs_routing"] is True
    assert queued(svc, rid) == []
    assert run(lambda: Dispatcher(svc).route_message(rid, posted["id"])) == ids["Alice"]
    assert queued(svc, rid) == [ids["Alice"]]


def test_fallback_continues_with_the_agent_already_talking(room):
    svc, rid, ids = room
    svc.post_message(rid, "확인했습니다", ids["Bob"])
    posted = svc.post_message(rid, "UI 버튼도 부탁해")
    assert run(lambda: Dispatcher(svc).route_message(rid, posted["id"])) == ids["Bob"]


def test_jev_picks_the_responder(room):
    svc, rid, ids = room
    posted = svc.post_message(rid, "아무나 답해 줘")
    requests = []

    async def route():
        jev = fake_jev({"responder": {"type": "choice", "choice": "Bob"}}, requests=requests)
        try:
            return await Dispatcher(svc, jev).route_message(rid, posted["id"])
        finally:
            await jev.close()

    assert run(route) == ids["Bob"]
    assert queued(svc, rid) == [ids["Bob"]]
    question = requests[0]["questions"]["responder"]
    assert question["type"] == "choice" and set(question["criteria"]) == {"Al", "Alice", "Bob"}
    assert json.loads(requests[0]["state"])["message"] == "아무나 답해 줘"


@pytest.mark.parametrize("answers,status", [
    ({"responder": {"type": "choice", "choice": "Nobody"}}, 200),
    ({}, 500),
])
def test_jev_failure_or_invalid_choice_falls_back_to_one_agent(room, answers, status):
    svc, rid, ids = room
    posted = svc.post_message(rid, "문서 정리해 줘")

    async def route():
        jev = fake_jev(answers, status=status)
        try:
            return await Dispatcher(svc, jev).route_message(rid, posted["id"])
        finally:
            await jev.close()

    assert run(route) == ids["Bob"]
    assert queued(svc, rid) == [ids["Bob"]]


def test_route_through_http_wakes_exactly_one_agent(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "http.db"), start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        rid = client.post("/api/rooms", json={"name": "room"}).json()["id"]
        for name in ("A", "B"):
            client.post(f"/api/rooms/{rid}/agents", json={"name": name, "kind": "demo"})
        assert client.post(f"/api/rooms/{rid}/messages", json={"content": "안녕"}).status_code == 201
        assert len(queued(app.state.service, rid)) == 1


def test_assignment_falls_back_to_matching_strength_in_mock_mode(room):
    svc, rid, ids = room
    tid = svc.create_task(rid, "UI 정리", "", "", "")["id"]
    task = run(lambda: Dispatcher(svc).assign_task(tid))
    assert task["owner_id"] == ids["Alice"] and task["status"] == "claimed" and task["verify"] == "unit"
    assert queued(svc, rid) == [ids["Alice"]]
    assert "Jev가 할 일" in svc.snapshot(rid)["messages"][-1]["content"]


@pytest.fixture
def acp_room(tmp_path, repo):
    settings = Settings(db_path=tmp_path / "acp.db")
    db = Database(settings.db_path)
    db.initialize()
    svc = TaskService(db, settings)
    rid = svc.create_room("room", repo=repo)["id"]
    ids = {name: svc.create_agent(rid, name, "backend", good_at)["id"]
           for name, good_at in (("A", ["API"]), ("B", ["UI"]))}
    # 폴더 저장소가 서버의 검증 프로필 두 개를 허용하는 acp 모드로 바꾼다.
    settings.mode = "acp"
    svc.runtime_config = SimpleNamespace(
        repositories={}, verifiers={"unit": Verification(("pytest",)), "e2e": Verification(("npm", "test"))})
    return svc, rid, ids


def test_jev_picks_owner_and_verification_profile(acp_room):
    svc, rid, ids = acp_room
    tid = svc.create_task(rid, "change", "", "", "")["id"]
    requests = []

    async def assign():
        jev = fake_jev({"owner": {"type": "choice", "choice": "B"},
                        "verify": {"type": "choice", "choice": "e2e"}}, requests=requests)
        try:
            return await Dispatcher(svc, jev).assign_task(tid)
        finally:
            await jev.close()

    task = run(assign)
    assert (task["owner_id"], task["verify"], task["status"]) == (ids["B"], "e2e", "claimed")
    questions = requests[0]["questions"]
    assert set(questions["owner"]["criteria"]) == {"A", "B"}
    assert set(questions["verify"]["criteria"]) == {"e2e", "unit"}


def test_human_chosen_verification_is_kept_and_invalid_jev_choice_falls_back(acp_room):
    svc, rid, ids = acp_room
    tid = svc.create_task(rid, "API 수정", "", "", "unit")["id"]
    requests = []

    async def assign():
        jev = fake_jev({"owner": {"type": "choice", "choice": "nobody"}}, requests=requests)
        try:
            return await Dispatcher(svc, jev).assign_task(tid)
        finally:
            await jev.close()

    task = run(assign)
    assert (task["owner_id"], task["verify"]) == (ids["A"], "unit")
    assert "verify" not in requests[0]["questions"]


def test_paused_room_and_assigned_tasks_are_not_assigned(room):
    svc, rid, _ = room
    tid = svc.create_task(rid, "task", "", "", "")["id"]
    svc.pause(rid, True)
    assert svc.tasks_to_assign() == []
    svc.pause(rid, False)
    assert svc.tasks_to_assign() == [tid]
    run(lambda: Dispatcher(svc).assign_task(tid))
    assert svc.tasks_to_assign() == []
    assert run(lambda: Dispatcher(svc).assign_task(tid)) is None


def test_chat_failure_release_counts_as_an_attempt(room):
    svc, rid, ids = room
    tid = svc.create_task(rid, "UI", "", "", "")["id"]
    run(lambda: Dispatcher(svc).assign_task(tid))
    sid = svc.snapshot(rid)["sessions"][0]["id"]
    with svc.db.connect(write=True) as c:
        c.execute("UPDATE sessions SET status='running' WHERE id=?", (sid,))
    svc.finish(sid, RuntimeResult(False, "boom"))
    task = next(t for t in svc.snapshot(rid)["tasks"] if t["id"] == tid)
    assert (task["status"], task["owner_id"], task["attempts"]) == ("open", None, 1)


def test_scheduler_assigns_and_finishes_mock_task(tmp_path):
    app = create_app(Settings(db_path=tmp_path / "e2e.db", fake_work_seconds=0.02, chat_delay_seconds=0.01))
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        rid = client.post("/api/rooms", json={"name": "demo"}).json()["id"]
        client.post(f"/api/rooms/{rid}/agents", json={"name": "A", "kind": "demo"})
        client.post(f"/api/rooms/{rid}/tasks", json={"title": "task"})
        deadline = time.time() + 5
        while time.time() < deadline:
            state = client.get(f"/api/rooms/{rid}/state").json()
            if state["tasks"][0]["status"] == "done":
                break
            time.sleep(0.05)
        task = state["tasks"][0]
        assert task["status"] == "done" and task["verify"] == "unit"


def test_chat_prompt_marks_only_the_chosen_responder(room):
    """다른 에이전트는 Jev가 맡긴 사람 질문을 for_you=false로 보고 중복 답을 하지 않는다."""
    from ycton.orchestration.services.prompt_builder import build_prompt
    svc, rid, ids = room
    routed = svc.post_message(rid, "버튼 색이 안 보여요")
    run(lambda: Dispatcher(svc).route_message(rid, routed["id"]))
    mentioned = svc.post_message(rid, "@Bob 이것도 봐 줘")

    def human_flags(agent):
        prompt = json.loads(build_prompt(svc, {"room_id": rid, "agent_id": ids[agent], "kind": "chat"}))
        return {m["id"]: m["for_you"] for m in prompt["messages"] if m["author"] == "human"}

    chosen = next(name for name, aid in ids.items()
                  if json.loads(svc.snapshot(rid)["messages"][0]["addressed_to"]) == [aid])
    for name in ids:
        flags = human_flags(name)
        assert flags[routed["id"]] is (name == chosen)
        assert flags[mentioned["id"]] is (name == "Bob")


def test_resume_wakes_the_responder_of_a_message_sent_while_paused(room):
    svc, rid, ids = room
    svc.pause(rid, True)
    posted = svc.post_message(rid, "@Bob 계획 문서 확인해 줘")
    assert not posted["needs_routing"] and queued(svc, rid) == []
    svc.pause(rid, False)
    assert queued(svc, rid) == [ids["Bob"]]


def test_resume_skips_a_responder_who_already_answered(room):
    svc, rid, ids = room
    svc.post_message(rid, "@Bob 계획 문서 확인해 줘")
    svc.post_message(rid, "확인했습니다", ids["Bob"])
    with svc.db.connect(write=True) as c:
        c.execute("DELETE FROM sessions")
    svc.pause(rid, True)
    svc.pause(rid, False)
    assert queued(svc, rid) == []
