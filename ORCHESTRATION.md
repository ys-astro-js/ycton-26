# Ycton 담당 2 — 실제 런타임 연결본

팀 프로젝트의 오케스트레이션 구현 안내입니다. 담당 2 코드는 `src/ycton/orchestration/`에 있습니다.

- 기본 `mock` 모드: 모델 없이 서버·DB·스케줄러 흐름을 확인합니다.
- 선택 `acp` 모드: 담당 1의 `run_session()` / `run_work_session()`을 호출합니다.
- MCP `send`, `list_tasks`, `claim`, `delegate` → 실제 HTTP API → SQLite 연결을 구현했습니다.
- 실제 Codex 로그인·모델 실행은 이 통합본에서 검증하지 않았습니다. 설치된 어댑터와 사용자 설정이 필요합니다.

## 먼저 읽을 문서

1. [파일별 역할](docs/CODE_GUIDE.md)
3. [프론트·MCP API 계약](docs/API.md)
4. [검증 내용과 남은 범위](docs/VALIDATION.md)

## 1. 설치하고 테스트하기

**이 문서와 pyproject.toml이 있는 저장소 루트 폴더**를 터미널에서 열고 실행합니다.

uv 사용:

```sh
uv sync --locked
uv run pytest -q
```

uv가 없다면 macOS/Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e . pytest
.venv/bin/python -m pytest -q
```

Windows에서는 `.venv/bin/python` 대신 `.venv\Scripts\python.exe`를 사용합니다. Python 3.11 이상이 필요합니다.

**`pip install -e .` 또는 `uv sync`가 필수입니다.** MCP는 `python -I -m ycton.room_mcp`로 실행하므로 PYTHONPATH만 설정해서는 연결되지 않습니다. uv.lock은 이 통합본의 의존성에 맞게 생성했습니다.

## 2. 모델 없이 서버 확인하기

```sh
uv run uvicorn ycton.orchestration.main:app --host 127.0.0.1 --port 8000 --workers 1
```

uv가 없다면:

```sh
.venv/bin/python -m uvicorn ycton.orchestration.main:app --host 127.0.0.1 --port 8000 --workers 1
```

[API 문서](http://127.0.0.1:8000/docs), [상태 확인](http://127.0.0.1:8000/health)을 엽니다. API 문서의 `/api/rooms` 등 사람용 API에는 `x-orch-client` 입력값으로 `web`을 넣습니다.

새 터미널의 같은 프로젝트 폴더에서:

```sh
python3 scripts/demo.py
python3 scripts/demo.py --fail
```

성공은 `done / attempts=1`, 실패는 `open / attempts=2`가 정상입니다. 이 스크립트는 **mock 모드 전용**입니다. 실제 모드에서는 아래의 검증 프로필로 작업을 등록하세요.

## 3. 실제 ACP 실행 준비

1. 담당 1이 검증한 ACP 어댑터가 설치되어 있고 Codex 로그인이 되어 있는지 확인합니다.
2. 데모용 Git 저장소의 필요한 파일을 커밋합니다. 작업은 커밋된 HEAD 기준의 새 worktree에서 시작합니다.
3. `runtime.example.toml`을 `runtime.toml`로 복사합니다.
4. 다음을 실제 환경에 맞춥니다.

| 설정 | 내용 |
|---|---|
| `repo` | 커밋된 데모 저장소 절대 경로 |
| `worktrees` | 원본 저장소 밖의 작업 디렉터리 부모 경로 |
| `logs` | 원본·작업 worktree 밖의 로그 경로 |
| `api_url` | 서버 포트와 일치하는 `http://127.0.0.1:8000` |
| `kinds.*.command` | 담당 1이 확인한 ACP 어댑터의 실제 실행 명령 배열 |
| `kinds.*.instructions` | 종류별 지침 |
| `verify.unit.command` | 서버가 직접 실행할 검증 명령 배열 |
| `verify.unit.contains` | 선택적인 성공 stdout 문자열 |

