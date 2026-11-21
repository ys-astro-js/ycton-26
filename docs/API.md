# API 계약

주소 기준은 `http://127.0.0.1:8000`입니다. React의 API 주소는 환경 변수로 주입하세요. 허용 Origin 기본값은 localhost/127.0.0.1의 5173, 8000 HTTP 주소입니다. `ORCH_ORIGINS`로 쉼표 구분 설정이 가능합니다.

## 사람·프론트 요청

`X-Orch-Client: web` 헤더를 보냅니다. 에이전트 Bearer 토큰을 붙여 사람용 API를 호출하면 거절합니다.

| 메서드·경로 | 입력 | 응답/기능 |
|---|---|---|
| GET `/health` | 없음 | ok와 mock/acp 모드 |
| POST `/api/folders/pick` | 없음 | 서버 컴퓨터에 OS 폴더 선택 창을 띄워 고른 Git 저장소의 최상위 path와 name. 취소하면 둘 다 null. Git 저장소가 아니거나 커밋이 없으면 422 |
| POST `/api/rooms` | name, repository_id(설정 저장소 ID, 기본 default) 또는 repo(폴더 선택 창이 돌려준 path) | 생성한 방. repo를 주면 repository_id 대신 그 폴더를 쓰고, 서버가 커밋 있는 Git 저장소인지 다시 확인한다 |
| GET `/api/rooms` | 없음 | 방 목록 |
| GET `/api/agent-models` | - | 고를 수 있는 모델 `[{id, label, models, efforts}]`. acp는 runtime.toml, mock은 runtime.toml이 없으면 runtime.example.toml의 `[kinds.*]` |
| POST `/api/rooms/{id}/agents` | name, kind(제공자 id), model, effort, good_at 배열(담당 업무) | 참여자. acp에서는 등록된 제공자만, 목록이 있는 제공자는 그 안의 model·effort만 허용 |
| POST `/api/rooms/{id}/tasks` | title, detail, scope(선택), verify(선택) | 할 일. acp의 verify는 검증 프로필 이름. 비우면 Jev가 담당을 정할 때 고름 |
| POST `/api/rooms/{id}/messages` | content, reply_to_message_id(선택) | 사람 메시지 저장. 답장 대상은 같은 프로젝트의 에이전트 질문이어야 함. 깨울 에이전트는 아래 규칙을 따름 |
| GET `/api/rooms/{id}/state` | 없음 | room, agents, tasks, sessions, messages, unanswered_questions, jev, mode |
| POST `/api/rooms/{id}/pause` | 없음 | 새 실행 중지, 현재 실행은 유지 |
| POST `/api/rooms/{id}/resume` | 없음 | 자동 진행 재개 |
| POST `/api/tasks/{id}/retry` | note | 시도 횟수 초기화와 open 전환 |
| POST `/api/tasks/{id}/drop` | note | 실행 없는 작업 종료 |
| GET `/api/tasks/{id}/events` | 없음 | 작업 변경 이력 |
| GET `/api/sessions/{id}` | 없음 | 실행 상세 |
| GET `/api/sessions/{id}/events` | cursor (기본 0) | 공개 ACP 이벤트 페이지 |
| POST `/api/sessions/{id}/cancel` | 없음 | 대기/실행 세션 취소 |

토큰 발급 API는 없습니다. 일반 API의 ID는 정수, session ID는 UUID 문자열입니다.

state는 1초 정도 간격으로 폴링합니다. `room.paused`는 `0`(진행), `1`(사람이 중지), `2`(서버 재시작으로 중지)입니다. `messages`는 최근 100개입니다.

사람 메시지가 깨우는 에이전트: 본문에서 `@이름`으로 부른 에이전트, 답장한 질문을 올린 에이전트를 깨웁니다. 둘 다 없으면 응답을 돌려준 뒤 Jev가 에이전트 하나를 골라 깨웁니다. 사람 메시지는 방의 채팅 턴 수를 0으로 되돌립니다. 정해진 답변자는 메시지의 `addressed_to`(에이전트 ID 목록)에 남고, 채팅 프롬프트에는 `for_you`로 전달되어 다른 에이전트는 그 메시지에 답하지 않습니다.

