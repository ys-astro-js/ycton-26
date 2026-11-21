"""담당 1의 실제 함수와 담당 2의 실행 계약을 연결한다. 완료 판정은 직접 검증한다."""
import asyncio
import json
import os
from pathlib import Path

from ycton.acp_runtime import run_session
from ycton.work_session import WorkTask, run_work_session
from ycton.room_mcp import room_mcp_server
from ycton.agent_process import spawn_owned_agent
from .runtime_port import RuntimeResult
from .identity import Identity
from .event_log import EventLog


async def verify_worktree(profile, worktree):
    """서버가 정한 argv만 실행. 프롬프트/verify 문자열을 shell 명령으로 실행하지 않는다."""
    chunks = []
    size = 0
    async with spawn_owned_agent(*profile.command, cwd=Path(worktree), env=os.environ.copy()) as process:
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

    async def run(self, request):
        kind = self.config.kinds[request.agent_kind]
        log = self.config.logs / f"{request.session_id}.jsonl"
        self.service.execution_metadata(request.session_id, log_path=str(log))
        if request.kind == "chat":
            return await self.chat(request, kind, log)
        return await self.work(request, kind, log)

    async def chat(self, request, kind, log):
        token = self.tokens.issue(Identity(request.session_id, request.room_id, request.agent_id))
        try:
            mcp = room_mcp_server(api_url=self.config.api_url, token=token,
                                  room_id=str(request.room_id), participant_id=str(request.agent_id))
            prompt = ("방의 협업 에이전트입니다. list_tasks로 할 일을 확인하고 send로 의견을 공유하세요. "
                      "자신의 강점을 고려해 claim(task_id)을 호출하고 성공한 일만 delegate 하세요. "
                      "delegate에는 고유 request_id와 instructions를 넣으세요. 409 충돌이면 상태를 다시 확인하세요. "
                      "위임했으면 턴을 끝내세요. 직접 파일을 수정하거나 명령을 실행하지 마세요. "
                      "할 일이 없으면 불필요한 메시지 없이 턴을 끝내세요.\n" + kind.instructions + "\n" + request.prompt)
            async with EventLog(log, self.service, request.session_id, secrets=(token,)) as events:
                result = await run_session(*kind.command, cwd=self.config.repo, prompt=prompt,
                                          timeout=self.config.timeout, mcp_servers=[mcp], on_update=events.on_update)
            self.service.execution_metadata(request.session_id, acp_session_id=result.session_id,
                                            stop_reason=str(result.stop_reason))
            # 최종 텍스트는 방에 올리지 않는다. send를 통해 저장된 메시지만 노출한다.
            return RuntimeResult(result.stop_reason == "end_turn", "채팅 턴 종료", log_path=str(log))
        finally:
            self.tokens.revoke(token)

    async def work(self, request, kind, log):
        data = json.loads(request.prompt)
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
        try:
            async with EventLog(log, self.service, request.session_id) as events:
                result = await run_work_session(*kind.command, repo=self.config.repo, worktree=worktree,
                                               task=task, timeout=self.config.timeout, on_update=events.on_update,
                                               branch=branch)
            self.service.execution_metadata(request.session_id, acp_session_id=result.session.session_id,
                                            stop_reason=str(result.session.stop_reason))
            if result.session.stop_reason != "end_turn":
                return RuntimeResult(False, f"작업 턴 비정상 종료: {result.session.stop_reason}; worktree={worktree}; branch={branch}", log_path=str(log))
            passed, output = await verify_worktree(profile, worktree)
            self.service.execution_metadata(request.session_id, verification_output=output)
            summary = (f"{result.session.text}\n서버 검증: {'passed' if passed else 'failed'}\n"
                       f"{output[:4000]}\nworktree={worktree}; branch={branch}")
            return RuntimeResult(passed, summary, "passed" if passed else "failed", log_path=str(log))
        except TimeoutError:
            return RuntimeResult(False, f"작업 또는 검증 시간 초과; worktree={worktree}; branch={branch}", log_path=str(log))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            return RuntimeResult(False, f"작업 실행 오류: {type(exc).__name__}; worktree={worktree}; branch={branch}", log_path=str(log))
