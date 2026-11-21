"""Report scheduler constraints and request optional typed advice from OpenRouter Jev."""
import asyncio
import json
import logging
from dataclasses import dataclass
from time import monotonic

import httpx

DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
DECISION_INTERVAL = 30
CHOICES = {
    "wait": "Wait for existing agents or work slots. Prefer waiting when slots are full or not enough work is pending.",
    "spawn_suggested": "Recommend that a human add an agent. Prefer only when work can run and lacks enough agents.",
}
REASONS = {
    "wait": "현재 에이전트나 실행 자리가 비기를 기다리는 편이 좋습니다.",
    "spawn_suggested": "대기 중인 일을 처리할 에이전트를 추가하는 편이 좋습니다.",
}
logger = logging.getLogger(__name__)


def workload(state, settings):
    work = [s for s in state["sessions"] if s["kind"] == "work"]
    return {
        "unassigned_tasks": sum(t["status"] == "open" and not t["retry_required"]
                                and t["attempts"] < settings.max_attempts for t in state["tasks"]),
        "queued_work": sum(s["status"] == "queued" for s in work),
        "agents": len(state["agents"]),
        "busy_agents": len({s["agent_id"] for s in work if s["status"] == "running"}),
        "running_work": state["running_work"],
        "max_work": settings.max_work,
    }


def advise(paused, load):
    if paused:
        return {"action": "stop", "reason": "사용자가 자동 진행을 중지했습니다"}
    if load["unassigned_tasks"] and not load["agents"]:
        return {"action": "spawn_suggested", "reason": "열린 작업이 있지만 참여 에이전트가 없습니다"}
    if load["unassigned_tasks"] or load["queued_work"]:
        if load["running_work"] >= load["max_work"]:
            return {"action": "wait", "reason": "서버의 작업 실행 자리가 가득 찼습니다"}
        if load["agents"] and load["busy_agents"] == load["agents"]:
            return {"action": "wait", "reason": "모든 에이전트가 작업 중입니다"}
    return {"action": "go", "reason": "설정된 한도 안에서 진행할 수 있습니다"}


@dataclass
class Evaluation:
    load: dict[str, int]
    requested_at: float
    result: dict[str, str] | None = None


class OpenRouterJev:
    def __init__(self, api_key: str, model: str, *, transport: httpx.AsyncBaseTransport | None = None):
        self.model = model
        self.client = httpx.AsyncClient(headers={"Authorization": f"Bearer {api_key}"}, timeout=8, transport=transport)
        self.evaluations: dict[int, Evaluation] = {}
        self.running: dict[int, asyncio.Task[None]] = {}

    def recommendation(self, room_id: int, load: dict[str, int]):
        current = self.evaluations.get(room_id)
        if current is not None and current.load == load and current.result is not None:
            return current.result
        now = monotonic()
        if (room_id not in self.running and len(self.running) < 2
                and (current is None or now - current.requested_at >= DECISION_INTERVAL)):
            evaluation = self.evaluations[room_id] = Evaluation(load, now)
            self.running[room_id] = asyncio.create_task(self._evaluate(room_id, evaluation))
        return None

    async def _evaluate(self, room_id: int, evaluation: Evaluation):
        try:
            async with asyncio.timeout(8):
                response = await self.client.post(DECISIONS_URL, json={
                    "model": self.model,
                    "state": json.dumps(evaluation.load),
                    "questions": {"next_action": {
                        "type": "choice",
                        "instructions": "Recommend the next action for this project using only these workload counts.",
                        "criteria": CHOICES,
                    }},
                })
            response.raise_for_status()
            answer = response.json()["answers"]["next_action"]
            action = answer["choice"]
            if answer["type"] != "choice" or not isinstance(action, str) or action not in REASONS:
                raise ValueError("invalid Jev choice")
            evaluation.result = {"action": action, "reason": REASONS[action]}
        except (httpx.HTTPError, TimeoutError, ValueError, KeyError, TypeError) as exc:
            logger.warning("OpenRouter Jev 요청 실패: %s", type(exc).__name__)
        finally:
            self.running.pop(room_id)

    async def close(self):
        for task in self.running.values():
            task.cancel()
        await asyncio.gather(*self.running.values(), return_exceptions=True)
        await self.client.aclose()