채팅 에이전트는 사람이 반영을 요청하면 MCP `merge_to_project`(내부 `POST /api/agent/merge`)로 방 통합 브랜치 `ycton/room-<id>`를 프로젝트 저장소에 체크아웃된 브랜치에 병합합니다. 충돌하면 병합을 되돌리고 충돌 파일을 돌려줍니다. 채팅 에이전트는 사람이 채팅으로 요청한 작업을 MCP `create_task(title, detail)`(내부 `POST /api/agent/tasks/create`)로 할 일에 올립니다. 할 일은 등록만 하고 아무도 깨우지 않습니다. 스케줄러가 담당이 없는 열린 할 일을 Jev에 맡겨 담당과 검증 프로필을 정하고(`assigned` 작업 이력), 담당 에이전트만 깨웁니다. 채팅 턴이 위임 전에 실패해 반환된 할 일은 시도 1회로 셉니다.

`POST /api/messages/{id}/resolve`는 사람에게 보낸 질문을 답장 없이 완료로 표시해 `unanswered_questions`에서 뺍니다. `unanswered_questions`는 에이전트가 본문에 `@human`으로 사람을 호출한 미답변 메시지입니다. 대소문자를 구분하지 않으며, 다른 에이전트 멘션, `@all`, 코드 예시는 질문으로 집계하지 않습니다. 일반 메시지로 닫히지 않고 최근 메시지 100개에서 밀려나도 남습니다.

`jev.action`은 `stop`, `wait`, `spawn_suggested`, `go` 중 하나이며 `reason`을 함께 반환합니다. 프로젝트 화면은 `wait`와 `spawn_suggested`의 이유를 고정 상태 바 아래에 표시합니다. OpenRouter가 판단을 반환하면 `jev.recommendation`에 `{action, reason}`이 추가되며, 추천은 실행 상태를 변경하지 않습니다.

세션의 추가 필드:

| 필드 | 의미 |
|---|---|
| worktree | 해당 실행 시도 경로, 실패해도 남음 |
| acp_session_id | 실제 ACP 세션 ID |
| stop_reason | 실제 턴 종료 이유 |
| verification | passed / failed / not_run |
| verification_output | 서버 검증의 종료 코드·stdout |
| summary | 결과/실패 요약 |

`/events`는 `{events: [{id, kind, text}], next_cursor, has_more}`를 반환합니다. 한 페이지는 최대 40개입니다. 다음 페이지는 `has_more`가 참일 때 반환된 `next_cursor`로 요청하세요. `kind`는 `message`, `tool`, `plan`, `log_gap` 중 하나입니다. 원본 JSONL 경로, ACP 추론, 도구 인자·출력은 사람용 응답에 포함하지 않습니다. 임의 파일 다운로드와 실시간 스트리밍은 제공하지 않습니다.

## 내부 MCP 요청 — 담당 1 계약

헤더: `Authorization: Bearer <현재 채팅 세션의 토큰>`.

인증 토큰은 백엔드가 생성해 MCP 설정으로만 전달합니다. 모든 요청에서 토큰의 신원과 body의 문자열 ID를 비교합니다. 이 통합본에서는 DB 정수 ID의 문자열 표현을 사용합니다. 임의의 `demo-room` 같은 별칭을 별도로 등록하는 기능은 없습니다.

### send

`POST /api/agent/messages`

```json
{"room_id":"1","participant_id":"2","text":"제가 UI 작업을 맡겠습니다."}
```

DB 커밋 후 201을 반환합니다. 기존 담당 1의 send 규격을 유지했습니다. 본문에서 `@이름`으로 부른 같은 방의 에이전트만 깨우며, 아무도 부르지 않으면 아무도 깨우지 않습니다. 에이전트끼리의 대화는 채팅 턴 수를 되돌리지 않습니다.

### list_tasks

`POST /api/agent/tasks/list`

```json
{"room_id":"1","participant_id":"2"}
```

응답은 tasks와 agents입니다. tasks.id는 MCP가 그대로 사용할 문자열입니다.

### claim

`POST /api/agent/tasks/claim`

