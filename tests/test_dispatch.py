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
from ycton.orchestration.services.task_service import DomainError, TaskService

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


def jev_route(svc, rid, message_id, answers, requests=None):
    async def route():
        jev = fake_jev(answers, requests=requests)
        try:
            return await Dispatcher(svc, jev).route_message(rid, message_id)
        finally:
            await jev.close()
    return run(route)


def joins(ids, yes):
    return {f"join_{aid}": {"type": "noul", "noul": 0.9 if name in yes else 0.1} for name, aid in ids.items()}


def test_jev_picks_one_responder_for_a_simple_question(room):
    svc, rid, ids = room
    posted = svc.post_message(rid, "지금 어디까지 됐어?")
    requests = []
    answers = {"mode": {"type": "choice", "choice": "answer"}, "lead": {"type": "choice", "choice": "Bob"},
               **joins(ids, [])}
    assert jev_route(svc, rid, posted["id"], answers, requests) == ids["Bob"]
    assert queued(svc, rid) == [ids["Bob"]]
    questions = requests[0]["questions"]
    assert set(questions["lead"]["criteria"]) == {"Al", "Alice", "Bob"} and questions["join_%d" % ids["Al"]]["type"] == "noul"
    assert json.loads(requests[0]["state"])["message"] == "지금 어디까지 됐어?"
    assert svc.discussion_view(rid, ids["Bob"]) is None


def test_discussion_runs_in_turns_and_ends_with_the_lead(room):
    svc, rid, ids = room
    posted = svc.post_message(rid, "로그인 화면을 어떻게 바꿀지 정해 보자")
    answers = {"mode": {"type": "choice", "choice": "discuss"}, "lead": {"type": "choice", "choice": "Alice"},
               **joins(ids, ["Alice", "Al"])}
    assert jev_route(svc, rid, posted["id"], answers) == ids["Alice"]
    assert queued(svc, rid) == [ids["Alice"]]
    assert svc.discussion_view(rid, ids["Alice"])["role"] == "open"
    assert svc.discussion_view(rid, ids["Bob"])["role"] == "listener"

    def turn(agent, text=None):
        with svc.db.connect(write=True) as c:
            c.execute("DELETE FROM sessions WHERE agent_id=?", (agent,))
            sid = str(__import__("uuid").uuid4())
            c.execute("INSERT INTO sessions(id,room_id,agent_id,kind,status) VALUES(?,?,?,'chat','running')", (sid, rid, agent))
        if text:
            svc.post_message(rid, text, agent)
        svc.finish(sid, RuntimeResult(True, "채팅 턴 종료"))

    turn(ids["Alice"], "첫 안: 대비를 높이자")
    assert queued(svc, rid) == [ids["Al"]] and svc.discussion_view(rid, ids["Al"])["role"] == "opinion"
    turn(ids["Al"])  # 말하지 않고 끝나도 차례는 넘어간다
    assert queued(svc, rid) == [ids["Alice"]] and svc.discussion_view(rid, ids["Alice"])["role"] == "conclude"
    turn(ids["Alice"], "결론: 대비를 높인다")
    assert queued(svc, rid) == [] and svc.discussion_view(rid, ids["Alice"]) is None


def test_new_human_message_ends_the_running_discussion(room):
    svc, rid, ids = room
    first = svc.post_message(rid, "구조를 정해 보자")
    svc.start_discussion(rid, first["id"], ids["Al"], [ids["Bob"]])
    assert svc.discussion_view(rid, ids["Al"])["role"] == "open"
    svc.post_message(rid, "그건 그만하고 다른 얘기")
    assert svc.discussion_view(rid, ids["Al"]) is None


def test_without_jev_a_message_becomes_a_discussion_led_by_one_agent(room):
    svc, rid, ids = room
    posted = svc.post_message(rid, "API 구조를 정하자")
    lead = run(lambda: Dispatcher(svc).route_message(rid, posted["id"]))
    assert lead == ids["Al"] and queued(svc, rid) == [ids["Al"]]
    view = svc.discussion_view(rid, ids["Al"])
    assert view["role"] == "open" and view["order"][0] == "Al" and len(view["order"]) == 3


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
    assert questions["verify"]["criteria"] == {"e2e": None, "unit": None}


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


def test_task_without_delegation_exhausts_attempt_budget_and_can_be_retried(tmp_path):
    class NoDelegation:
        async def run(self, request):
            assert request.kind == "chat"
            return RuntimeResult(True, "Chat ended without starting work")

    settings = Settings(db_path=tmp_path / "no-delegation.db", max_chat_rounds=1, max_attempts=1)
    app = create_app(settings, runtime_factory=lambda *_: NoDelegation())
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        rid = client.post("/api/rooms", json={"name": "room"}).json()["id"]
        client.post(f"/api/rooms/{rid}/agents", json={"name": "A", "kind": "demo"})
        tid = client.post(f"/api/rooms/{rid}/tasks", json={"title": "task"}).json()["id"]
        sid = f"/api/rooms/{rid}/state"
        for attempt in range(2):
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                state = client.get(sid).json()
                if state["tasks"][0]["attempts"] == 1:
                    break
                time.sleep(0.05)
            task = state["tasks"][0]
            assert state["max_attempts"] == task["attempts"] == 1
            assert task["status"] == "open" and task["owner_id"] is None and not task["active_session_id"]
            assert not any(session["kind"] == "work" for session in state["sessions"])
            assert "채팅 턴 한도" in task["handoff"]
            events = client.get(f"/api/tasks/{tid}/events").json()
            assert sum(event["event"] == "chat_failed_release" for event in events) == attempt + 1
            if not attempt:
                assert client.post(f"/api/tasks/{tid}/retry", json={"note": "retry"}).status_code == 200


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


