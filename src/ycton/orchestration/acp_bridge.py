"""담당 1의 실제 함수와 담당 2의 실행 계약을 연결한다. 완료 판정은 직접 검증한다."""
import asyncio
import json
from pathlib import Path

from ycton.acp_runtime import run_session
from ycton.work_session import WorkTask, run_work_session
from ycton.room_mcp import room_mcp_server
from ycton.agent_process import spawn_owned_agent
from ycton.subprocess_env import child_environment
from .runtime_port import RuntimeResult
from .identity import Identity
from .services.task_service import require
from .event_log import EventLog
from .runtime_config import Repository
from .services.task_service import DomainError, UNKNOWN_REPOSITORY, UNAVAILABLE_VERIFICATION


async def verify_worktree(profile, worktree):
    """서버가 정한 argv만 실행. 프롬프트/verify 문자열을 shell 명령으로 실행하지 않는다."""
    chunks = []
    size = 0
    async with spawn_owned_agent(*profile.command, cwd=Path(worktree), env=child_environment()) as process:
        process.stdin.close()
        async with asyncio.timeout(profile.timeout):
            while chunk := await process.stdout.read(8192):
                if size < 1_000_000:
                    chunks.append(chunk[:1_000_000 - size])
                    size += len(chunks[-1])
            await process.wait()
        output = b"".join(chunks).decode(errors="replace")
        passed = process.returncode == 0 and (not profile.contains or profile.contains in output)
        return passed, f"exit_code={process.returncode}\n{output}"


