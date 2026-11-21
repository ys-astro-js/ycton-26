# 2번 담당 인계: 오케스트레이션 연결

1번 런타임은 실제 Codex로 **ACP 채팅 턴**, **MCP `send`의 HTTP 왕복**, **전용 git worktree에서 작업·검증**을 확인했습니다. MCP 검증에는 임시 HTTP 수신기를 사용했습니다. 이제 FastAPI·SQLite에 연결해서 할 일이 등록된 뒤 담당 결정부터 결과 기록까지 자동으로 이어지게 하면 됩니다.

## 1. 채팅 턴과 메시지 저장

- `uv sync --locked`로 런타임 의존성을 설치합니다. Codex 로그인과 ACP 어댑터 실행 예시는 [PLAN.md의 ACP 연결 확인](PLAN.md#acp-연결-확인)을 참고하세요. 채팅용 서버 프로세스에는 `INITIAL_AGENT_MODE=read-only`를 설정합니다. `run_session()`은 이 설정을 상속하고, 작업 서브세션만 `workspace-write`로 바꿉니다.
- `ycton.room_mcp.room_mcp_server(api_url=..., token=..., room_id=..., participant_id=...)`로 방과 에이전트에 맞는 MCP 설정을 만듭니다. `api_url`에는 경로 없이 `http://127.0.0.1:<포트>`를 넘깁니다.
- `ycton.acp_runtime.run_session(executable, *args, cwd=room_dir, prompt=prompt, mcp_servers=[room_mcp], on_update=on_update)`로 채팅 턴을 엽니다. 에이전트에게는 방에 말할 때 `send({"text": "메시지"})`를 쓰라고 지시합니다. `run_session()`의 최종 텍스트는 채팅 메시지로 저장하지 않습니다.

구현할 내부 엔드포인트:

```http
POST /api/agent/messages
Authorization: Bearer <서버가 발급한 에이전트 토큰>
Content-Type: application/json

{"room_id":"demo-room","participant_id":"agent-1","text":"이 작업은 제가 맡겠습니다."}
```

- 필드는 모두 문자열입니다. 방·작성자·토큰은 MCP 실행 설정에서 오고, 에이전트는 `text`만 지정합니다.
- 서버 시작 시 토큰을 생성하고, 요청마다 토큰과 작성자가 해당 방에 속한 **에이전트**인지 확인합니다. 이 라우트에서는 사람 명의로 쓸 수 없어야 합니다. 토큰은 프롬프트·로그·브라우저 응답에 넣지 않습니다.
- SQLite에 저장한 뒤에만 `2xx`를 반환합니다(`201` 권장, 응답 본문에 의존하지 않음). MCP는 `2xx`를 받아야 `Message sent.`를 반환합니다. 예를 들어 권한 거부 `403`은 MCP 도구 오류입니다. 브라우저의 Origin 검사는 별도로 유지합니다.

## 2. 할 일 할당과 작업 서브세션

채팅 턴의 `claim({"task_id": 37})`과 `delegate({"task_id": 37, "instructions": "..."})`는 아래 내부 HTTP 요청으로 연결됩니다. 두 요청 모두 메시지 API와 동일한 Bearer 토큰을 쓰고, JSON 본문에 문자열 `room_id`, `participant_id`를 함께 보냅니다. `task_id`는 정수입니다.

| HTTP 요청 | 본문에 추가되는 필드 | 성공 응답 |
| --- | --- | --- |
| `POST /api/agent/tasks/claim` | `task_id` | 담당자 저장을 마친 뒤 `200` 등 2xx |
| `POST /api/agent/tasks/delegate` | `task_id`, 문자열 `instructions` | 실행을 등록한 뒤 `202` 권장. 작업 완료까지 기다리지 않음 |

MCP 도구는 응답 본문에 의존하지 않습니다. 2xx가 아니면 성공으로 응답하지 않습니다. 이미 맡긴 작업이나 다른 에이전트가 가져간 일은 `409`, 방 또는 담당자 권한이 없으면 `403`으로 거절할 수 있습니다.

1. **`claim`**: `open`인 할 일만 원자적으로 `claimed`로 바꿉니다. 동시에 두 요청이 들어와도 한 에이전트만 성공해야 합니다.
2. **`delegate`**: 요청한 에이전트가 그 할 일의 담당자이고 해당 할 일에 실행 중인 서브세션이 없는지 확인합니다. 작업을 등록한 뒤 바로 응답하고, 실제 ACP 실행은 요청 밖에서 처리합니다.
3. **작업 실행**: `ycton.work_session`의 `WorkTask`와 `run_work_session()`을 사용합니다.

```python
task = WorkTask(
    title=title, detail=detail, scope=scope, verify=verify,
    instructions=delegate_instructions, agents_md=agent_instructions,
)
result = await run_work_session(
    executable, *args, repo=repo_dir, worktree=attempt_worktree,
    task=task, timeout=600, on_update=on_update,
)
```

- `repo_dir`은 Git 저장소입니다. `attempt_worktree`는 **원본 체크아웃 밖의 아직 없는 경로**로, 시도마다 달라야 합니다. 런타임은 커밋된 `HEAD`를 체크아웃하므로 데모에 필요한 원본 파일은 미리 커밋해 두세요. 채팅 기록은 작업 프롬프트에 전달하지 않습니다.
- `on_update`는 `SessionNotification`을 받는 **동기 콜백**입니다. DB 쓰기처럼 대기하는 작업은 콜백에서 직접 처리하지 말고 소비할 큐로 넘깁니다. 작업 결과는 `result.worktree`, `result.session.session_id`, `result.session.stop_reason`, `result.session.text`로 받습니다.
- **성공**: 실제 확인 명령의 결과가 `verify` 기준을 충족하면 `done`으로 바꾸고, 작업 보고와 검증 결과를 인계 노트·방 메시지에 남깁니다. `end_turn`은 턴 종료일 뿐 검증 통과가 아닙니다. 데모에서는 미리 정한 확인 명령의 종료 코드와 성공 출력을 진행 이벤트에서 확인하세요.
- **실패·시간 초과**: 검증 실패, 정상 종료가 아닌 `stop_reason`, `TimeoutError` 또는 실행 오류는 인계 노트와 함께 `open`으로 돌립니다. 만들어진 worktree는 실패 시에도 남으므로 시도 경로를 등록할 때부터 기록해 두세요. 런타임은 자동 커밋·병합하거나 작업 상태를 갱신하지 않습니다.

**통합에 필요한 남은 연결:** 2번이 위 HTTP 라우트를 구현하고, 채팅 턴 프롬프트에 열린 할 일과 번호를 포함해야 합니다. 작업 결과를 기록한 뒤 맡긴 에이전트의 다음 채팅 턴을 예약하는 것도 오케스트레이션이 맡습니다. 서브세션에 같은 방의 MCP 설정을 넘겨도 `claim`과 `delegate`는 노출되지 않습니다.

## 3. 통합 완료 기준

- 브라우저에서 할 일 하나를 올리면 두 에이전트가 채팅으로 역할을 정하고, 한 에이전트만 `claim`한 뒤 스스로 `delegate`합니다. 사람은 담당을 지정하거나 실행 버튼을 누르지 않습니다.
- 실제 팀 API에 에이전트 메시지가 저장되고, 새 worktree에서만 파일이 바뀝니다. 확인 명령의 결과와 작업 보고가 브라우저에 표시됩니다.
- 검증을 실패시키거나 시간을 초과시키면 할 일이 `open`으로 돌아가며, 인계 노트로 시도 경로와 어디까지 진행됐는지 확인할 수 있습니다.