실행 명령은 예를 들어 `['실행파일', '인자1']` 구조입니다. 문자열 전체를 셸 명령으로 실행하지 않습니다. 어댑터의 실제 명령은 임의로 가정하지 않았습니다.

macOS/Linux에서:

```sh
ORCH_MODE=acp ORCH_RUNTIME_CONFIG=runtime.toml ORCH_DB=data/acp.db \
uv run uvicorn ycton.orchestration.main:app --host 127.0.0.1 --port 8000 --workers 1
```

PowerShell에서는 환경 변수를 따로 설정합니다.

```powershell
$env:ORCH_MODE="acp"
$env:ORCH_RUNTIME_CONFIG="runtime.toml"
$env:ORCH_DB="data/acp.db"
uv run uvicorn ycton.orchestration.main:app --host 127.0.0.1 --port 8000 --workers 1
```

uv가 없다면 위 실행 명령의 `uv run uvicorn`을 `.venv/bin/python -m uvicorn`으로 바꿉니다.

## 4. 실제 작업 등록

API 문서 또는 프론트에서 아래 순서로 요청합니다.

1. `POST /api/rooms`: `{"name":"데모"}`
2. `POST /api/rooms/{id}/pause`: 준비 중 자동 채팅을 잠시 멈춥니다.
3. `POST /api/rooms/{id}/agents`: frontend와 backend 종류로 각각 한 명을 추가합니다.
4. `POST /api/rooms/{id}/tasks`: 아래 예시로 할 일을 등록합니다.
5. `POST /api/rooms/{id}/resume`: 에이전트들의 턴을 시작합니다.
6. `GET /api/rooms/{id}/state`: 메시지, 담당자, 작업 세션, 검증 결과를 확인합니다.

에이전트 예시:

```json
{"name":"프론트 담당", "kind":"frontend", "good_at":["UI 구현"]}
```

할 일 예시:

```json
{
  "title": "빈 검색 결과에 안내 문구 추가",
  "detail": "검색 결과가 없을 때 사용자가 알 수 있는 메시지를 표시",
  "scope": "src/search",
  "verify": "unit"
}
```

**acp 모드의 verify는 명령어가 아니라 TOML에 등록된 검증 프로필 이름입니다.** 기존 기획의 자유 텍스트 verify를 직접 실행하지 않습니다. 이 정책은 팀과 합의해 주세요.

## 완료 판정

작업 턴의 `stop_reason == end_turn`만으로 완료하지 않습니다. 에이전트 종료 후 서버가 같은 worktree에서 등록된 검증 명령을 다시 실행합니다.

- 종료 코드 0, 설정된 성공 출력 조건 충족 → `done`
- 검증 실패, 비정상 턴 종료, 시간 초과, 실행 오류 → 인계 기록과 함께 `open`
- 성공/실패와 관계없이 worktree는 보존합니다. 자동 커밋·병합은 하지 않습니다.

검증 명령은 stdout 최대 1MB를 저장하고 stderr는 서버 터미널에 출력합니다. `contains`는 저장한 stdout 범위에서 확인합니다. 실제 앱 실행·테스트에 필요한 의존성은 사용자가 검증 환경에 준비해야 합니다.

## 운영 범위

한 서버 프로세스만 사용하세요. 자동 reload와 여러 workers는 지원하지 않습니다. 같은 DB로 두 서버를 띄우지 마세요. 앞서 배포한 초안 DB와 스키마가 달라 **새 DB 경로를 사용**해야 합니다. 자동 마이그레이션은 없습니다.

pause는 새 실행 시작만 멈춥니다. 실행 중 작업은 별도 cancel로 취소합니다. 서버 재시작은 기존 방을 일시 중지하고 남은 실행을 실패 기록으로 정리합니다. 비정상 강제 종료 후 외부 프로세스의 존재 확인은 별도 운영 작업입니다.

Jev는 규칙 안내만 있으며 실제 모델 판단/spawn, React 화면, 위키·이슈·think, WebSocket, 파일 충돌 조정은 이번 구현에 포함하지 않았습니다. 한 설정의 저장소를 모든 방이 공유하는 데모 범위입니다.
