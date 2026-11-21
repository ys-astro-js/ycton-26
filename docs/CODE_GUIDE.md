# 코드별 역할

## 실행 흐름

```text
React → FastAPI → TaskService → SQLite
                         ↓ queued 세션
                     Scheduler
                         ↓ RuntimeRequest
                FakeRuntime / AcpRuntime
                         ↓
             run_session / run_work_session
                         ↓ RuntimeResult
                 TaskService.finish
                         ↓
          상태·인계·메시지 저장 + 다음 턴 예약
```

채팅 중 도구 호출은 별도 흐름입니다.

```text
실제 에이전트 → room_mcp (stdio)
                    ↓ HTTP + 세션 토큰
                 api/agent_bridge
                    ↓ 신원·상태 확인
                 TaskService
```

## 담당 2가 새로 구현한 모듈

모두 `src/ycton/orchestration/` 아래에 있습니다.

| 파일 | 담당 역할 |
|---|---|
| `main.py` | FastAPI 앱 조립, mock/acp 선택, DB 복구와 스케줄러 생명주기 |
| `config.py` | 서버 환경 변수, 동시 실행 수·재시도·채팅 턴 한도 |
| `runtime_config.py` | 신뢰된 TOML의 저장소·어댑터 명령·검증 프로필 읽기와 검증 |
| `db.py` | SQLite 스키마와 쓰기 트랜잭션 |
| `schemas.py` | 프론트 입력의 필드와 길이 검증 |
| `identity.py` | 채팅 실행별 임시 토큰 생성·조회·폐기 |
| `runtime_port.py` | 실행 입력 RuntimeRequest와 반환 RuntimeResult 계약 |
| `acp_bridge.py` | 담당 1 함수 호출, worktree 기록, 서버 직접 검증, 결과 정규화 |
| `event_log.py` | 동기 on_update를 큐로 수신, 별도 소비자가 파일과 DB 요약에 저장 |
| `fake_runtime.py` | AI 없이 claim/delegate/성공·실패를 재현 |
| `scheduler.py` | 대기 세션 실행, 전체/에이전트별 한도, 시간 제한과 취소 |
| `jev.py` | 현재 상태에 대한 go/wait/stop/spawn 제안. 실제 spawn은 하지 않음 |
| `services/task_service.py` | claim·delegate·완료·실패·재시작의 모든 상태 변경 |
| `services/prompt_builder.py` | 채팅에는 최근 상태, 작업에는 할 일과 인계만 전달 |
| `api/dependencies.py` | 사람용 API 헤더 검사와 서비스 주입 |
| `api/rooms.py` | 방·참여자·사람 메시지·상태 조회·pause/resume |
| `api/tasks.py` | 사람의 할 일 등록·이력·retry/drop |
| `api/sessions.py` | 실행 상세와 취소 |
| `api/agent_bridge.py` | 담당 1 MCP가 호출하는 내부 API, 문자열 ID와 세션 신원 검사 |

`__init__.py`는 패키지 구분과 간단한 설명입니다.

## 담당 1 코드 중 포함한 파일

| 파일 | 통합본에서의 상태 |
|---|---|
| `src/ycton/agent_process.py` | 전달받은 코드 그대로. 프로세스 그룹/Windows Job 수명 관리 |
| `src/ycton/work_session.py` | 전달받은 코드 그대로. 작업 worktree 생성과 작업 세션 실행 |
| `src/ycton/__init__.py` | 전달받은 코드 그대로 |
| `src/ycton/acp_runtime.py` | 승인 대상 room 도구 4개로 확장, 채팅 read-only 환경 명시 |
| `src/ycton/room_mcp.py` | 기존 send 유지, 조회·claim·delegate 추가, 테스트 가능한 빌더 분리 |

담당 1의 두 파일 수정은 자동 흐름 연결에 필요한 최소 변경입니다. 팀원과 런타임 수정 사항을 공유할 때는 Git diff에서 두 파일의 변경을 확인하세요.

## 상태 관리의 핵심

할 일: `open → claimed → done`. 실패·반납 시 open. 실행 중이지 않은 할 일은 사람이 dropped로 바꿀 수 있습니다.

실행: `queued → running → succeeded / failed / cancelled`. 할 일 하나에 실행 시도가 여러 개 생길 수 있으므로 별도 테이블입니다.

- claim은 DB 쓰기 트랜잭션에서 open일 때만 성공합니다.
- delegate는 담당자 확인, 활성 실행 확인, request_id 중복 처리를 거칩니다.
- 같은 request_id와 같은 내용은 기존 실행을 반환합니다.
- finish는 활성 실행 ID와 종료 여부를 확인해 중복/늦은 결과를 무시합니다.
- 채팅 턴이 claim 이후 위임 전에 실패하면 claim을 반환합니다.
- 실패한 작업은 기본 두 번까지만 자동 시도합니다. 초과 시 사람이 retry로 재개합니다.
- worktree와 로그 경로는 실행 전에 기록합니다. 취소 시에도 인계에 경로가 남습니다.

## 보안과 신원 경계

사람용 요청: `X-Orch-Client: web`. 브라우저 Origin과 Host 제한이 있습니다. 이는 사용자 계정 인증이 아니며 로컬 신뢰 환경용입니다.

에이전트용 요청: 실행별 Bearer 토큰. 내부 API가 방·작성자·활성 chat 세션 일치를 확인합니다. work 세션에는 MCP 설정/토큰을 전달하지 않습니다. 종료 시 토큰을 폐기하고 토큰 발급 API는 제공하지 않습니다.

로그 소비자는 해당 세션 토큰 문자열을 지웁니다. 외부 런타임 자체 stderr까지 모든 비밀 정보를 자동 검출하는 기능은 아닙니다. 프롬프트나 지침에 비밀을 넣지 마세요.

## 코드 읽는 순서

1. `runtime_port.py`: 입력과 결과 모양
2. `api/agent_bridge.py`: MCP 요청이 어떤 검사를 거치는지
3. `task_service.py`: claim → delegate → finish
4. `scheduler.py`: queued가 실행되는 시점
5. `acp_bridge.py`: 담당 1 코드와 연결되는 실제 지점
6. `main.py`: 전체 조립

## 테스트와 설정 파일

- `tests/test_orchestration.py`: 기본 상태 전이·경합·API·mock 통합
- `tests/test_integration.py`: MCP/HTTP 왕복, 신원 위조 거절, 토큰 폐기, 런타임 계약, 직접 검증과 권한 허용 목록
- `scripts/demo.py`: mock HTTP 성공·실패 데모
- `runtime.example.toml`: 실제 실행 전에 채울 설정 예시
- `pyproject.toml`, `uv.lock`: 설치와 버전 재현
