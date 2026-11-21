"""SQLite 스키마와 트랜잭션. 쓰기는 BEGIN IMMEDIATE로 순서를 보장한다."""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOM_REPOSITORY = "repository_id TEXT NOT NULL DEFAULT 'default'"
# 폴더 선택 창으로 연결한 Git 저장소의 절대 경로. 비어 있으면 repository_id의 설정 저장소를 쓴다.
ROOM_FOLDER = "repo TEXT"
# 마지막 사람 메시지 이후 에이전트가 스스로 만든 할 일 수. 사람 메시지가 오면 0으로 돌아간다.
ROOM_AUTO_TASKS = "auto_tasks INTEGER NOT NULL DEFAULT 0"
# Jev가 '다음 단계가 남았나'를 마지막으로 본 시점의 메시지 ID. 새 메시지가 없으면 다시 묻지 않는다.
ROOM_IDLE_CHECKED = "idle_checked_message INTEGER NOT NULL DEFAULT 0"
TASK_RETRY = "retry_required INTEGER NOT NULL DEFAULT 0 CHECK(retry_required IN (0,1))"
MESSAGE_REPLY = "reply_to_message_id INTEGER REFERENCES messages(id)"
# 사람 메시지에 답할 에이전트 ID 목록(JSON). @이름, 답장 대상, Jev의 선택으로 정해진다.
MESSAGE_ADDRESSED = "addressed_to TEXT NOT NULL DEFAULT '[]'"
# 사람이 답장 없이 처리했다고 표시한 질문. 처리할 일 목록에서 빠진다.
MESSAGE_RESOLVED = "resolved INTEGER NOT NULL DEFAULT 0"
# 검토처럼 파일을 바꿀 필요가 없는 작업 세션이 남긴 이유. 있으면 커밋 없이도 완료로 본다.
SESSION_NO_CHANGES = "no_changes TEXT"

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS rooms (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
 chat_rounds INTEGER NOT NULL DEFAULT 0, {ROOM_REPOSITORY}, {ROOM_FOLDER}, {ROOM_AUTO_TASKS}, {ROOM_IDLE_CHECKED}
);
CREATE TABLE IF NOT EXISTS agents (
 id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
 name TEXT NOT NULL, kind TEXT NOT NULL, good_at TEXT NOT NULL,
 model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '',
 UNIQUE(room_id, name)
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
 author TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 {MESSAGE_REPLY}, {MESSAGE_ADDRESSED}, {MESSAGE_RESOLVED}
);
CREATE TABLE IF NOT EXISTS tasks (
 id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
 title TEXT NOT NULL, detail TEXT NOT NULL, scope TEXT NOT NULL, verify TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','claimed','done','dropped')),
 owner_id INTEGER REFERENCES agents(id), active_session_id TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, handoff TEXT NOT NULL DEFAULT '', commit_hash TEXT,
 {TASK_RETRY},
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
            # 모델과 추론 수준 열이 생기기 전에 만든 DB를 이어서 쓴다
            columns = {row[1] for row in conn.execute("PRAGMA table_info(agents)")}
            for column in ("model", "effort"):
                if column not in columns:
                    conn.execute(f"ALTER TABLE agents ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
            conn.commit()
        finally:
            conn.close()
        with self.connect(write=True) as conn:
            for table, column in (("rooms", ROOM_REPOSITORY), ("rooms", ROOM_FOLDER), ("rooms", ROOM_AUTO_TASKS),
                                  ("rooms", ROOM_IDLE_CHECKED),
                                  ("tasks", TASK_RETRY), ("messages", MESSAGE_REPLY),
                                  ("messages", MESSAGE_ADDRESSED), ("messages", MESSAGE_RESOLVED),
                                  ("sessions", SESSION_NO_CHANGES)):
                if not any(row["name"] == column.split(" ", 1)[0]
                           for row in conn.execute(f"PRAGMA table_info({table})")):
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column}")
                    if column == ROOM_IDLE_CHECKED:
                        # 업그레이드한 방을 지난 대화로 깨우지 않는다. 다음 새 메시지부터 Jev가 본다.
                        conn.execute("""UPDATE rooms SET idle_checked_message=COALESCE(
                                        (SELECT max(id) FROM messages m WHERE m.room_id=rooms.id), 0)""")
            conn.execute("CREATE INDEX IF NOT EXISTS messages_room ON messages(room_id, id)")
            conn.execute("CREATE INDEX IF NOT EXISTS messages_reply ON messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL")

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