class AcpRuntime:
    def __init__(self, service, config, tokens):
        self.service, self.config, self.tokens = service, config, tokens

    @staticmethod
    def session_config(request):
        """에이전트에 고른 모델과 추론 수준을 ACP 세션 설정 항목의 분류 이름에 맞춘다."""
        return {category: value for category, value in (("model", request.model), ("thought_level", request.effort)) if value}

    async def run(self, request):
        if request.repo:
            try:
                repository = self.service.folder_repository(request.repo)
            except DomainError as exc:
                return RuntimeResult(False, exc.message)
        else:
            repository = self.config.repositories.get(request.repository_id)
        if repository is None:
            return RuntimeResult(False, UNKNOWN_REPOSITORY)
        kind = self.config.kinds[request.agent_kind]
        log = self.config.logs / f"{request.session_id}.jsonl"
        self.service.execution_metadata(request.session_id, log_path=str(log))
        if request.kind == "chat":
            return await self.chat(request, kind, log, repository)
        return await self.work(request, kind, log, repository)

    async def chat(self, request, kind, log, repository: Repository):
        token = self.tokens.issue(Identity(request.session_id, request.room_id, request.agent_id))
        try:
            mcp = room_mcp_server(api_url=self.config.api_url, token=token,
                                  room_id=str(request.room_id), participant_id=str(request.agent_id))
            prompt = ("방의 협업 에이전트입니다. 아래 JSON의 agent_id가 당신이고, agents에 방의 다른 에이전트와 각자의 good_at이 있습니다. "
                      "messages에서 author가 human이면 사람, agent:<id>이면 그 id의 에이전트, system이면 서버가 보낸 것입니다. "
                      "사람 메시지마다 Jev가 답할 에이전트 하나를 골라 깨웁니다. 당신이 깨워졌고 아직 답하지 않은 사람의 질문이나 "
                      "요청이 있으면 send로 한국어 답을 올리세요. 다른 에이전트가 이미 답했으면 반복하지 마세요. "
                      "답에 필요하면 현재 폴더의 파일을 읽어도 되지만 수정하거나 명령을 실행하지는 마세요. "
                      "다른 에이전트의 의견이나 도움이 필요하면 send 본문에 @이름을 넣어 부르세요. 부른 에이전트만 깨어납니다. "
                      "다른 에이전트가 @이름으로 당신을 불렀으면 send로 답하고, 되물을 게 있을 때만 다시 그 에이전트를 부르세요. "
                      "대화할 수 있는 턴 수는 제한되어 있으니 한 턴에 메시지는 하나만, 두세 문장으로 쓰세요. "
                      "할 일의 담당과 검증 프로필은 Jev가 정합니다. 직접 claim하지 마세요. "
                      "tasks에서 owner_id가 당신이고 status가 claimed이며 active_session_id가 없는 할 일은 delegate 하세요. "
                      "보류 중인 할 일은 목록에 나오지 않습니다. "
                      "delegate에는 고유 request_id와 instructions를 넣으세요. 409 충돌이면 상태를 다시 확인하세요. "
                      "위임했으면 턴을 끝내세요. "
                      "답할 메시지도 맡을 할 일도 없으면 메시지 없이 턴을 끝내세요.\n" + kind.instructions + "\n" + request.prompt)
            async with EventLog(log, self.service, request.session_id, secrets=(token,)) as events:
                result = await run_session(*kind.command, cwd=repository.path, prompt=prompt,
                                          timeout=self.config.timeout, mcp_servers=[mcp], on_update=events.on_update,
                                          config=self.session_config(request))
            self.service.execution_metadata(request.session_id, acp_session_id=result.session_id,
                                            stop_reason=str(result.stop_reason))
            # 최종 텍스트는 방에 올리지 않는다. send를 통해 저장된 메시지만 노출한다.
            return RuntimeResult(result.stop_reason == "end_turn", "채팅 턴 종료", log_path=str(log))
        finally:
            self.tokens.revoke(token)

    async def work(self, request, kind, log, repository: Repository):
        data = json.loads(request.prompt)
        if data["verify"] not in repository.verification_profiles:
            return RuntimeResult(False, UNAVAILABLE_VERIFICATION, log_path=str(log))
        profile = self.config.verifiers[data["verify"]]
        worktree = self.config.worktrees / f"task-{request.task_id}" / request.session_id
        # 시도마다 새 브랜치를 만들어, worktree를 지워도 커밋을 찾을 수 있게 한다.
        branch = f"ycton/task-{request.task_id}-{request.session_id[:8]}"
        # 경로는 호출 전에 기록해서 런타임 실패 시에도 보존한다.
        self.service.execution_metadata(request.session_id, worktree=str(worktree))
        task = WorkTask(title=data["title"], detail=data["detail"], scope=data["scope"],
                        verify="서버가 재검증할 명령(argv): " + json.dumps(profile.command),
                        instructions=data["instruction"] + "\n이전 인계:\n" + data["handoff"],
                        agents_md=kind.instructions)
        # 작업 세션은 이 토큰으로 commit 도구만 쓸 수 있다. 끝나면 바로 폐기한다.
        token = self.tokens.issue(Identity(request.session_id, request.room_id, request.agent_id))
        mcp = room_mcp_server(api_url=self.config.api_url, token=token,
                              room_id=str(request.room_id), participant_id=str(request.agent_id))
        try:
            async with EventLog(log, self.service, request.session_id, secrets=(token,)) as events:
                result = await run_work_session(*kind.command, repo=repository.path, worktree=worktree,
                                               task=task, timeout=self.config.timeout, mcp_servers=[mcp],
                                               on_update=events.on_update, branch=branch,
                                               config=self.session_config(request))
            self.service.execution_metadata(request.session_id, acp_session_id=result.session.session_id,
                                            stop_reason=str(result.session.stop_reason))
            if result.session.stop_reason != "end_turn":
                return RuntimeResult(False, f"작업 턴 비정상 종료: {result.session.stop_reason}; worktree={worktree}; branch={branch}", log_path=str(log))
            passed, output = await verify_worktree(profile, worktree)
            self.service.execution_metadata(request.session_id, verification_output=output)
            # 검증을 통과해도 commit 도구로 남긴 커밋이 없으면 done으로 보지 않는다.
            with self.service.db.connect() as c:
                committed = require(c, "sessions", request.session_id)["commit_hash"] is not None
            summary = (f"{result.session.text}\n서버 검증: {'passed' if passed else 'failed'}\n"
                       f"{output[:4000]}\nworktree={worktree}; branch={branch}")
            if not committed:
                summary += "\n커밋 없음: commit 도구로 고른 파일을 커밋해야 완료됩니다"
            return RuntimeResult(passed and committed, summary, "passed" if passed else "failed", log_path=str(log))
        except TimeoutError:
            return RuntimeResult(False, f"작업 또는 검증 시간 초과; worktree={worktree}; branch={branch}", log_path=str(log))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            return RuntimeResult(False, f"작업 실행 오류: {type(exc).__name__}; worktree={worktree}; branch={branch}", log_path=str(log))
        finally:
            self.tokens.revoke(token)
