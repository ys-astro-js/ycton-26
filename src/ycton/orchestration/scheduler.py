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
        self.loop_task = None

    def start(self):
        self.loop_task = asyncio.create_task(self.loop())

    async def stop(self):
        if self.loop_task:
            self.loop_task.cancel()
            await asyncio.gather(self.loop_task, return_exceptions=True)
        tasks = list(self.running.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

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
        try:
            with self.service.db.connect() as c:
                agent = require(c, "agents", session["agent_id"])
            request = RuntimeRequest(session["id"], session["room_id"], session["agent_id"],
                                     session["kind"], build_prompt(self.service, session), agent["kind"], session["task_id"],
                                     agent["model"], agent["effort"])
            async with asyncio.timeout(self.settings.timeout_seconds):
                result = await self.runtime.run(request)
        except asyncio.CancelledError:
            self.service.finish(session["id"], RuntimeResult(False, "사용자 취소 또는 서버 종료"), cancelled=True)
            raise
        except TimeoutError:
            result = RuntimeResult(False, "실행 시간 제한 초과")
        except Exception as exc:
            logger.exception("실행 실패: %s", session["id"])
            result = RuntimeResult(False, f"실행기 오류: {type(exc).__name__}")
        self.service.finish(session["id"], result)

    async def cancel(self, session_id):
        task = self.running.get(session_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        # 시작 전 취소되었거나 대기 상태여도 상태를 마무리한다.
        self.service.finish(session_id, RuntimeResult(False, "사용자가 실행을 취소했습니다"), cancelled=True)
