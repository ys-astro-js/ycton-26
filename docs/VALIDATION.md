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

## 외부 모델 없이 검증한 경계

ACP 연결 함수 호출 자체는 테스트에서 대체했습니다. 반면 MCP 프로세스, HTTP 서버, SQLite 저장, 검증 명령 subprocess는 실제 실행했습니다. **실제 Codex·Claude·Gemini의 모델 호출, 실제 작업 worktree 수정, 모델별 권한 동작, 팀 React 화면은 검증하지 않았습니다.** 제공된 runtime 코드의 worktree 기능은 담당 1의 기존 검증을 참고한 것이며 여기서 재검증했다고 주장하지 않습니다.

실제 모델 통합은 사용자가 runtime.toml에 어댑터 명령·Git 저장소·검증 프로필을 채우고 acp 모드로 확인해야 합니다. 계정 사용량이 발생할 수 있는 모델 호출은 이 검증에서 수행하지 않았습니다.

## 경고

pytest 경고는 현재 Starlette TestClient의 HTTPX 지원에 대한 deprecation 안내입니다. 테스트 실패가 아니며 숨기지 않았습니다. uv 0.13.9는 팀 프로젝트의 uv_build <0.13 범위에 대한 안내 경고를 출력했지만 설치와 테스트는 성공했습니다. 팀의 빌드 백엔드 범위를 유지했습니다.
