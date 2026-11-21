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
| POST `/api/rooms/{id}/tasks` | title, detail, scope, verify | 할 일. acp의 verify는 검증 프로필 이름 |
| POST `/api/rooms/{id}/messages` | content | 사람 메시지 저장 |
| GET `/api/rooms/{id}/state` | 없음 | room, agents, tasks, sessions, messages, jev, mode |
| POST `/api/rooms/{id}/pause` | 없음 | 새 실행 중지, 현재 실행은 유지 |
| POST `/api/rooms/{id}/resume` | 없음 | 자동 진행 재개 |
| POST `/api/tasks/{id}/retry` | note | 시도 횟수 초기화와 open 전환 |
| POST `/api/tasks/{id}/drop` | note | 실행 없는 작업 종료 |
| GET `/api/tasks/{id}/events` | 없음 | 작업 변경 이력 |
| GET `/api/sessions/{id}` | 없음 | 실행 상세 |
| POST `/api/sessions/{id}/cancel` | 없음 | 대기/실행 세션 취소 |

토큰 발급 API는 없습니다. 일반 API의 ID는 정수, session ID는 UUID 문자열입니다.

state는 1초 정도 간격의 폴링으로 시작할 수 있습니다. 방 paused는 SQLite의 0/1입니다. messages는 최근 100개입니다. 세션은 전체 이력이므로 장기 운영 시 페이지 조회를 추가해야 합니다.

세션의 추가 필드:

| 필드 | 의미 |
|---|---|
| worktree | 해당 실행 시도 경로, 실패해도 남음 |
| log_path | 전체 진행 이벤트 JSONL 파일 위치 |
| acp_session_id | 실제 ACP 세션 ID |
| stop_reason | 실제 턴 종료 이유 |
| verification | passed / failed / not_run |
| verification_output | 서버 검증의 종료 코드·stdout |
| latest_event | 마지막 진행 이벤트 일부, 최대 2000자 |
| summary | 결과/실패 요약 |

위 경로 필드는 표시용입니다. 서버는 임의 파일 다운로드 API를 제공하지 않습니다. 원본 stdout/stderr 전체가 브라우저에 스트리밍되는 구조는 아닙니다.

## 내부 MCP 요청 — 담당 1 계약

헤더: `Authorization: Bearer <현재 채팅 세션의 토큰>`.

인증 토큰은 백엔드가 생성해 MCP 설정으로만 전달합니다. 모든 요청에서 토큰의 신원과 body의 문자열 ID를 비교합니다. 이 통합본에서는 DB 정수 ID의 문자열 표현을 사용합니다. 임의의 `demo-room` 같은 별칭을 별도로 등록하는 기능은 없습니다.

### send

`POST /api/agent/messages`

```json
{"room_id":"1","participant_id":"2","text":"제가 UI 작업을 맡겠습니다."}
```

DB 커밋 후 201을 반환합니다. 기존 담당 1의 send 규격을 유지했습니다.

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

성공 시 200과 할 일을 반환합니다. 다른 에이전트가 먼저 가져갔거나 상태상 불가능하면 409입니다. 방이 다르면 403입니다. **채팅 발언만으로는 담당자가 바뀌지 않습니다.**

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
