# 검증 결과 — 2026-11-21

## 실행한 검증

- Python 3.11.6에서 패키지 editable 설치 성공. `python -I -m ycton.room_mcp`가 패키지를 찾는 환경으로 검증했습니다.
- `uv lock` 생성, 별도 새 가상환경에서 `uv sync --locked` 성공.
- 새 가상환경에서 pytest: **25 passed**, deprecation warning 1개.
- 실제 MCP stdio 프로세스 + Uvicorn HTTP 서버 + SQLite 왕복 성공:
  - send: HTTP 201, DB 메시지 확인.
  - list_tasks: HTTP 200.
  - claim: HTTP 200, 담당자 확인.
  - delegate: HTTP 202, 작업 세션 ID 확인.
  - state 응답에 세션 토큰이 없는 것 확인.
- OpenAPI JSON 생성 성공 (`docs/openapi.json`).

## 테스트가 확인하는 내용

기본 12개는 동시 claim 경합, 중복 delegate, 늦은 결과, 검증 없이 done 금지, 재시도 상한, 재시작 복구, 다른 방 접근 거절, 활성 실행 반납 거절, HTTP 입력/Origin 검사, mock pause/resume, mock 실패 상한, 실행 한도·시간 초과·취소를 검사합니다.

추가 13개는 MCP→HTTP 계약, 방/작성자 위조 거절, 종료/폐기 토큰 거절, MCP 네 도구 왕복, 실제 검증 subprocess의 종료 코드·출력·시간 제한, 런타임 결과 변환, 실행 전 worktree 기록, 실패 경로 보존, 채팅 토큰 폐기와 로그 지움, 네 승인 도구와 나머지 도구 거절, 실패한 채팅 claim 반환, 비정상 stop_reason에서 done 금지를 검사합니다.

## 외부 모델 없이 검증한 초기 범위

초기 통합 테스트는 ACP 연결 함수 호출을 대체했습니다. MCP 프로세스, HTTP 서버, SQLite 저장, 검증 명령 subprocess는 실제 실행했습니다.

실제 모델 통합 결과는 아래 별도 항목에 기록합니다. Claude 및 브라우저 UI는 검증하지 않았습니다.

## 경고

pytest 경고는 현재 Starlette TestClient의 HTTPX 지원에 대한 deprecation 안내입니다. 테스트 실패가 아니며 숨기지 않았습니다. uv 0.13.9는 팀 프로젝트의 uv_build <0.13 범위에 대한 안내 경고를 출력했지만 설치와 테스트는 성공했습니다. 팀의 빌드 백엔드 범위를 유지했습니다.

## 팀 최신 코드 병합 후 검증

2026-11-21: `27 passed`. 기존 25개에 작업 MCP의 send 전용 노출과 정수 task_id·request_id 생략 요청의 중복 방지 검증을 추가했습니다. 실제 모델 호출은 하지 않았습니다.

## commit 도구 추가 후 검증

2026-11-21: `33 passed`. 시도별 브랜치 worktree, 작업 MCP의 commit 전용 노출, 고른 파일만 커밋, worktree 밖·`.git`·절대 경로 거절, chat 토큰의 커밋과 work 토큰의 send 거절, done에서만 할 일에 해시 연결, 실패 시도의 해시를 인계 노트에 보존, 작업 토큰 폐기를 검증했습니다. 실제 git 저장소를 사용했고 실제 모델 호출은 하지 않았습니다.

같은 날 커밋 필수 규칙 추가 후 `34 passed`. 검증을 통과해도 커밋이 없으면 할 일이 open으로 돌아가고 인계 노트에 "커밋 없음"이 남는 것을 확인했습니다.

## 실제 Codex 통합 검증

- Windows에서 Codex ACP 2.8.0, Uvicorn의 `acp` 모드, 실제 SQLite, 임시 Git 저장소를 사용했습니다. 사람용 HTTP API로 두 역할의 에이전트와 할 일 하나를 등록했습니다. 사람용 API에서 담당을 지정하거나 작업을 직접 실행하지 않았습니다.
- 두 실제 Codex 채팅 세션의 메시지가 저장됐습니다. 작업 담당 에이전트가 `list_tasks`, `send`, `claim`, `delegate`를 사용했습니다. 할 일 이력은 `created → claimed → delegated → succeeded`였고, 작업 시도 1회로 `done`이 됐습니다.
- 작업 서브세션은 `message.txt`를 `before`에서 `after`로 바꿨습니다. 원본 저장소와 검증 스크립트는 그대로였습니다. 서버가 등록된 검증 명령을 다시 실행해 `exit_code=0`과 `CODEX_LIVE_VERIFIED`를 기록했습니다. 결과 메시지가 저장됐고 작업 담당의 다음 채팅 턴도 정상 종료했습니다.
- 첫 실행에서는 Windows 샌드박스가 소유자 전용 임시 폴더 아래의 worktree에 접근하지 못해 작업이 `open`으로 돌아갔습니다. 일반 폴더 아래에서 샌드박스 권한을 변경하지 않고 성공 경로를 확인했습니다.
- 한글 지침이 담긴 UTF-8 TOML은 Windows의 CP949 로캘과 Python UTF-8 모드 비활성 상태에서 읽히는 것을 확인했습니다.