def test_agent_tasks_stop_at_the_limit_until_a_human_speaks(room):
    svc, rid, ids = room
    svc.settings.max_auto_tasks = 2
    svc.post_message(rid, "로그인 화면 다듬어 줘")
    svc.create_agent_task(rid, "첫째", "")
    svc.create_agent_task(rid, "둘째", "")
    for _ in range(2):
        with pytest.raises(DomainError):
            svc.create_agent_task(rid, "셋째", "")
    notices = [m for m in svc.snapshot(rid)["messages"] if "한도(2개)" in m["content"]]
    assert len(notices) == 1
    svc.post_message(rid, "계속해")
    assert svc.create_agent_task(rid, "셋째", "")["title"] == "셋째"


def idle_ready(svc, rid, ids):
    svc.post_message(rid, "로그인 화면 다듬어 줘")
    svc.post_message(rid, "다음은 ① 대비 수정 ② 문구 정리입니다", ids["Alice"])
    with svc.db.connect(write=True) as c:
        c.execute("DELETE FROM sessions")


def test_idle_room_hands_the_next_step_to_the_agent_jev_picks(room):
    svc, rid, ids = room
    idle_ready(svc, rid, ids)
    assert svc.idle_rooms() == [rid]

    async def check():
        jev = fake_jev({
            "next": {"type": "choice", "choice": "continue"}, "agent": {"type": "choice", "choice": "Alice"}})
        try:
            return await Dispatcher(svc, jev).check_idle(rid)
        finally:
            await jev.close()

    assert run(check) == ids["Alice"]
    assert queued(svc, rid) == [ids["Alice"]]
    assert svc.snapshot(rid)["messages"][-1]["content"].startswith("@Alice Jev:")
    with svc.db.connect(write=True) as c:
        c.execute("DELETE FROM sessions")
    # 새 메시지가 없으면 같은 대화로 다시 묻지 않는다.
    assert svc.idle_rooms() == []


def test_idle_room_waits_when_jev_says_the_human_decides(room):
    svc, rid, ids = room
    idle_ready(svc, rid, ids)

    async def check():
        jev = fake_jev({
            "next": {"type": "choice", "choice": "wait"}, "agent": {"type": "choice", "choice": "Alice"}})
        try:
            return await Dispatcher(svc, jev).check_idle(rid)
        finally:
            await jev.close()

    assert run(check) is None
    assert queued(svc, rid) == [] and svc.idle_rooms() == []


def test_idle_check_skips_busy_rooms_and_rooms_waiting_on_a_human(room):
    svc, rid, ids = room
    idle_ready(svc, rid, ids)
    svc.wake_agents(rid, [ids["Bob"]])
    assert svc.idle_rooms() == []
    with svc.db.connect(write=True) as c:
        c.execute("DELETE FROM sessions")
    svc.post_message(rid, "잠깐, 이건 어때?")
    with svc.db.connect(write=True) as c:
        c.execute("DELETE FROM sessions")
    assert svc.idle_rooms() == []


def test_hand_off_counts_toward_the_limit_and_ignores_stale_decisions(room):
    svc, rid, ids = room
    idle_ready(svc, rid, ids)
    last = svc.idle_context(rid)["last_message"]
    svc.post_message(rid, "잠깐 기다려")
    assert svc.hand_off(rid, ids["Alice"], last) is False
    with svc.db.connect(write=True) as c:
        c.execute("DELETE FROM sessions")
    svc.post_message(rid, "확인했습니다", ids["Alice"])
    last = svc.idle_context(rid)["last_message"]
    svc.pause(rid, True)
    assert svc.hand_off(rid, ids["Alice"], last) is False
    svc.pause(rid, False)
    assert svc.hand_off(rid, ids["Alice"], last) is True
    assert svc.snapshot(rid)["room"]["auto_tasks"] == 1


def test_idle_skips_rooms_waiting_on_a_human_question_or_failed_chat(room):
    svc, rid, ids = room
    svc.post_message(rid, "로그인 화면 다듬어 줘")
    svc.post_message(rid, "@human 어느 색으로 할까요?", ids["Alice"])
    with svc.db.connect(write=True) as c:
        c.execute("DELETE FROM sessions")
        svc.message(c, rid, "system", "채팅 실행 실패: 런타임 오류")
    assert svc.idle_rooms() == []


