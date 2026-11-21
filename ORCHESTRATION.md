# Ycton 담당 2 — 실제 런타임 연결본

팀 프로젝트의 오케스트레이션 구현 안내입니다. 담당 2 코드는 `src/ycton/orchestration/`에 있습니다.

- 기본 `mock` 모드: 모델 없이 서버·DB·스케줄러 흐름을 확인합니다.
- 선택 `acp` 모드: 담당 1의 `run_session()` / `run_work_session()`을 호출합니다.
- MCP `send`, `list_tasks`, `claim`, `delegate` → 실제 HTTP API → SQLite 연결을 구현했습니다. 할 일 담당은 Jev가 정하며, 채팅 에이전트는 자기에게 배정된 할 일을 `delegate`합니다.
- 실제 Codex ACP 2.8.0으로 HTTP 작업 등록부터 worktree 수정·서버 검증·결과 저장·다음 턴 실행까지 확인했습니다. [검증 기록](docs/VALIDATION.md#실제-codex-통합-검증)을 참고하세요.

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
2. 데모용 Git 저장소의 필요한 파일을 커밋합니다. 방의 첫 작업이 커밋된 HEAD에서 `ycton/room-<방>` 브랜치를 만들고, 이후 작업은 그 브랜치 끝의 새 worktree에서 시작합니다.
3. `runtime.example.toml`을 UTF-8로 저장된 `runtime.toml`로 복사합니다.
4. 다음을 실제 환경에 맞춥니다.

| 설정 | 내용 |
|---|---|
| `repo` | 커밋된 Git 체크아웃의 루트. 저장소 ID는 `default` |
| `worktrees` | 원본 저장소 밖의 작업 디렉터리 부모 경로 |
| `logs` | 원본·작업 worktree 밖의 로그 경로 |
| `api_url` | 서버 포트와 일치하는 `http://127.0.0.1:8000` |
| `kinds.*.command` | 담당 1이 확인한 ACP 어댑터의 실제 실행 명령 배열 |
| `kinds.*.label` | 화면에 보일 모델 제공자 이름(Claude, GPT) |
| `kinds.*.models` | 고를 수 있는 모델. ACP 세션의 `model` 설정 값과 같아야 합니다. 생략하면 어댑터의 기본 모델을 사용합니다 |
| `kinds.*.efforts` | 고를 수 있는 추론 수준. ACP 세션의 `thought_level` 설정 값과 같아야 합니다. 없으면 비웁니다 |
| `kinds.*.instructions` | 제공자별 지침(선택) |
| `verify.unit.command` | 서버가 직접 실행할 검증 명령 배열 |
| `verify.unit.contains` | 선택적인 성공 stdout 문자열 |

프로젝트별 소스가 다르면 같은 TOML에 별도 저장소를 추가합니다.

```toml
[repositories.another]
path = "../another-repo"
label = "다른 저장소"
verification_profiles = ["unit"]
default_verification_profile = "unit"
```

추가 저장소에는 반드시 허용된 검증 프로필 이름을 나열합니다. `repo`는 최상위 `verification_profiles`를 생략하면 등록된 모든 프로필을 허용합니다. 기본 프로필을 생략하면 허용된 `unit`, 없으면 이름순 첫 항목을 선택합니다. 상대경로는 TOML 위치 기준입니다. 모든 저장소에 커밋된 `HEAD`가 필요합니다.

Codex 어댑터는 [ACP 연결 확인](PLAN.md#acp-연결-확인)의 Node 실행 방식으로 설정합니다. `kinds.*.command`에는 `"node"`와 어댑터 `dist/index.js`의 실제 경로를 별도 인자로 넣습니다. 명령 문자열 전체를 셸에 넘기지 않습니다.

Windows에서는 `worktrees`에 원본 저장소 밖의 일반 폴더를 지정하세요. Python `TemporaryDirectory`처럼 소유자 전용 권한으로 생성된 폴더 아래에서, Codex의 `workspace-write` 샌드박스가 중첩 worktree 경로를 열지 못하는 경우를 확인했습니다. 샌드박스는 그대로 두고 작업 폴더 위치를 바꾸세요.

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

### OpenRouter Jev (선택)

실행할 백엔드 터미널에 `OPENROUTER_API_KEY`를 설정한 뒤 서버를 시작합니다. 키를 `runtime.toml`, 프론트 환경 변수, 저장소에 넣지 마세요. Windows PowerShell 7.2 이상에서는 입력을 가릴 수 있습니다.

```powershell
$env:OPENROUTER_API_KEY = Read-Host 'OpenRouter API key' -MaskInput
# 기본 모델을 바꿀 때만 필요
$env:ORCH_JEV_MODEL = 'typesafe/jev-1.14'
```

Jev는 OpenRouter [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)를 사용합니다. 기본 모델은 `typesafe/jev-1.14`이고, Jev는 아래 세 가지를 정합니다.

- **사람 메시지에 답할 에이전트**: `@이름`으로 부른 에이전트도, 답장 대상 질문도 없는 사람 메시지마다 에이전트 하나만 골라 깨웁니다. 여러 에이전트가 한꺼번에 답하지 않습니다.
- **할 일 담당**: 담당이 없는 할 일(새로 등록했거나 실패·반납·다시 실행으로 열린 할 일)마다 담당 에이전트를 정하고, 그 에이전트만 깨웁니다. 에이전트가 직접 claim하지 않습니다.
- **검증 프로필**: 할 일을 등록할 때 `verify`를 비우면 담당을 정하면서 저장소에 허용된 프로필 중 하나를 고릅니다.

에이전트끼리는 `send` 본문에 `@이름`을 넣어 대화합니다. 부른 에이전트만 깨어나고, 방의 채팅 턴 한도(`ORCH_MAX_CHAT_ROUNDS`, 기본 6) 안에서 이어집니다.

**Jev로 보내는 내용**: 답할 에이전트를 고를 때는 사람 메시지 본문, 그 앞의 최근 메시지 최대 10개(메시지마다 500자까지), 에이전트 이름·종류·`good_at`을 보냅니다. 할 일을 배정할 때는 할 일의 제목·내용·작업 범위, 에이전트 이름·종류·`good_at`·진행 중인 할 일 수, 검증 프로필 이름과 검증 명령을 보냅니다. 코드와 로컬 경로는 보내지 않습니다. 프로젝트 상태 추천에는 지금처럼 작업·에이전트·실행 자리 개수만 보냅니다.

키가 없거나 요청이 실패하면 규칙으로 정합니다. 답할 에이전트는 직전에 대화한 에이전트, 없으면 메시지에 `good_at`이 가장 많이 맞는 에이전트, 그것도 같으면 먼저 들어온 에이전트입니다. 담당은 `good_at`이 가장 많이 맞는 에이전트, 같으면 진행 중인 할 일이 적은 에이전트입니다. 검증 프로필은 저장소의 기본값입니다. 프로젝트 상태 추천은 대기 또는 에이전트 추가를 **추천**할 뿐, 자동으로 에이전트를 추가하거나 실행을 멈추지 않습니다.

대기 이유와 모델 추천은 프로젝트의 고정 상태 바 바로 아래에 표시합니다. 추천 응답이 없더라도 대기 이유는 표시됩니다.

## 4. 실제 작업 등록

API 문서 또는 프론트에서 아래 순서로 요청합니다.

1. `GET /api/runtime/options`: 선택할 수 있는 저장소 ID, 에이전트 종류, 저장소별 검증 프로필을 조회합니다. 경로와 명령은 응답에 포함되지 않습니다.
2. `POST /api/rooms`: `{"name":"데모","repository_id":"another"}`. `repository_id`를 생략하면 `default`이며, 생성 후 연결된 ID는 바뀌지 않습니다.
3. `POST /api/rooms/{id}/pause`: 준비 중 자동 채팅을 잠시 멈춥니다.
4. `POST /api/rooms/{id}/agents`: `GET /api/agent-models`의 제공자·모델·추론 수준을 선택해 프론트엔드와 백엔드 담당을 추가합니다.
5. `POST /api/rooms/{id}/tasks`: 해당 저장소에서 허용한 검증 프로필로 할 일을 등록합니다.
6. `POST /api/rooms/{id}/resume`: 에이전트들의 턴을 시작합니다.
7. `GET /api/rooms/{id}/state`: 메시지, 담당자, 작업 세션, 검증 결과를 확인합니다.

에이전트 예시:

```json
{"name":"프론트 담당", "kind":"claude", "model":"opus", "effort":"high", "good_at":["프론트엔드", "UI 구현"]}
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

**acp 모드의 verify는 명령어가 아니라 프로젝트 저장소에 허용된 검증 프로필 이름입니다.** 생략하면 Jev가 허용 목록에서 고르며, 프론트는 verify를 보내지 않습니다. 저장소를 설정에서 제거해도 프로젝트의 이력은 남지만, 에이전트나 할 일을 추가하거나 자동 진행을 재개할 수 없습니다.

화면의 할 일 입력에는 작업 범위 칸이 없습니다. API로 `scope`를 주면 작업 세션에 전달하는 지시가 되며 파일 접근 권한을 새로 제한하지는 않습니다. 아침 리뷰에는 에이전트가 `@human`으로 사람에게 보낸 미답변 질문만 올라옵니다. 답장하면 해당 메시지 ID가 저장되며, 일반 채팅이나 다른 질문의 답변은 그 질문을 닫지 않습니다.

## 완료 판정

작업 턴의 `stop_reason == end_turn`만으로 완료하지 않습니다. 에이전트 종료 후 서버가 같은 worktree에서 등록된 검증 명령을 다시 실행합니다.

- 종료 코드 0, 설정된 성공 출력 조건 충족, `commit` 도구로 남긴 커밋 있음, 방 브랜치 빨리 감기 성공 → `done`
- 검증 실패, 커밋 없음, 방 브랜치 빨리 감기 불가, 비정상 턴 종료, 시간 초과, 실행 오류 → 인계 기록과 함께 `open`
- 사용자가 실행을 중단하면 해당 할 일만 `open / retry_required=1`로 보류됩니다. 방을 재개하거나 서버를 재시작해도 자동으로 다시 맡지 않습니다. 프로젝트 또는 아침 리뷰에서 `다시 실행`을 눌러 보류를 해제합니다.
- 성공/실패와 관계없이 worktree는 보존합니다. 시도마다 `ycton/task-<할 일>-<세션>` 브랜치에서 작업합니다.
- 방마다 결과가 쌓이는 `ycton/room-<방>` 브랜치가 있습니다. 없으면 첫 시도가 원본 checkout의 HEAD에서 만들고, 모든 시도는 이 브랜치 끝에서 시작하므로 뒤 할 일이 앞 할 일의 결과 위에서 작업합니다.
- 검증을 통과하고 커밋이 있으면 서버가 방 브랜치를 그 커밋으로 빨리 감기(`git update-ref`, 이전 값 확인)합니다. 그사이 다른 할 일이 방 브랜치를 먼저 옮겨 빨리 감기할 수 없으면 병합하지 않고 그 시도를 실패로 돌립니다. 다시 맡은 시도는 새 끝에서 시작합니다.
- 커밋은 작업 에이전트가 `commit` 도구로 고른 파일만 합니다. done이 되면 할 일에 커밋 해시가 연결됩니다. 사용자가 체크아웃한 원본 브랜치는 건드리지 않고 병합도 하지 않습니다. 결과를 가져가려면 `ycton/room-<방>` 브랜치를 직접 병합하세요.

검증 명령은 stdout 최대 1MB를 저장하고 stderr는 서버 터미널에 출력합니다. `contains`는 저장한 stdout 범위에서 확인합니다. 실제 앱 실행·테스트에 필요한 의존성은 사용자가 검증 환경에 준비해야 합니다.

프로젝트의 할 일·채팅 세션과 아침 리뷰 원장에서 실행 상세 및 ACP 로그를 펼칠 수 있습니다. 화면에는 공개 응답과 도구 상태 등 필요한 이벤트만 표시합니다. 원본 ACP 추론과 도구 인자·출력은 서버 파일에만 남습니다.

## 운영 범위

한 서버 프로세스만 사용하세요. 자동 reload와 여러 workers는 지원하지 않습니다. 같은 DB로 두 서버를 띄우지 마세요. 기존 DB에는 저장소 ID, 보류 플래그, 답장 대상 열을 자동으로 추가합니다. 기존 프로젝트는 `default`에 연결됩니다.

pause는 새 실행 시작만 멈춥니다. 실행 중 작업은 별도 cancel로 취소합니다. 서버 재시작은 기존 방을 일시 중지하고 남은 실행을 실패 기록으로 정리합니다. 비정상 강제 종료 후 외부 프로세스의 존재 확인은 별도 운영 작업입니다.

자동 에이전트 추가, 위키·이슈·think, WebSocket, 파일 충돌 조정은 범위에 포함하지 않습니다.
