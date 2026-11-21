# ycton-26

여러 코딩 에이전트가 하나의 프로젝트에서 토론으로 일을 나눠 가져가고, 사람이 보고 있지 않아도 작업을 이어 가며, 그 과정과 기록이 한곳에 쌓이는 **로컬 멀티 에이전트 관리 도구**입니다.

> **상태**: ACP 런타임과 오케스트레이션 백엔드를 구현했습니다. 자동 테스트와 MCP·HTTP·SQLite 연결을 검증했으며, 이 통합본의 실제 모델 전체 흐름은 별도 검증이 필요합니다. 설치·실행은 [ORCHESTRATION.md](ORCHESTRATION.md)를 참고하세요. 아래 기능 설명과 로드맵에는 아직 구현하지 않은 기획도 포함됩니다.

## 왜 만드나

Claude Code, Codex 같은 코딩 에이전트를 여러 개 동시에 쓰면, 개발자는 코드보다 에이전트의 진행 확인, 작업 분배, 지시 반복에 더 많은 주의를 씁니다. 이 도구의 목표는 그 인지 부하를 줄이는 것입니다. 사람이 신경 쓰지 않아도 알아서 돌아가는 것("알잘딱")이 기준입니다.

| 문제 | 이 도구의 해결 방식 |
| --- | --- |
| 어떤 에이전트가 무엇을 하는지 모름 | 프로젝트, 할 일, 이슈, 위키 한곳에서 현재 작업과 이력을 봅니다. |
| 사람이 계속 지켜봐야 함 | 에이전트들이 토론으로 담당을 정하고, Jev가 spawn과 go/stop을 판단합니다. |
| 같은 지시를 반복 | 에이전트 종류와 종류별 AGENTS.md를 한 번만 정의합니다. |
| 채팅 에이전트의 컨텍스트 누적 | 실제 작업은 서브세션에 맡기고, 채팅 쪽에는 결과 요약만 남깁니다. |

## 동작 방식

```
사람 ──▶ 프로젝트 ◀──▶ 채팅 에이전트들 (토론으로 할 일 claim)
                         │ delegate
                         ▼
                    서브세션 (git worktree에서 작업 → commit → 인계 노트)
                         │
           Jev ── spawn / 대기 / 우선순위 / go·stop 판단
```

1. 사람이 **에이전트 종류**를 YAML로 정의합니다. 종류마다 쓸 에이전트 CLI, 채팅·작업·think 모델, 잘하는 작업(`good_at`), 종류별 AGENTS.md를 정합니다.
2. **프로젝트**을 만들고 작업 폴더(git 저장소)를 지정한 뒤 에이전트를 추가합니다.
3. 사람이 요청하면 **채팅 에이전트**들이 토론해 할 일을 나누고, 각자 claim합니다.
4. 채팅 에이전트는 `delegate` 도구로 할 일을 **서브세션**에 맡기고 대화를 계속합니다.
5. 서브세션은 각자 git worktree에서 작업하고, 고른 파일만 커밋한 뒤 결과 요약을 할 일과 프로젝트에 남깁니다.
6. 사람이 없는 동안에는 **Jev**(가벼운 decision 모델)가 대기·spawn·우선순위·stop을 판단합니다.

에이전트 종류 정의 예시:

```yaml
- name: frontend
  cli: claude                       # claude | codex
  command: null                     # 비우면 CLI별 기본 ACP 실행 명령
  chat: sonnet:medium               # 채팅 턴 모델:effort
  work: opus:medium                 # 서브세션 모델:effort
  think: opus:high                  # think 턴 모델:effort
  good_at: [프론트엔드, UI 구현]
  agents_md: types/frontend.md
```

## 지원 에이전트

서버가 [Agent Client Protocol(ACP)](https://github.com/agentclientprotocol/python-sdk) 클라이언트가 되어 로컬에 설치·로그인된 에이전트를 직접 실행합니다. 사용량은 각 계정의 것을 씁니다.

| 에이전트 CLI | 연결 방식 |
| --- | --- |
| Claude Code | [claude-agent-acp](https://github.com/zed-industries/claude-agent-acp) 어댑터 |
| Codex | [codex-acp](https://github.com/agentclientprotocol/codex-acp) 어댑터 |

Gemini CLI는 2026년 6월 18일 개인 사용자 서비스가 종료되었고, 후속인 Antigravity CLI(`agy`)는 ACP를 지원하지 않아 연결하지 않습니다.

## 기술 스택

| 영역 | 선택 |
| --- | --- |
| 백엔드 | Python, uv, FastAPI(HTTP API, WebSocket), Uvicorn, asyncio |
| 프론트엔드 | React + TypeScript, Vite, TanStack Router, TanStack Query, bun |
| 데이터 | SQLite 하나(채팅, 할 일, 이슈, 위키, 세션 기록), 에이전트 종류는 YAML |
| 에이전트 연결 | ACP 공식 Python SDK `agent-client-protocol` |
| 프로젝트 도구 | stdio MCP 서버(세션마다 `session/new`의 `mcpServers`로 전달) |

브라우저로 접속하는 로컬 웹 앱이며, 나중에 Electron으로 감쌀 수 있게 프론트는 정적 SPA로, 백엔드는 독립 프로세스로 만듭니다. 서버는 `127.0.0.1`에만 바인딩합니다.

## 로드맵

| 단계 | 포함 기능 | 완료 기준 |
| --- | --- | --- |
| MVP | 프로젝트, ACP 실행, 서브세션 위임, 할 일, 스케줄러 (F1–F15) | 사람의 첫 요청 이후 추가 개입 없이 기능 하나를 커밋까지 끝냅니다. |
| 2단계 | Jev, 이슈, 위키, think 턴 (F16–F20) | 자는 동안 맡기기, 지난 작업 추적이 가능합니다. |
| 3단계 | 위키 토론, stop 알림 (F21–F22) | 위키 토론과 Jev stop 알림이 동작합니다. |

## 문서

- [ORCHESTRATION.md](ORCHESTRATION.md): 백엔드 설치·실행, mock/ACP 설정과 검증
- [코드별 역할](docs/CODE_GUIDE.md), [API 계약](docs/API.md), [검증 결과](docs/VALIDATION.md)

- [PRD.md](PRD.md): 문제 정의, 기능 요구사항(F1–F22), 비기능 요구사항, 성공 지표, 리스크
- [PLAN.md](PLAN.md): 상세 설계(턴 흐름, 서브세션, 스케줄러, 프로젝트 MCP 도구, 모델 기본값), 기존 도구와의 비교
- [AGENTS.md](AGENTS.md): 이 저장소에서 작업하는 에이전트를 위한 지침

## Contributing

커밋 컨벤션과 atomic commit 지침은 [AGENTS.md](AGENTS.md)를 따릅니다.

- 커밋 type은 `feat`, `fix`, `docs`, `chore`만 사용합니다.
- 하나의 커밋에는 하나의 논리적 변경만 담습니다.