def test_dismissed_question_unblocks_idle_handoff_but_later_agent_messages_do_not(room):
    svc, rid, ids = room
    idle_ready(svc, rid, ids)
    svc.post_message(rid, "@human 검증 범위를 알려주세요.", ids["Alice"])
    question = svc.snapshot(rid)["messages"][-1]["id"]
    svc.post_message(rid, "검증 범위를 정하기 전까지 초안은 준비했습니다.", ids["Bob"])
    last = svc.idle_context(rid)["last_message"]
    assert svc.idle_rooms() == []
    assert svc.hand_off(rid, ids["Alice"], last) is False
    svc.resolve_question(question)
    assert svc.idle_rooms() == [rid]
    assert svc.hand_off(rid, ids["Alice"], last) is True


def test_upgrade_does_not_wake_old_rooms(tmp_path):
    import sqlite3
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
                            chat_rounds INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE messages (id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL, author TEXT NOT NULL,
                               content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO rooms(id,name) VALUES(1,'old');
        INSERT INTO messages(room_id,author,content) VALUES(1,'human','옛 요청'),(1,'agent:1','옛 답');
    """)
    conn.commit()
    conn.close()
    db = Database(path)
    db.initialize()
    with db.connect() as c:
        assert c.execute("SELECT idle_checked_message FROM rooms WHERE id=1").fetchone()[0] == 2


def test_editing_an_agent_changes_its_details_and_keeps_names_unique(room):
    svc, rid, ids = room
    updated = svc.update_agent(ids["Bob"], "Bobby", "docs", ["문서", "검토"])
    assert updated["name"] == "Bobby" and json.loads(updated["good_at"]) == ["문서", "검토"]
    with pytest.raises(DomainError):
        svc.update_agent(ids["Bob"], "Alice", "docs", [])


def test_removed_agent_leaves_lists_and_its_tasks_go_back_to_jev(room):
    svc, rid, ids = room
    task = svc.create_task(rid, "문서 정리", "", "", "unit")["id"]
    svc.assign(task, ids["Bob"], "unit")
    svc.remove_agent(ids["Bob"])
    state = svc.snapshot(rid)
    assert "Bob" not in [a["name"] for a in state["agents"]]
    assert [a["name"] for a in state["removed_agents"]] == ["Bob"]
    assert state["tasks"][0]["status"] == "open" and state["tasks"][0]["owner_id"] is None
    assert ids["Bob"] not in queued(svc, rid)
    svc.post_message(rid, "@Bob 거기 있어?")
    assert ids["Bob"] not in queued(svc, rid)
    # 지운 에이전트의 이름은 새 에이전트가 다시 쓸 수 있다.
    assert svc.create_agent(rid, "Bob", "docs", [])["name"] == "Bob"


def test_agent_with_running_work_cannot_be_removed(room):
    svc, rid, ids = room
    task = svc.create_task(rid, "문서 정리", "", "", "unit")["id"]
    svc.assign(task, ids["Bob"], "unit")
    session = svc.delegate(task, ids["Bob"], "r1", "go")
    with svc.db.connect(write=True) as c:
        c.execute("UPDATE sessions SET status='running' WHERE id=?", (session["id"],))
    with pytest.raises(DomainError):
        svc.remove_agent(ids["Bob"])


def test_task_after_another_waits_until_that_task_finishes(room):
    svc, rid, ids = room
    plan = svc.create_task(rid, "기획", "", "", "unit")["id"]
    build = svc.create_agent_task(rid, "구현 1단계", "", after=plan)["id"]
    assert plan in svc.tasks_to_assign() and build not in svc.tasks_to_assign()
    svc.assign(plan, ids["Bob"], "unit")
    with svc.db.connect(write=True) as c:
        c.execute("UPDATE tasks SET status='done', handoff='계획: 1) 저장소 2) 화면' WHERE id=?", (plan,))
    assert build in svc.tasks_to_assign()
    tasks = {t["id"]: t for t in svc.idle_context(rid)["tasks"]}
    assert tasks[plan]["result"].startswith("계획") and tasks[build]["after"] == plan


def test_after_must_be_a_task_of_the_same_room(room):
    svc, rid, ids = room
    other = svc.create_room("other")["id"]
    foreign = svc.create_task(other, "남의 일", "", "", "unit")["id"]
    with pytest.raises(DomainError):
        svc.create_agent_task(rid, "구현", "", after=foreign)


def test_chat_prompt_lists_finished_tasks_with_results(room):
    from ycton.orchestration.services.prompt_builder import build_prompt
    svc, rid, ids = room
    done = svc.create_task(rid, "기획", "", "", "unit")["id"]
    svc.create_task(rid, "구현", "", "", "unit")
    with svc.db.connect(write=True) as c:
        c.execute("UPDATE tasks SET status='done', handoff='계획을 PLAN.md에 썼습니다' WHERE id=?", (done,))
    prompt = json.loads(build_prompt(svc, {"room_id": rid, "agent_id": ids["Al"], "kind": "chat"}))
    assert [(t["title"], t["result"]) for t in prompt["done_tasks"]] == [("기획", "계획을 PLAN.md에 썼습니다")]
    assert [t["title"] for t in prompt["tasks"]] == ["구현"]
