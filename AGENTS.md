# AGENTS.md

이 저장소에서 작업하는 모든 에이전트(Claude Code, Codex 등)가 따라야 하는 지침입니다.

## Commit Convention

커밋 메시지는 아래 형식을 따릅니다.

```
<type>: <summary>

<body (선택)>
```

### 허용되는 type (이 4개만 사용)

| type    | 용도 |
|---------|------|
| `feat`  | 새로운 기능 추가 또는 기존 기능의 동작 변경 |
| `fix`   | 버그 수정 |
| `docs`  | 문서만 변경 (README, AGENTS.md, 주석 위주의 변경 등) |
| `chore` | 빌드 설정, 의존성, 설정 파일, 리팩터링, 테스트 등 위에 해당하지 않는 모든 변경 |

- `refactor`, `style`, `test`, `perf`, `ci`, `build` 등 다른 type은 **사용하지 않습니다.** 해당 변경은 성격에 따라 위 4개 중 하나로 분류합니다(대부분 `chore`).
- scope는 붙이지 않습니다. (`feat(api):` ✗ → `feat:` ✓)
- summary는 명령형·현재형으로, 마침표 없이, 72자 이내로 작성합니다.
- body는 "무엇을"보다 "왜"를 설명할 때만 작성합니다.

### 예시

```
feat: add user login endpoint
fix: handle empty response from search API
docs: describe local setup in README
chore: add ruff and eslint configs
```

## Atomic Commit 지침

하나의 커밋은 **하나의 논리적 변경**만 담습니다.

1. **한 커밋 = 한 목적.** 커밋 메시지를 "and"/"그리고" 없이 한 문장으로 설명할 수 없다면 커밋을 나눕니다.
2. **type이 섞이면 분리합니다.** 기능 추가(`feat`)와 버그 수정(`fix`), 문서(`docs`), 설정(`chore`)을 한 커밋에 섞지 않습니다.
3. **각 커밋은 독립적으로 동작해야 합니다.** 어느 커밋으로 checkout 하더라도 빌드·테스트가 깨지지 않도록 합니다. 미완성 코드나 디버그용 코드를 커밋하지 않습니다.
4. **관련 없는 변경을 끼워 넣지 않습니다.** 작업 중 발견한 무관한 수정(포맷팅, 오타, 리팩터링)은 별도 커밋으로 분리합니다.
5. **스테이징은 의도적으로 합니다.** `git add -A` / `git add .` 대신 파일(또는 hunk) 단위로 명시적으로 스테이징하고, 커밋 전 `git diff --staged`로 내용을 확인합니다.
6. **코드와 그 코드의 테스트·타입 변경은 같은 커밋에 둡니다.** 하나의 변경을 완성하는 데 필요한 파일들은 함께 커밋합니다.
7. **비밀 정보를 커밋하지 않습니다.** `.env`, 키, 토큰 등은 `.gitignore`에 포함되어 있으며, 실수로 스테이징되지 않았는지 확인합니다.
