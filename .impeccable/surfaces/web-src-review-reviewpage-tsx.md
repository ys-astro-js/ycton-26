---
version: 1
slug: "web-src-review-reviewpage-tsx"
primary_target: "web/src/review/ReviewPage.tsx"
related_targets: []
---

# 아침 리뷰 화면 (afk)

Scope: 아침 리뷰 화면(`/`), Operate 모드. 사람이 자리를 비운 동안 모든 프로젝트(= 채팅방)에서 일어난 일을 몰아서 확인하고, 판단이 필요한 것에 답한다. 기본은 전체 프로젝트, 프로젝트별로 좁혀 볼 수 있어야 한다.

Audience/job: 에이전트를 여러 개 굴리는 개발자가 아침에 (1) 멈춘 것(Jev stop, 실패·시간 초과 서브세션)과 에이전트의 질문을 먼저 처리하고 (2) 밤사이 끝난 할 일, 커밋, 인계 노트를 훑고 (3) 필요한 행의 세션 로그까지 따라간다.

Pinned constraints (user): 가운뎃점(·) 사용 금지. 메타 정보, 수치, 컨트롤을 한 줄로 무지성 가로 나열하지 않는다. 라벨/값 블록, 표의 열, 섹션 제목의 수치처럼 구조로 배치한다. 카드 대시보드, 채팅 로그 덤프, 다크 관제판 금지.

Content: 전부 예시 데이터(화면에 '예시 데이터' 표시). 실제 고객, 수치 없음. 백엔드 API 없음.

Approved comp: .impeccable/mocks/comp-3.png

Unresolved: Jev stop 알림 방식, 할 일과 이슈의 관계(PRD 열린 질문).

## Direction contract

THESIS: 밤사이 일을 git log --graph를 밝은 원장으로 옮긴 표로 읽는다. 사람이 처리할 것은 맨 위 빨간 표에, 나머지는 프로젝트별 커밋 레인 원장에 둔다. 카드 그리드 대시보드와 다크 관제판, 가운뎃점으로 잇는 메타 줄을 거부한다.

OWN-WORLD: 미색 종이 #F4F3EE, 잉크 #1B1B1B, 완료·병합은 그린 #2F6F4F, 사람이 처리할 것에만 레드 #C8402A. 시각·해시·할 일 번호는 고정폭 모노, 한국어는 산세리프. hairline 괘선, 그림자·둥근 카드 없음, 상태는 작은 칩과 레인 노드(채운 점 = done, 빈 점 = 진행/dropped)로.

STORY: 들어오면 무엇이 멈췄고 무엇을 답해야 하는지 즉시 안다. 왼쪽 레일로 프로젝트를 좁히고, 행을 펼쳐 인계 노트와 세션 로그를 그 자리에서 읽고 처리한 뒤, 에이전트를 믿고 다시 자리를 비운다.

FIRST VIEWPORT: 왼쪽 위 큰 '아침 리뷰'와 작은 afk 워드마크, 옆에 기간/프로젝트/예시 데이터 라벨-값 블록, 오른쪽 위 프로젝트 선택. 왼쪽 레일에 전체와 프로젝트별 수. 본문 맨 위 '처리 필요 3'(빨간 숫자) 표: 시각·프로젝트·상황·조치 열, 빨간 주 버튼과 테두리 보조 버튼. T-41 행이 펼쳐져 왼쪽에 인계 노트, 오른쪽에 모노 세션 로그. 그 아래 '밤사이 기록'과 오른쪽 세로 집계(완료/진행 중/커밋), 프로젝트별 원장 행과 커밋 레인 노드.

FORM: 커밋 그래프 원장(git log --graph 터미널 출력의 밝은 원장), 내 목록 1번째(IMPECCABLE’S PICK), seed key 81804d92. 서명 인터랙션: 행을 펼치면 나머지 행이 옅어지고 인계 노트와 세션 로그가 행 아래로 줄 단위로 풀려 나온다. 레일에서 프로젝트를 고르면 원장이 그 프로젝트로 접히며 레인이 다시 이어진다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
