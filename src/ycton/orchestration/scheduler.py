"""DB 대기열을 실행기로 전달한다. 배정이 아니라 실행 순서·한도·시간 제한을 관리한다."""
import asyncio
import logging
from ycton.orchestration.runtime_port import RuntimeRequest, RuntimeResult
from ycton.orchestration.services.prompt_builder import build_prompt
from ycton.orchestration.services.task_service import require

logger = logging.getLogger(__name__)


class Scheduler:
    def __init__(self, service, runtime, settings):
        self.service, self.runtime, self.settings = service, runtime, settings
        self.running = {}
        self.manual_cancels: dict[str, asyncio.Task[None]] = {}
        self.loop_task = None

    def start(self):
        self.loop_task = asyncio.create_task(self.loop())

    async def stop(self):
        if self.loop_task:
            self.loop_task.cancel()
            await asyncio.gather(self.loop_task, return_exceptions=True)
        tasks = list(self.running.values())
        for session_id, task in self.running.items():
            if session_id not in self.manual_cancels:
                task.cancel()
        await asyncio.gather(*tasks, *self.manual_cancels.values(), return_exceptions=True)

    async def loop(self):
        while True:
            try:
                self.dispatch()
            except Exception:
                logger.exception("스케줄러 틱 실패; 다음 틱에 재시도")
            await asyncio.sleep(self.settings.tick_seconds)

    def dispatch(self):
        to_run = []
        with self.service.db.connect(write=True) as c:
            queued = c.execute("""SELECT s.* FROM sessions s JOIN rooms r ON r.id=s.room_id
                                  WHERE s.status='queued' AND r.paused=0 ORDER BY s.rowid""").fetchall()
            for row in queued:
                s = dict(row)
                room = require(c, "rooms", s["room_id"])
                if s["kind"] == "chat" and room["chat_rounds"] >= self.settings.max_chat_rounds:
                    continue
                count = c.execute("SELECT count(*) FROM sessions WHERE kind=? AND status='running'", (s["kind"],)).fetchone()[0]
                limit = self.settings.max_chat if s["kind"] == "chat" else self.settings.max_work
                busy = c.execute("SELECT 1 FROM sessions WHERE kind=? AND agent_id=? AND status='running'",
                                 (s["kind"], s["agent_id"])).fetchone()
                if count >= limit or busy:
                    continue
                c.execute("UPDATE sessions SET status='running' WHERE id=?", (s["id"],))
                if s["kind"] == "chat":
                    c.execute("UPDATE rooms SET chat_rounds=chat_rounds+1 WHERE id=?", (s["room_id"],))
                to_run.append(s)
        for s in to_run:
            task = asyncio.create_task(self.execute(s))
            self.running[s["id"]] = task
            task.add_done_callback(lambda finished, sid=s["id"]: self.running.pop(sid, None))

    async def execute(self, session):
        session_id = session["id"]
        try:
            with self.service.db.connect() as c:
                agent = require(c, "agents", session["agent_id"])
                room = require(c, "rooms", session["room_id"])
            request = RuntimeRequest(
                session_id=session_id, room_id=session["room_id"], agent_id=session["agent_id"],
                kind=session["kind"], prompt=build_prompt(self.service, session), agent_kind=agent["kind"],
                repository_id=room["repository_id"], repo=room["repo"], task_id=session["task_id"],
                model=agent["model"], effort=agent["effort"],
            )
            async with asyncio.timeout(self.settings.timeout_seconds):
                result = await self.runtime.run(request)
        except asyncio.CancelledError:
            if session_id not in self.manual_cancels:
                self.service.finish(session_id, RuntimeResult(False, "서버 종료로 실행 중단"), cancelled=True)
            raise
        except TimeoutError:
            result = RuntimeResult(False, "실행 시간 제한 초과")
        except Exception as exc:
            logger.exception("실행 실패: %s", session["id"])
            result = RuntimeResult(False, f"실행기 오류: {type(exc).__name__}")
        if session_id not in self.manual_cancels:
            self.service.finish(session_id, result)

    async def cancel(self, session_id):
        with self.service.db.connect() as c:
            session = require(c, "sessions", session_id)
        if session["status"] not in ("queued", "running"):
            return
        completion = self.manual_cancels.get(session_id)
        if completion is None:
            execution = self.running.get(session_id)
            if execution is None:
                self._finish_manual_cancel(session)
                return
            execution.cancel()
            completion = asyncio.create_task(self._join_manual_cancel(session, execution))
            self.manual_cancels[session_id] = completion
        await asyncio.shield(completion)

    async def _join_manual_cancel(self, session, execution: asyncio.Task):
        try:
            await asyncio.gather(execution, return_exceptions=True)
            self._finish_manual_cancel(session)
        finally:
            self.manual_cancels.pop(session["id"])

    def _finish_manual_cancel(self, session):
        self.service.finish(session["id"], RuntimeResult(False, "사용자가 실행을 취소했습니다"),
                            cancelled=True, hold_for_retry=session["kind"] == "work")