```json
{"room_id":"1","participant_id":"2","task_id":"3"}
```

성공 시 200과 할 일을 반환합니다. 다른 에이전트가 먼저 가져갔거나 상태상 불가능하면 409입니다. 방이 다르면 403입니다. **채팅 발언만으로는 담당자가 바뀌지 않습니다.** 담당은 보통 Jev가 정하므로 채팅 프롬프트는 claim을 쓰지 말라고 안내합니다. 도구는 호환을 위해 남겨 둡니다.

### delegate

`POST /api/agent/tasks/delegate`

```json
{
  "room_id":"1",
  "participant_id":"2",
  "task_id":"3",
  "request_id":"고유한 요청 ID",
  "instructions":"안내 문구를 추가하고 테스트를 확인하세요."
}
```

성공 시 202와 queued 세션을 반환합니다. HTTP 요청에서 ACP 종료를 기다리지 않습니다. 같은 에이전트의 같은 request_id와 같은 내용은 같은 세션을 반환합니다. 같은 키로 다른 내용을 보내면 409입니다. 새 실행 시도에는 새 키를 사용하세요.

## MCP 도구 입력

방과 작성자는 환경 변수에서 자동으로 넣습니다. 모델이 선택하지 않습니다.

```text
send(text)
list_tasks()
claim(task_id)
delegate(task_id, request_id, instructions="")
```

작업 세션에는 위 도구 대신 아래 도구 하나만 제공합니다(MCP `--work` 모드).

```text
commit(paths, message)
```

작업 결과는 run_work_session의 반환값과 서버 검증으로만 확정합니다. 에이전트가 done을 직접 호출하는 API는 없습니다.

### commit

`POST /api/agent/commit`, 작업 세션의 토큰으로만 호출합니다.

```json
{"room_id":"1","participant_id":"2","paths":["src/search/empty.tsx"],"message":"Show a hint for empty search results"}
```

- 토큰의 세션이 실행 중인 작업 세션이고 그 할 일의 현재 시도여야 합니다. 아니면 403입니다.
- 경로는 worktree 기준 상대 경로만 받습니다. 절대 경로, worktree 밖, `.git` 내부는 422로 거절합니다. pathspec 패턴은 해석하지 않습니다.
- 서버가 worktree에서 `git add -- <paths>` 후 `git commit --only`로 지정한 파일만 커밋합니다. 다른 변경은 스테이징되어 있어도 남습니다. 작성자는 `<에이전트 이름> (ycton)`입니다.
- 성공하면 201과 `{"commit":"<해시>"}`를 반환하고, 세션의 `commit_hash`와 할 일 이력(`committed`)에 기록합니다. 커밋할 변경이 없는 등 git이 실패하면 422와 git의 오류 내용을 돌려줍니다.
- 검증을 통과해도 이 도구로 남긴 커밋이 없으면 시도는 실패로 끝나고 할 일은 open으로 돌아갑니다.
- 시도가 done으로 끝나면 할 일의 `commit_hash`에 마지막 커밋을 연결합니다. 실패한 시도의 커밋은 인계 노트에 `commit=<해시>`로만 남습니다.

## 오류 형식

401: 토큰 없음/폐기됨. 403: 방·작성자 불일치, 비활성 세션, 금지된 Origin/사람용 요청. 404: 항목 없음. 409: 상태 충돌. 422: 입력 오류/없는 종류/검증 프로필/커밋 실패.

도메인 오류는 `{"detail":"이유"}`이고, FastAPI 입력 검증 오류의 detail은 배열입니다. MCP는 HTTP 상태를 도구 오류로 변환합니다. API 응답 본문을 임의의 셸 명령으로 실행하지 않습니다.

## 최신 런타임 병합 호환성

`claim`과 `delegate`는 정수 task_id도 받으며 내부에서 문자열로 정규화합니다. `delegate.request_id`를 생략하면 현재 채팅 세션과 작업 ID로 중복 방지 키를 만듭니다. 기존 명시적 request_id 방식도 유지합니다. MCP의 `--work` 모드는 commit만 노출하며, 오케스트레이터는 work 세션마다 별도 토큰을 발급해 전달하고 종료 시 폐기합니다.
