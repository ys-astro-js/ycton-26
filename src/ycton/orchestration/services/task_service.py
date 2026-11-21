"""상태 변경의 단일 진입점. 모든 변경·이력·메시지를 같은 트랜잭션에 저장한다."""
import json
import sqlite3
import subprocess
from pathlib import Path
from uuid import uuid4

from ycton.orchestration.folders import FolderError, git_root
from ycton.orchestration.git_commit import CommitError, commit_paths
from ycton.orchestration.runtime_config import Repository, read_catalog
from ycton.orchestration.runtime_port import RuntimeResult
from ycton.subprocess_env import child_environment

# mock 모드에 runtime.toml이 없을 때 고를 모델을 저장소의 예시 설정에서 가져온다.
EXAMPLE_RUNTIME_CONFIG = Path(__file__).resolve().parents[4] / "runtime.example.toml"

UNKNOWN_REPOSITORY = "서버 설정에 없는 저장소입니다"
MISSING_FOLDER = "연결한 폴더를 찾을 수 없습니다"
UNAVAILABLE_VERIFICATION = "이 프로젝트에서 사용할 수 없는 검증 프로필입니다"
RETRY_REQUIRED = "사용자가 중단한 작업입니다. 다시 실행이 필요합니다"


class DomainError(Exception):
    def __init__(self, message, status=409):
        self.message, self.status = message, status


def require(conn, table, identifier):
    # table은 아래 코드의 상수만 사용한다. 외부 입력을 전달하면 안 된다.
    row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (identifier,)).fetchone()
    if row is None:
        raise DomainError(f"{table}: 항목을 찾을 수 없습니다", 404)
    return dict(row)


