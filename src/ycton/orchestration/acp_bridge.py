"""담당 1의 실제 함수와 담당 2의 실행 계약을 연결한다. 완료 판정은 직접 검증한다."""
import asyncio
import json
import logging
from pathlib import Path

from ycton.acp_runtime import run_session
from ycton.work_session import (WorkTask, checkout_branch_snapshot, ensure_branch, fast_forward, rebase_onto,
                                run_work_session, worktree_clean)
from ycton.room_mcp import room_mcp_server
from ycton.agent_process import spawn_owned_agent
from ycton.subprocess_env import child_environment
from .runtime_port import RuntimeResult
from .identity import Identity
from .services.task_service import require
from .event_log import EventLog
from .runtime_config import Repository
from .services.task_service import DomainError, UNKNOWN_REPOSITORY, UNAVAILABLE_VERIFICATION

logger = logging.getLogger(__name__)
# 방 브랜치가 그사이 또 움직였을 때 다시 쌓기를 시도하는 최대 횟수.
MAX_REBASES = 3


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

    async def chat_folder(self, request, repository: Repository):
        """채팅 턴이 읽을 폴더와 그 폴더가 방 브랜치를 보여 주는지를 돌려준다.

        완료된 할 일의 결과는 방 브랜치에만 쌓이므로, 방 브랜치 끝을 detached로 꺼낸 서버 전용 worktree에서
        채팅을 돌린다. 스케줄러는 에이전트마다 채팅 턴을 하나만 돌리므로 (방, 에이전트)마다 폴더를 따로 두면
        같은 방의 두 에이전트가 동시에 채팅해도 서로의 폴더를 되돌리지 않는다. 준비에 실패하면 프로젝트 폴더를 쓴다.
        """
        room_branch = f"ycton/room-{request.room_id}"
        folder = self.config.worktrees / f"room-{request.room_id}-chat-agent-{request.agent_id}"
        try:
            return await checkout_branch_snapshot(Path(repository.path), room_branch, folder), room_branch
        except (OSError, RuntimeError, ValueError):
            logger.warning("방 브랜치 채팅 폴더를 준비하지 못해 프로젝트 폴더에서 채팅합니다", exc_info=True)
            return Path(repository.path), None

    async def chat(self, request, kind, log, repository: Repository):
        token = self.tokens.issue(Identity(request.session_id, request.room_id, request.agent_id))
        try:
            cwd, room_branch = await self.chat_folder(request, repository)
            folder_note = (f"현재 폴더는 완료된 할 일의 결과가 쌓이는 방 브랜치 {room_branch}의 최신 상태입니다.\n"
                           if room_branch else "")
            mcp = room_mcp_server(api_url=self.config.api_url, token=token,
                                  room_id=str(request.room_id), participant_id=str(request.agent_id))
            prompt = ("방의 협업 에이전트입니다. 아래 JSON의 agent_id가 당신이고, agents에 방의 다른 에이전트와 각자의 good_at이 있습니다. "
                      "messages에서 author가 human이면 사람, agent:<id>이면 그 id의 에이전트, system이면 서버가 보낸 것입니다. "
                      "사람 메시지마다 답할 에이전트가 정해지고, 그 메시지에 for_you가 true로 표시됩니다. "
                      "사람 메시지는 for_you가 true이고 당신이 아직 답하지 않은 것에만 send로 한국어 답을 올리세요. "
                      "for_you가 false인 사람 메시지에는 답하지 마세요. 다른 에이전트가 맡은 질문입니다. "
                      "답에 필요하면 현재 폴더의 파일을 읽어도 되지만 수정하거나 명령을 실행하지는 마세요. "
                      "답하거나 할 일을 정리하기 전에 쓸 수 있는 스킬을 확인하고, 맞는 스킬이 있으면 먼저 불러서 따르세요. "
                      "할 일을 등록하거나 위임할 때는 그 작업에 맞는 스킬 이름을 detail이나 instructions에 적어 작업 세션도 쓰게 하세요. "
                      "당신에게 온 사람 메시지가 파일 수정이나 구현 같은 작업 요청이면, 되묻거나 허락을 기다리지 말고 "
                      "create_task(title, detail)로 할 일을 등록하세요. detail에는 사람이 요청한 내용과 조건을 빠짐없이 옮기세요. "
                      "tasks에 같은 요청이 이미 있으면 다시 등록하지 마세요. 등록한 뒤 무엇을 등록했는지 send로 한 문장 알리세요. "
                      "진행 중인 할 일과 같은 파일이나 문서를 고치는 요청이면 따로 나란히 돌리지 말고 "
                      "create_task의 after에 그 할 일 ID를 넣어 그 할 일이 끝난 뒤 이어서 하게 하세요. "
                      "기획이나 설계를 요청받으면 기획 할 일 하나로 계획을 문서에 쓰게 하고, 바로 이어서 good_at이 맞는 다른 "
                      "에이전트가 계획을 검토하는 할 일을 after=기획 할 일로 등록하세요. 검토 결과가 오면 지적을 반영하고, "
                      "계획에 적힌 구현 단계를 하나씩 create_task로 등록하세요. 앞 단계가 끝나야 하는 단계는 after에 앞 할 일 ID를 넣으세요. "
                      "계획 문서를 쓰는 것으로 끝내지 말고, 사람이 멈추라고 하지 않는 한 구현과 검증까지 이어 가세요. "
                      "done_tasks에 끝난 할 일과 결과 요약이 있으니 무엇이 이미 끝났는지 확인하고 판단하세요. "
                      "담당과 검증은 Jev가 정하고, 담당 에이전트의 작업 세션이 worktree에서 구현합니다. "
                      "사람에게 일을 떠넘기지 마세요. 사람에게 명령을 실행해 달라거나 직접 해 달라고 하지 말고, 가진 도구로 "
                      "끝까지 처리하세요. 사람이 시킨 일은 할지 말지 되묻지 말고 바로 하세요. "
                      "create_task의 detail과 delegate의 instructions에는 사람이 말한 요구를 그대로 옮기고, 사람이 말하지 않은 "
                      "제약이나 금지 사항을 지어내지 마세요. "
                      "완료된 할 일의 커밋은 방 통합 브랜치 ycton/room-<방 ID>에 쌓입니다. 사람이 main 같은 프로젝트 브랜치에 "
                      "반영하거나 병합하라고 하면 merge_to_project를 호출하세요. 충돌하면 충돌을 해결하는 할 일을 "
                      "create_task로 등록하고, 그 할 일이 끝나면 다시 merge_to_project를 호출하세요. "
                      "사람이 일일이 시키지 않아도 일이 이어지게 하세요. 다음 단계나 할 일 목록을 제안할 때는 허락을 기다리지 말고 "
                      "각 항목을 create_task로 등록하세요. 방향이 갈려 사람의 결정이 꼭 필요할 때만 ask_human으로 물으세요. "
                      "system 메시지가 당신 할 일의 결과(succeeded, failed)를 알렸고 그 뒤에 당신이 아직 말하지 않았으면 결과를 한 문장으로 send하고, "
                      "사람의 요청을 끝내는 데 남은 작업이 있으면 create_task로 등록하세요. 사람의 요청에 딸린 할 일이 "
                      "모두 끝나고 검토까지 마쳤으면, 사람이 막지 않은 한 merge_to_project로 프로젝트 브랜치에 반영해 사람이 결과를 볼 수 있게 하세요. "
                      "검토가 필요하면 good_at이 맞는 "
                      "에이전트를 @이름으로 불러 맡기세요. system 메시지가 @당신이름으로 다음 단계를 맡겼고 그 뒤에 당신이 아직 말하지 않았으면 남은 일을 "
                      "create_task로 등록하고, 모두 끝났으면 send로 완료를 한 문장으로 알리세요. "
                      "다른 에이전트의 의견이나 도움이 필요하면 send 본문에 @이름을 넣어 부르세요. 부른 에이전트만 깨어납니다. "
                      "다른 에이전트가 @이름으로 당신을 불렀으면 send로 답하고, 되물을 게 있을 때만 다시 그 에이전트를 부르세요. "
                      "사람의 결정이나 답이 필요하면 ask_human(question)으로 물으세요. question은 사람이 처리할 일 목록에서 "
                      "바로 읽고 답할 수 있게 200자 이내의 한 문장 요약 질문으로 쓰세요. 배경 설명이 필요하면 그 전에 send로 "
                      "따로 올리세요. send에는 @human을 쓰지 마세요. "
                      "대화할 수 있는 턴 수는 제한되어 있으니 한 턴에 메시지는 하나만, 두세 문장으로 쓰세요. "
                      "할 일의 담당과 검증 프로필은 Jev가 정합니다. 직접 claim하지 마세요. "
                      "tasks에서 owner_id가 당신이고 status가 claimed이며 active_session_id가 없는 할 일은 delegate 하세요. "
                      "보류 중인 할 일은 목록에 나오지 않습니다. "
                      "delegate에는 고유 request_id와 instructions를 넣으세요. 409 충돌이면 상태를 다시 확인하세요. 429는 자동 진행 한도이니 다시 시도하지 말고 턴을 끝내세요. "
                      "위임했으면 턴을 끝내세요. "
                      "답할 메시지도 맡을 할 일도 없으면 메시지 없이 턴을 끝내세요.\n" + folder_note + kind.instructions
                      + "\n" + request.prompt)
            async with EventLog(log, self.service, request.session_id, secrets=(token,)) as events:
                result = await run_session(*kind.command, cwd=cwd, prompt=prompt,
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
        # 방의 done 커밋이 쌓이는 통합 브랜치. 시도는 그 끝에서 시작해 앞선 결과 위에서 작업한다.
        room_branch = f"ycton/room-{request.room_id}"
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
            await ensure_branch(Path(repository.path), room_branch)
            async with EventLog(log, self.service, request.session_id, secrets=(token,)) as events:
                result = await run_work_session(*kind.command, repo=repository.path, worktree=worktree,
                                               task=task, timeout=self.config.timeout, mcp_servers=[mcp],
                                               on_update=events.on_update, branch=branch, base=room_branch,
                                               config=self.session_config(request))
            self.service.execution_metadata(request.session_id, acp_session_id=result.session.session_id,
                                            stop_reason=str(result.session.stop_reason))
            if result.session.stop_reason != "end_turn":
                return RuntimeResult(False, f"작업 턴 비정상 종료: {result.session.stop_reason}; worktree={worktree}; branch={branch}", log_path=str(log))
            passed, output = await verify_worktree(profile, worktree)
            self.service.execution_metadata(request.session_id, verification_output=output)
            # 검증을 통과해도 commit 도구로 남긴 커밋이 없으면 done으로 보지 않는다.
            with self.service.db.connect() as c:
                session = require(c, "sessions", request.session_id)
            commit, no_changes = session["commit_hash"], session["no_changes"]
            summary = (f"{result.session.text}\n서버 검증: {'passed' if passed else 'failed'}\n"
                       f"{output[:4000]}\nworktree={worktree}; branch={branch}")
            if commit is None and no_changes and passed and await worktree_clean(worktree):
                # 검토처럼 바꿀 파일이 없는 작업. 방 브랜치는 그대로 둔다.
                return RuntimeResult(True, f"{result.session.text}\n변경 없음: {no_changes}", "passed", log_path=str(log))
            if commit is None:
                summary += "\n커밋 없음: commit 도구로 고른 파일을 커밋하거나, 바꿀 파일이 없으면 no_changes를 불러야 완료됩니다"
                return RuntimeResult(False, summary, "passed" if passed else "failed", log_path=str(log))
            if not passed:
                return RuntimeResult(False, summary, "failed", log_path=str(log))
            # 병합 커밋은 만들지 않는다. 그사이 다른 할 일이 방 브랜치를 옮겼으면 이 시도의 커밋을 새 끝 위로
            # 다시 쌓고(rebase) 서버 검증을 다시 통과해야 빨리 감는다. 충돌하면 실패로 돌려 새 끝에서 다시 하게 한다.
            rebases = 0
            while not await fast_forward(Path(repository.path), room_branch, commit):
                if rebases == MAX_REBASES:
                    summary += (f"\n{room_branch} 반영 실패: 다른 할 일의 결과가 계속 먼저 반영되어 "
                                f"{MAX_REBASES}번 다시 쌓아도 빨리 감기할 수 없습니다. 다시 시도하면 새 끝에서 시작합니다")
                    return RuntimeResult(False, summary, "passed", commit, log_path=str(log))
                rebases += 1
                rebased = await rebase_onto(worktree, room_branch)
                if rebased.commit is None:
                    reason = (f"충돌한 파일: {', '.join(rebased.conflicts)}" if rebased.conflicts
                              else f"다시 쌓기 오류: {rebased.error[:500]}")
                    summary += (f"\n{room_branch} 반영 실패: 이 시도가 시작한 뒤 다른 할 일의 결과가 먼저 반영되었고, "
                                f"이 시도의 커밋을 새 끝 위로 다시 쌓을 수 없습니다. {reason}. "
                                "다시 시도하면 새 끝에서 시작합니다")
                    return RuntimeResult(False, summary, "passed", commit, log_path=str(log))
                commit = rebased.commit
                self.service.record_rebased_commit(request.session_id, commit)
                passed, output = await verify_worktree(profile, worktree)
                self.service.execution_metadata(request.session_id, verification_output=output)
                summary += f"\n{room_branch} 끝으로 다시 쌓음: {commit}; 서버 재검증: {'passed' if passed else 'failed'}"
                if not passed:
                    summary += f"\n{output[:4000]}"
                    return RuntimeResult(False, summary, "failed", commit, log_path=str(log))
            summary += f"\n{room_branch}={commit}"
            return RuntimeResult(True, summary, "passed", commit, log_path=str(log))
        except TimeoutError:
            return RuntimeResult(False, f"작업 또는 검증 시간 초과; worktree={worktree}; branch={branch}", log_path=str(log))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            return RuntimeResult(False, f"작업 실행 오류: {type(exc).__name__}; worktree={worktree}; branch={branch}", log_path=str(log))
        finally:
            self.tokens.revoke(token)
