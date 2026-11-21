"""Dashboard actions should reflect server state without exposing raw runtime data."""
import sqlite3

from fastapi.testclient import TestClient

from ycton.orchestration import main
from ycton.orchestration.config import Settings

HEADERS = {"X-Orch-Client": "web"}


def test_reply_migration_keeps_unanswered_questions_beyond_timeline_window(tmp_path):
    path = tmp_path / "state.db"
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            CREATE TABLE rooms(id INTEGER PRIMARY KEY, name TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
                               chat_rounds INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE messages(id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
                                  author TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            INSERT INTO rooms(id,name) VALUES(1,'original'),(2,'other');
            INSERT INTO messages(id,room_id,author,content) VALUES(1,1,'agent:1','@human first?'),(2,1,'agent:1','@human second?');
        """)
    app = main.create_app(Settings(db_path=path), start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        with app.state.service.db.connect(write=True) as conn:
            conn.executemany("INSERT INTO messages(room_id,author,content) VALUES(1,'human',?)", [("later note",)] * 103)
        assert client.post("/api/rooms/1/messages", json={"content": "generic message"}).status_code == 201
        state = client.get("/api/rooms/1/state").json()
        assert state["messages"][0]["id"] > 2
        assert [question["id"] for question in state["unanswered_questions"]] == [1, 2]
        body = {"content": "answer to the second question", "reply_to_message_id": 2}
        assert client.post("/api/rooms/2/messages", json=body).status_code == 422
        assert client.post("/api/rooms/1/messages", json=body).status_code == 201
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        state = client.get("/api/rooms/1/state").json()
        assert [question["id"] for question in state["unanswered_questions"]] == [1]
        assert state["messages"][-1]["reply_to_message_id"] == 2


def test_only_explicit_human_mentions_are_questions_and_reply_targets(tmp_path):
    app = main.create_app(Settings(db_path=tmp_path / "mentions.db"), start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        svc = app.state.service
        room = svc.create_room("collaboration")["id"]
        author = svc.create_agent(room, "Frontend", "demo", [])["id"]
        svc.create_agent(room, "Backend", "demo", [])
        agent_messages = [
            "@Backend, could you do this?",
            "@all Check the build",
            "Email ops@human.example",
            "Install @human/tools",
            "An example: `@human`",
            "```text\n@human example\n```",
            r"Escaped \@human",
            "@humanized",
        ]
        human_question = "@Backend 보고 부탁해요. **@Human**, 기준을 알려주세요."
        for text in [*agent_messages, human_question]:
            svc.post_message(room, text, author)
        path = f"/api/rooms/{room}"
        assert client.post(f"{path}/messages", json={"content": "@human written by a person"}).status_code == 201
        state = client.get(f"{path}/state").json()
        assert [message["content"] for message in state["unanswered_questions"]] == [human_question]
        for message in state["messages"]:
            if message["content"] in agent_messages or message["author"] == "human":
                response = client.post(f"{path}/messages", json={"content": "Reply", "reply_to_message_id": message["id"]})
                assert response.status_code == 422, response.json()
        (question,) = state["unanswered_questions"]
        assert client.post(f"{path}/messages", json={"content": "Answer", "reply_to_message_id": question["id"]}).status_code == 201
        assert client.get(f"{path}/state").json()["unanswered_questions"] == []


def test_marking_a_question_done_removes_it_from_review(tmp_path):
    path = tmp_path / "state.db"
    app = main.create_app(Settings(db_path=path), start_scheduler=False)
    with TestClient(app, base_url="http://localhost", headers=HEADERS) as client:
        svc = app.state.service
        room = svc.create_room("room")["id"]
        agent = svc.create_agent(room, "A", "demo", [])["id"]
        svc.post_message(room, "@human 어느 쪽으로 할까요?", agent)
        svc.post_message(room, "그냥 일반 메시지", agent)
        questions = client.get(f"/api/rooms/{room}/state").json()["unanswered_questions"]
        assert len(questions) == 1
        other = client.get(f"/api/rooms/{room}/state").json()["messages"][-1]["id"]
        assert client.post(f"/api/messages/{other}/resolve", json={}).status_code == 422
        assert client.post(f"/api/messages/{questions[0]['id']}/resolve", json={}).status_code == 200
        assert client.get(f"/api/rooms/{room}/state").json()["unanswered_questions"] == []
