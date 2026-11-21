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