class TaskService:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings
        # 어댑터가 알려 준 모델 표시 이름. 별칭(opus)이 가리키는 실제 버전(Opus 5.5)을 보여 주려고 쓴다.
        self.model_names = {}

    @staticmethod
    def message(conn, room, author, content):
        conn.execute("INSERT INTO messages(room_id,author,content) VALUES(?,?,?)", (room, author, content))

    @staticmethod
    def event(conn, task, event, detail):
        conn.execute("INSERT INTO task_events(task_id,event,detail) VALUES(?,?,?)", (task, event, detail))

    def wake(self, conn, room_id, agent_id=None, reset=False):
        """같은 에이전트의 대기 턴은 하나로 합친다. 실행 중에도 다음 턴 하나 예약 가능."""
        if reset:
            conn.execute("UPDATE rooms SET chat_rounds=0 WHERE id=?", (room_id,))
        room = require(conn, "rooms", room_id)
        if room["paused"] or room["chat_rounds"] >= self.settings.max_chat_rounds:
            return
        agents = conn.execute("SELECT id FROM agents WHERE room_id=?", (room_id,)).fetchall()
        for agent in agents:
            if agent_id is not None and agent["id"] != agent_id:
                continue
            conn.execute("""INSERT OR IGNORE INTO sessions(id,room_id,agent_id,kind,status)
                            VALUES(?,?,?,'chat','queued')""", (str(uuid4()), room_id, agent["id"]))

    def _require_repository(self, repository_id: str) -> Repository | None:
        if self.settings.mode == "acp":
            repository = self.runtime_config.repositories.get(repository_id)
            if repository is not None:
                return repository
        elif repository_id == "default":
            return None
        raise DomainError(UNKNOWN_REPOSITORY, 422)

    def folder_repository(self, path):
        """폴더 선택으로 연결한 저장소. 검증 프로필은 서버에 등록된 것을 모두 허용한다. mock 모드는 None."""
        if not Path(path).is_dir():
            raise DomainError(MISSING_FOLDER, 422)
        if self.settings.mode != "acp":
            return None
        return Repository(Path(path), Path(path).name, *self.folder_profiles())

    def folder_profiles(self):
        """폴더 선택으로 연결한 프로젝트의 검증 프로필 허용 목록과 기본값. 서버에 등록된 것을 모두 허용한다."""
        profiles = tuple(sorted(self.runtime_config.verifiers))
        return profiles, "unit" if "unit" in profiles else profiles[0]

    def room_repository(self, room):
        """방이 쓰는 저장소. 고른 폴더가 있으면 그것을, 없으면 설정의 repository_id를 쓴다."""
        if room.get("repo"):
            return self.folder_repository(room["repo"])
        return self._require_repository(room["repository_id"])

    def room_path(self, room):
        """화면에 Git 정보를 보일 저장소 경로. mock 모드의 기본 저장소처럼 실제 폴더가 없으면 None."""
        if room.get("repo"):
            return room["repo"]
        config = getattr(self, "runtime_config", None)
        repository = config.repositories.get(room["repository_id"]) if config else None
        return str(repository.path) if repository else None

    def project_folder(self, folder):
        """프로젝트로 연결할 Git 저장소 최상위 경로. 커밋이 없거나 작업 폴더와 겹치면 거절한다."""
        try:
            repo = git_root(folder)
        except FolderError as exc:
            raise DomainError(exc.message, exc.status)
        head = subprocess.run(["git", "-C", repo, "rev-parse", "--verify", "HEAD"],
                              env=child_environment(), capture_output=True, timeout=10)
        if head.returncode != 0:
            raise DomainError("커밋이 하나도 없는 저장소입니다. 첫 커밋을 만든 뒤 다시 고르세요", 422)
        config = getattr(self, "runtime_config", None)
        if config is not None:
            root = Path(repo)
            if any(p.is_relative_to(root) or root.is_relative_to(p) for p in (config.worktrees, config.logs)):
                raise DomainError("작업 worktree나 로그 폴더와 겹치는 폴더는 연결할 수 없습니다", 422)
        return repo

    def runtime_options(self):
        if self.settings.mode == "mock":
            return {
                "mode": "mock", "agent_kinds": ["backend", "demo", "frontend"],
                "default_agent_kind": "demo", "default_repository_id": "default",
                "repositories": [
                    {"id": "default", "label": "모의 실행", "verification_profiles": ["unit"],
                     "default_verification_profile": "unit"},
                ],
                "folder": {"verification_profiles": ["unit"], "default_verification_profile": "unit"},
            }
        kinds = sorted(self.runtime_config.kinds)
        repos = self.runtime_config.repositories
        folder_profiles, folder_default = self.folder_profiles()
        return {
            "mode": self.settings.mode,
            "agent_kinds": kinds,
            "default_agent_kind": "backend" if "backend" in kinds else kinds[0],
            "default_repository_id": "default" if "default" in repos else next(iter(sorted(repos)), None),
            "repositories": [
                {"id": key, "label": repos[key].label,
                 "verification_profiles": list(repos[key].verification_profiles),
                 "default_verification_profile": repos[key].default_verification_profile}
                for key in sorted(repos, key=lambda key: (key != "default", key))
            ],
            # 폴더 선택으로 연결한 프로젝트가 쓸 수 있는 검증 프로필
            "folder": {"verification_profiles": list(folder_profiles), "default_verification_profile": folder_default},
        }

    def create_room(self, name, repository_id="default", repo=None):
        if repo is not None:
            # 고른 폴더를 쓰는 방은 설정 저장소 ID를 비워 둔다. 설정 ID는 빈 문자열이 될 수 없어 겹치지 않는다.
            repo, repository_id = self.project_folder(repo), ""
        else:
            self._require_repository(repository_id)
        with self.db.connect(write=True) as c:
            rid = c.execute("INSERT INTO rooms(name,repository_id,repo) VALUES(?,?,?)",
                            (name, repository_id, repo)).lastrowid
            return require(c, "rooms", rid)

    def agent_models(self):
        """사람이 고를 수 있는 제공자, 모델, 추론 수준. 실행 명령은 내보내지 않는다."""
        if self.settings.mode == "acp":
            return [{"id": name, "label": kind.label or name, "models": kind.models, "efforts": kind.efforts,
                     "model_labels": {m: n for m, n in self.model_names.get(name, {}).items() if m in kind.models}}
                    for name, kind in self.runtime_config.kinds.items()]
        for path in (Path(self.settings.runtime_config), EXAMPLE_RUNTIME_CONFIG):
            if path.is_file():
                return read_catalog(path)
        return []

    def create_agent(self, room_id, name, kind, good_at, model="", effort=""):
        if self.settings.mode == "acp" and kind not in self.runtime_config.kinds:
            raise DomainError("서버 설정에 없는 모델 제공자입니다", 422)
        provider = next((p for p in self.agent_models() if p["id"] == kind), None)
        if provider is not None:
            if provider["models"] and model not in provider["models"]:
                raise DomainError("이 제공자에 없는 모델입니다", 422)
            if provider["efforts"] and effort not in provider["efforts"]:
                raise DomainError("이 모델에 없는 추론 수준입니다", 422)
        with self.db.connect(write=True) as c:
            room = require(c, "rooms", room_id)
            self.room_repository(room)
            try:
                aid = c.execute("INSERT INTO agents(room_id,name,kind,model,effort,good_at) VALUES(?,?,?,?,?,?)",
                                (room_id, name, kind, model, effort, json.dumps(good_at, ensure_ascii=False))).lastrowid
            except sqlite3.IntegrityError as exc:
                raise DomainError("방 안에서 에이전트 이름이 중복됩니다") from exc
            self.wake(c, room_id, reset=True)
            return require(c, "agents", aid)

    def post_message(self, room_id, content, agent_id=None):
        with self.db.connect(write=True) as c:
            require(c, "rooms", room_id)
            author = "human"
            if agent_id is not None:
                agent = require(c, "agents", agent_id)
                if agent["room_id"] != room_id:
                    raise DomainError("다른 방의 에이전트입니다", 403)
                author = f"agent:{agent_id}"
            self.message(c, room_id, author, content)
            self.wake(c, room_id, reset=agent_id is None)

    def create_task(self, room_id, title, detail, scope, verify):
        with self.db.connect(write=True) as c:
            room = require(c, "rooms", room_id)
            repo = self.room_repository(room)
            if repo is not None and verify not in repo.verification_profiles:
                raise DomainError(UNAVAILABLE_VERIFICATION, 422)
            tid = c.execute("INSERT INTO tasks(room_id,title,detail,scope,verify) VALUES(?,?,?,?,?)",
                            (room_id, title, detail, scope, verify)).lastrowid
            self.event(c, tid, "created", title)
            self.message(c, room_id, "system", f"할 일 #{tid} 등록: {title}")
            self.wake(c, room_id, reset=True)
            return require(c, "tasks", tid)

    def claim(self, task_id, agent_id):
        with self.db.connect(write=True) as c:
            task = require(c, "tasks", task_id)
            agent = require(c, "agents", agent_id)
            room = require(c, "rooms", task["room_id"])
            if agent["room_id"] != task["room_id"]:
                raise DomainError("다른 방의 작업입니다", 403)
            if room["paused"]:
                raise DomainError("자동 진행이 중지된 방입니다")
            if task["retry_required"]:
                raise DomainError(RETRY_REQUIRED)
            if task["attempts"] >= self.settings.max_attempts:
                raise DomainError("재시도 한도 도달: 사람이 retry로 재개해야 합니다")
            changed = c.execute("""UPDATE tasks SET status='claimed',owner_id=?
                                   WHERE id=? AND status='open' AND retry_required=0""", (agent_id, task_id)).rowcount
            if not changed:
                raise DomainError("이미 담당자가 있거나 종료된 작업입니다")
            self.event(c, task_id, "claimed", f"agent:{agent_id}")
            self.message(c, task["room_id"], "system", f"{agent['name']}이 할 일 #{task_id}을 맡았습니다")
            return require(c, "tasks", task_id)

    def release(self, task_id, agent_id, note):
        with self.db.connect(write=True) as c:
            task = require(c, "tasks", task_id)
            if task["status"] != "claimed" or task["owner_id"] != agent_id:
                raise DomainError("현재 담당자만 반납할 수 있습니다", 403)
            if task["active_session_id"]:
                raise DomainError("실행 중/대기 중 세션을 먼저 취소해야 합니다")
            c.execute("UPDATE tasks SET status='open',owner_id=NULL,handoff=? WHERE id=?", (note, task_id))
            self.event(c, task_id, "released", note)
            self.wake(c, task["room_id"])
            return require(c, "tasks", task_id)

    def delegate(self, task_id, agent_id, request_id, instruction):
        with self.db.connect(write=True) as c:
            task = require(c, "tasks", task_id)
            agent = require(c, "agents", agent_id)
            if agent["room_id"] != task["room_id"]:
                raise DomainError("다른 방의 작업입니다", 403)
            key = f"{agent_id}:{request_id}"
            old = c.execute("SELECT * FROM sessions WHERE request_key=?", (key,)).fetchone()
            if old:
                if old["task_id"] != task_id or old["instruction"] != instruction:
                    raise DomainError("같은 request_id를 다른 요청에 사용할 수 없습니다")
                return dict(old)
            if task["retry_required"]:
                raise DomainError(RETRY_REQUIRED)
            if task["status"] != "claimed" or task["owner_id"] != agent_id:
                raise DomainError("claim한 담당자만 위임할 수 있습니다", 403)
            if require(c, "rooms", task["room_id"])["paused"]:
                raise DomainError("자동 진행이 중지된 방입니다")
            if task["active_session_id"]:
                raise DomainError("이미 대기/실행 중인 작업 세션이 있습니다")
            if task["attempts"] >= self.settings.max_attempts:
                raise DomainError("재시도 한도에 도달했습니다")
            sid = str(uuid4())
            c.execute("""INSERT INTO sessions(id,room_id,agent_id,task_id,kind,status,instruction,request_key)
                         VALUES(?,?,?,?,'work','queued',?,?)""",
                      (sid, task["room_id"], agent_id, task_id, instruction, key))
            c.execute("UPDATE tasks SET active_session_id=?,attempts=attempts+1 WHERE id=?", (sid, task_id))
            self.event(c, task_id, "delegated", sid)
            return require(c, "sessions", sid)

    def commit_work(self, session_id, paths, message):
        """활성 작업 세션의 worktree에서 고른 파일만 커밋하고 해시를 세션에 기록한다."""
        with self.db.connect() as c:
            s = require(c, "sessions", session_id)
            if s["kind"] != "work" or s["status"] != "running":
                raise DomainError("실행 중인 작업 세션만 커밋할 수 있습니다", 403)
            task = require(c, "tasks", s["task_id"])
            if task["active_session_id"] != session_id:
                raise DomainError("이 할 일의 현재 작업 세션이 아닙니다", 403)
            agent = require(c, "agents", s["agent_id"])
        worktree = Path(s["worktree"] or "")
        if not s["worktree"] or not worktree.is_dir():
            raise DomainError("작업 worktree가 아직 없습니다")
        # git은 DB 트랜잭션 밖에서 실행한다. 커밋 작성자는 맡은 에이전트로 남긴다.
        try:
            commit = commit_paths(worktree, paths, message, f"{agent['name']} (ycton)",
                                  f"agent-{agent['id']}@ycton.local")
        except CommitError as exc:
            raise DomainError(str(exc), 422) from None
        with self.db.connect(write=True) as c:
            c.execute("UPDATE sessions SET commit_hash=? WHERE id=?", (commit, session_id))
            self.event(c, task["id"], "committed", f"{commit} {message.splitlines()[0]}")
        return commit

    def finish(self, session_id, result: RuntimeResult, *, cancelled=False, hold_for_retry=False):
        """중복 종료는 무시. 활성 실행 ID를 확인하여 오래된 결과의 덮어쓰기를 차단한다."""
        with self.db.connect(write=True) as c:
            s = require(c, "sessions", session_id)
            if s["status"] not in ("queued", "running"):
                return False
            summary = result.summary
            held = cancelled and hold_for_retry and s["kind"] == "work"
            if held:
                summary = "사용자가 실행을 중단했습니다. 다시 실행할 때까지 대기합니다."
            if s.get("worktree") and s["worktree"] not in summary:
                summary += f"\nworktree={s['worktree']}"
            success = result.succeeded and (s["kind"] == "chat" or result.verification == "passed")
            status = "cancelled" if cancelled else ("succeeded" if success else "failed")
            # commit 도구가 실행 중에 기록한 해시를 런타임 결과가 비어 있다고 지우지 않는다.
            commit = result.commit_hash or s["commit_hash"]
            if commit and commit not in summary:
                summary += f"\ncommit={commit}"
            c.execute("""UPDATE sessions SET status=?,summary=?,verification=?,commit_hash=?,log_path=COALESCE(?,log_path),
                         finished_at=CURRENT_TIMESTAMP WHERE id=?""",
                      (status, summary, result.verification, commit, result.log_path, session_id))
            if s["kind"] == "work":
                task = require(c, "tasks", s["task_id"])
                if task["active_session_id"] != session_id:
                    return False
                done = status == "succeeded"
                # 실패한 시도의 커밋은 인계 노트에만 남기고, 할 일에는 완료된 커밋만 연결한다.
                c.execute("""UPDATE tasks SET status=?,owner_id=?,active_session_id=NULL,handoff=?,
                             commit_hash=COALESCE(?,commit_hash),retry_required=? WHERE id=?""",
                          ("done" if done else "open", s["agent_id"] if done else None,
                           summary, commit if done else None, int(held), task["id"]))
                self.event(c, task["id"], status, summary)
                self.message(c, s["room_id"], "system", f"할 일 #{task['id']} {status}: {summary}")
                if not held:
                    self.wake(c, s["room_id"], agent_id=s["agent_id"], reset=True)
            else:
                # claim 이후 위임 전에 채팅이 실패하면 작업을 영구 점유하지 않게 반환한다.
                pending = c.execute("SELECT id FROM tasks WHERE owner_id=? AND status='claimed' AND active_session_id IS NULL", (s["agent_id"],)).fetchall()
                for row in pending:
                    if status != "succeeded":
                        c.execute("UPDATE tasks SET status='open',owner_id=NULL,handoff=? WHERE id=?", (summary, row["id"]))
                        self.event(c, row["id"], "chat_failed_release", summary)
                    self.wake(c, s["room_id"], agent_id=s["agent_id"] if status == "succeeded" else None)
                if status == "failed":
                    self.message(c, s["room_id"], "system", f"채팅 실행 실패: {summary}")
            return True

    def pause(self, room_id, paused):
        with self.db.connect(write=True) as c:
            room = require(c, "rooms", room_id)
            if not paused:
                self.room_repository(room)
            c.execute("UPDATE rooms SET paused=? WHERE id=?", (int(paused), room_id))
            if not paused:
                self.wake(c, room_id, reset=True)
            return require(c, "rooms", room_id)

    def manual_task_action(self, task_id, action, note):
        with self.db.connect(write=True) as c:
            task = require(c, "tasks", task_id)
            if task["active_session_id"] or task["status"] not in ("open", "claimed"):
                raise DomainError("활성 실행이 없고 종료되지 않은 작업에만 가능합니다")
            if action == "retry":
                c.execute("""UPDATE tasks SET status='open',owner_id=NULL,attempts=0,retry_required=0,handoff=?
                             WHERE id=?""", (note, task_id))
                self.message(c, task["room_id"], "system",
                             f"사용자가 할 일 #{task_id}의 다시 실행을 요청했습니다. 이 할 일을 다시 맡을 수 있습니다.")
            else:
                c.execute("""UPDATE tasks SET status='dropped',owner_id=NULL,retry_required=0,handoff=?
                             WHERE id=?""", (note, task_id))
            self.event(c, task_id, action, note)
            self.wake(c, task["room_id"], reset=True)
            return require(c, "tasks", task_id)

    def snapshot(self, room_id, *, dashboard=False):
        with self.db.connect() as c:
            result = {"room": require(c, "rooms", room_id)}
            for table in ("agents", "tasks", "sessions"):
                result[table] = [dict(r) for r in c.execute(f"SELECT * FROM {table} WHERE room_id=? ORDER BY rowid", (room_id,))]
            for agent in result["agents"]:
                agent["good_at"] = json.loads(agent["good_at"])
            result["messages"] = [dict(r) for r in c.execute(
                "SELECT * FROM (SELECT * FROM messages WHERE room_id=? ORDER BY id DESC LIMIT 100) ORDER BY id", (room_id,))]
            if dashboard:
                result["running_work"] = c.execute(
                    "SELECT count(*) FROM sessions WHERE kind='work' AND status='running'").fetchone()[0]
            return result

    def recover(self):
        """단일 서버 재시작 복구. 실제 프로세스 정리는 런타임 담당자가 먼저 보장해야 한다."""
        with self.db.connect() as c:
            active = [r["id"] for r in c.execute("SELECT id FROM sessions WHERE status IN ('queued','running')")]
        for sid in active:
            self.finish(sid, RuntimeResult(False, "서버 재시작으로 실행 중단. 재개 전 이전 프로세스 확인 필요"))
        with self.db.connect(write=True) as c:
            c.execute("UPDATE sessions SET status='cancelled',summary='재시작 복구' WHERE status='queued'")
            # 위임 전 중단된 claim도 사람이 다시 선택할 수 있게 반환한다.
            stranded = c.execute("SELECT id FROM tasks WHERE status='claimed' AND active_session_id IS NULL").fetchall()
            for row in stranded:
                c.execute("UPDATE tasks SET status='open',owner_id=NULL,handoff='서버 재시작으로 claim 반환' WHERE id=?", (row["id"],))
                self.event(c, row["id"], "recovered", "서버 재시작")
            # 부팅만으로 실작업이 재시작되지 않도록 기존 방은 일시 중지한다.
            c.execute("UPDATE rooms SET paused=1")

    def execution_metadata(self, session_id, **fields):
        """런타임 기록 전용. 컬럼 이름은 코드 상수 허용 목록으로 제한한다."""
        allowed = {"worktree", "log_path", "acp_session_id", "stop_reason", "verification_output", "latest_event"}
        if not fields or not fields.keys() <= allowed:
            raise ValueError("지원하지 않는 실행 메타데이터")
        with self.db.connect(write=True) as c:
            require(c, "sessions", session_id)
            setters = ",".join(f"{key}=?" for key in fields)
            c.execute(f"UPDATE sessions SET {setters} WHERE id=?", (*fields.values(), session_id))
