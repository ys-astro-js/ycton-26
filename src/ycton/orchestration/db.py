"""SQLite 스키마와 트랜잭션. 쓰기는 BEGIN IMMEDIATE로 순서를 보장한다."""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
 chat_rounds INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS agents (
 id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
 name TEXT NOT NULL, kind TEXT NOT NULL, good_at TEXT NOT NULL,
 UNIQUE(room_id, name)
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
 author TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
 id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
 title TEXT NOT NULL, detail TEXT NOT NULL, scope TEXT NOT NULL, verify TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','claimed','done','dropped')),
 owner_id INTEGER REFERENCES agents(id), active_session_id TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, handoff TEXT NOT NULL DEFAULT '', commit_hash TEXT,
 CHECK((status='claimed' AND owner_id IS NOT NULL) OR status!='claimed')
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
 agent_id INTEGER NOT NULL REFERENCES agents(id), task_id INTEGER REFERENCES tasks(id),
 kind TEXT NOT NULL CHECK(kind IN ('chat','work')),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 instruction TEXT NOT NULL DEFAULT '', request_key TEXT UNIQUE,
 summary TEXT NOT NULL DEFAULT '', verification TEXT NOT NULL DEFAULT 'not_run',
 commit_hash TEXT, log_path TEXT, worktree TEXT, acp_session_id TEXT,
 stop_reason TEXT, verification_output TEXT, latest_event TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_work_per_task ON sessions(task_id)
 WHERE kind='work' AND status IN ('queued','running');
CREATE UNIQUE INDEX IF NOT EXISTS one_queued_chat_per_agent ON sessions(agent_id)
 WHERE kind='chat' AND status='queued';
CREATE TABLE IF NOT EXISTS task_events (
 id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id),
 event TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=5)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.executescript(SCHEMA)
        finally:
            conn.close()

    @contextmanager
    def connect(self, write=False):
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()
