"""Jev가 사람 메시지에 답할 에이전트, 할 일 담당, 검증 프로필을 정한다.

Jev(OpenRouter)가 없거나 판단에 실패하면 규칙으로 정해서 흐름이 멈추지 않게 한다.
"""
import asyncio
import json
import logging

from ycton.orchestration.services.task_service import DomainError

logger = logging.getLogger(__name__)


def agent_option(agent):
    good_at = ", ".join(json.loads(agent["good_at"])) or "정해진 강점 없음"
    return f"{agent['kind']} 에이전트. 잘하는 일: {good_at}"


def strength_match(agent, text):
    return sum(1 for skill in json.loads(agent["good_at"]) if skill and skill.lower() in text.lower())


class Dispatcher:
    def __init__(self, service, jev=None):
        self.service, self.jev = service, jev
        self.assigning: dict[int, asyncio.Task[None]] = {}
        self.continuing: dict[int, asyncio.Task[None]] = {}

    async def route_message(self, room_id, message_id):
        """멘션이나 답장 대상이 없는 사람 메시지에 답할 에이전트 하나를 깨운다."""
        context = self.service.routing_context(room_id, message_id)
        agents = context["agents"]
        if not agents:
            return None
        by_name = {agent["name"]: agent for agent in agents}
        picked = None
        if self.jev is not None and len(agents) > 1:
            answers = await self.jev.decide(
                {"message": context["message"]["content"], "recent_messages": context["recent"]},
                {"responder": {
                    "type": "choice",
                    "instructions": "Pick the one agent who should answer the latest human message. "
                                    "Prefer the agent whose strengths fit the request, "
                                    "or the agent the human is already talking with.",
                    "criteria": {name: agent_option(agent) for name, agent in by_name.items()},
                }})
            if answers is not None:
                picked = by_name[answers["responder"]]
        if picked is None:
            picked = self.fallback_responder(context)
        self.service.route_message(room_id, message_id, picked["id"])
        return picked["id"]

    @staticmethod
    def fallback_responder(context):
        """이전 대화 상대를 이어 간다. 없으면 강점이 맞는 에이전트, 그것도 없으면 먼저 들어온 에이전트."""
        agents = {agent["id"]: agent for agent in context["agents"]}
        for message in reversed(context["recent"]):
            if message["agent_id"] in agents:
                return agents[message["agent_id"]]
        text = context["message"]["content"]
        return max(context["agents"], key=lambda agent: (strength_match(agent, text), -agent["id"]))

    def continue_idle(self):
        """스케줄러 틱마다 조용해진 방에서 Jev에게 다음 단계가 남았는지 묻는다. Jev가 없으면 사람을 기다린다."""
        if self.jev is None:
            return
        for room_id in self.service.idle_rooms():
            if room_id not in self.continuing:
                task = self.continuing[room_id] = asyncio.create_task(self.check_idle(room_id))
                task.add_done_callback(lambda finished, rid=room_id: self.continuing.pop(rid, None))

    async def check_idle(self, room_id):
        context = self.service.idle_context(room_id)
        # 판단 결과와 상관없이 같은 대화로 다시 묻지 않는다.
        self.service.mark_idle_checked(room_id, context["last_message"])
        by_name = {agent["name"]: agent for agent in context["agents"]}
        answers = await self.jev.decide(
            {"recent_messages": context["recent"], "tasks": context["tasks"]},
            {"next": {
                "type": "choice",
                "instructions": "The team is idle. Decide whether work toward the human's latest request or goal "
                                "is still left and the agents should continue without asking the human.",
                "criteria": {
                    "continue": "Steps the agents proposed, follow-ups, fixes or reviews are still left and "
                                "need no human decision.",
                    "wait": "The request is done, or the next step needs the human's decision or answer.",
                }},
             "agent": {
                "type": "choice",
                "instructions": "If the agents continue, pick the one agent who should plan the next step.",
                "criteria": {name: agent_option(agent) for name, agent in by_name.items()},
             }})
        if answers is None or answers["next"] != "continue":
            return None
        agent = by_name[answers["agent"]]
        try:
            handed = self.service.hand_off(room_id, agent["id"], context["last_message"])
        except DomainError as exc:
            logger.info("방 %s 다음 단계 건너뜀: %s", room_id, exc.message)
            return None
        return agent["id"] if handed else None

    def assign_open(self):
        """스케줄러 틱마다 담당이 없는 할 일의 배정을 시작한다. 할 일마다 판단은 하나만 돈다."""
        for task_id in self.service.tasks_to_assign():
            if task_id not in self.assigning:
                task = self.assigning[task_id] = asyncio.create_task(self.assign_task(task_id))
                task.add_done_callback(lambda finished, tid=task_id: self.assigning.pop(tid, None))

    async def assign_task(self, task_id):
        context = self.service.assignment_context(task_id)
        if context is None:
            return None
        task, agents, profiles = context["task"], context["agents"], context["profiles"]
        by_name = {agent["name"]: agent for agent in agents}
        owner, verify = None, task["verify"] or None
        questions = {}
        if len(agents) > 1:
            questions["owner"] = {
                "type": "choice",
                "instructions": "Pick the one agent who should own this task. Prefer matching strengths, "
                                "then the agent with fewer tasks in progress.",
                "criteria": {name: f"{agent_option(agent)} 진행 중인 할 일 {agent['load']}개"
                             for name, agent in by_name.items()},
            }
        if verify is None and len(profiles) > 1:
            questions["verify"] = {
                "type": "choice",
                "instructions": "Pick the verification profile the server should run after the work is committed.",
                "criteria": dict.fromkeys(profiles),
            }
        if self.jev is not None and questions:
            answers = await self.jev.decide(
                {"task": {key: task[key] for key in ("title", "detail", "scope")}}, questions)
            if answers is not None:
                owner = by_name.get(answers.get("owner"))
                verify = verify or answers.get("verify")
        if owner is None:
            text = f"{task['title']}\n{task['detail']}"
            owner = max(agents, key=lambda agent: (strength_match(agent, text), -agent["load"], -agent["id"]))
        verify = verify or context["default_verify"]
        try:
            return self.service.assign(task_id, owner["id"], verify)
        except DomainError as exc:
            # 판단하는 사이 사람이 멈추거나 할 일이 바뀌었다. 다음 틱이 다시 본다.
            logger.info("할 일 #%s 배정 건너뜀: %s", task_id, exc.message)
            return None

    async def close(self):
        for task in self.assigning.values():
            task.cancel()
        for task in self.continuing.values():
            task.cancel()
        await asyncio.gather(*self.assigning.values(), *self.continuing.values(), return_exceptions=True)
