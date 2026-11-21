---
name: afk
description: 맡기고 자리를 비운 개발자가 돌아와 밤사이 일을 확인하고 처리하는 로컬 도구
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.556 0 0)"
  border: "oklch(0.922 0 0)"
  input: "oklch(0.922 0 0)"
  ring: "oklch(0.708 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  attention: "oklch(0.577 0.245 27.325)"
  attention-foreground: "oklch(0.505 0.213 27.518)"
  live: "oklch(0.546 0.245 262.881)"
typography:
  title:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  heading:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.5556
  body:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.5
  caption:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.3333
  button:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3333
    letterSpacing: "0.1em"
  mono:
    fontFamily: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"tnum\" 1"
rounded:
  none: "0px"
  full: "9999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
components:
  icon-button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.none}"
    size: "36px"
  icon-button-primary-hover:
    backgroundColor: "oklch(0.205 0 0 / 0.8)"
  icon-button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.none}"
    size: "36px"
  icon-button-outline-hover:
    backgroundColor: "{colors.muted}"
  icon-button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.none}"
    size: "36px"
  icon-button-ghost-hover:
    backgroundColor: "{colors.muted}"
  text-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "40px"
  count-badge-attention:
    backgroundColor: "{colors.attention}"
    textColor: "oklch(1 0 0)"
    typography: "{typography.mono}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
    width: "24px"
  count-badge-quiet:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.mono}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
    width: "24px"
  status-label:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
  status-label-live:
    textColor: "{colors.live}"
  rail-link:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "36px"
  rail-link-current:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
  list-surface:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.none}"
  text-field:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.none}"
    padding: "12px 0"
    height: "64px"
  tooltip:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
---

# Design System: afk

## Overview

**Creative North Star: "중립 회색 위의 원장"**

afk의 화면은 밤사이 일어난 일을 위에서 아래로 읽어 내려가는 원장입니다. 모든 UI 요소는 shadcn/ui(preset b1oVxsfY, style base-sera, Base UI 기반, neutral 기본색) 컴포넌트로 만들고, 토큰은 그 preset이 정의한 무채색 oklch 단계를 그대로 씁니다. 바탕과 표면은 모두 흰색이고, 표면은 그림자 없이 1px 괘선 하나로 구분됩니다. 모서리는 각지고, 정보는 카드 격자가 아니라 행으로 흐릅니다. 행을 펼치면 인계 노트와 세션 로그가 그 자리에서 열립니다.

색은 장식이 아니라 두 가지 뜻만 실어 나릅니다. 빨강(attention)은 사람이 처리해야 할 것, 파랑(live)은 지금 진행 중인 것입니다. 완료는 강조하지 않습니다. 끝난 일은 조용한 회색으로 물러나고, 사람의 눈은 남은 일에만 갑니다. 초록은 어디에도 없습니다.

밀도는 높되 한 줄에 메타 정보를 늘어놓지 않습니다. 시각, 해시, 할 일 번호는 Geist Mono 고정폭으로, 한국어 본문은 Pretendard Variable로 씁니다. preset의 Inter는 의도적으로 Pretendard로 바꿨습니다. 버튼은 아이콘 버튼이거나 글자 버튼이고, 둘을 섞지 않습니다. 모든 아이콘은 lucide-react의 1.75 획 선 아이콘이며 currentColor를 따릅니다.

**Key Characteristics:**
- shadcn/ui base-sera 컴포넌트와 neutral oklch 토큰, 각진 모서리, 그림자 없음
- 흰 바탕 위 흰 행 목록 표면을 1px 괘선으로 나눔
- 색은 attention(빨강)과 live(파랑) 두 뜻에만 씀
- 상태 어휘는 완료 / 진행 중 / 대기 / 실패 / 제외 다섯 가지, 상태마다 아이콘 하나
- 버튼은 아이콘 전용(aria-label과 툴팁) 또는 글자 전용 중 하나
- 한국어는 Pretendard Variable, 시각과 해시와 번호는 Geist Mono tabular-nums

## Colors

shadcn neutral preset의 무채색(chroma 0) oklch 단계 위에 빨강과 파랑을 신호로만 얹는 팔레트입니다. 토큰은 `web/src/index.css`의 `:root`에 있고, 컴포넌트는 Tailwind 테마 이름(`bg-muted`, `text-muted-foreground`, `bg-attention`, `text-live`)으로만 색을 씁니다. 같은 파일에 `.dark` 값도 정의되어 있지만 지금 화면은 밝은 테마만 씁니다.

### Primary
- **주의 빨강** (attention): 사람이 처리할 것에만 씁니다. 처리할 일 행의 종류 아이콘(멈춤, 시간 초과, 실패, 질문)과 남은 처리할 일 개수 배지의 채움입니다. 처리가 끝난 행의 아이콘은 즉시 muted 회색으로 물러납니다. preset의 destructive와 같은 값이며, destructive는 입력 오류(필드 라벨, 오류 문구, 밑줄)에만 나타납니다.
- **주의 글자 빨강** (attention-foreground): 빨강이 글자로 쓰일 때의 더 짙은 단계입니다. 세션 로그의 timeout, error 줄에 씁니다.

### Secondary
- **진행 파랑** (live): 지금 돌아가는 것에만 씁니다. 진행 중 행의 레인 노드에서 돌아가는 표시(loading-dev `Arc`)입니다.

### Neutral
- **바탕 흰색** (background / card): 페이지 바탕과 행 목록 표면이 같은 흰색입니다. 표면은 색이 아니라 괘선으로 드러납니다.
- **옅은 회색** (muted): 호버와 현재 레일 항목의 채움입니다. 펼쳐진 행은 이 색의 50%로 한 단 가라앉습니다.
- **잉크** (foreground / primary): 본문 글자, 주 버튼의 채움, 툴팁 바탕입니다. primary는 foreground보다 반 단계 밝은 잉크입니다.
- **흐린 회색** (muted-foreground): 보조 글자와 아이콘, 시각, 라벨, 완료와 제외 상태, 제외된 항목의 제목입니다.
- **괘선 회색** (border / input): 표면 테두리, 행 사이 hairline, 레인 세로선, 입력 필드 밑줄, outline 버튼 테두리입니다.
- **링 회색** (ring): 포커스된 컨트롤의 테두리와 반투명 링, 포커스된 입력 필드의 밑줄입니다.

### Named Rules
**The Two Meanings Rule.** 색은 attention(빨강)과 live(파랑) 두 뜻만 가집니다. 새 화면에서 색을 쓰려면 둘 중 어느 뜻인지 먼저 답해야 하고, 답할 수 없으면 무채색입니다.

**The Quiet Done Rule.** 완료는 강조하지 않습니다. 초록을 쓰지 않으며, 완료 상태는 흐린 회색 글자와 채운 muted-foreground 점으로만 표시합니다.

**The Red Is Not A Button Rule.** 빨강은 파괴적이지 않은 동작의 버튼에 쓰지 않습니다. 처리할 일 행의 주 동작도 잉크색 버튼입니다.

## Typography

**Body Font:** Pretendard Variable (Pretendard, -apple-system, system-ui, Apple SD Gothic Neo 대체)
**Label/Mono Font:** Geist Mono Variable (ui-monospace, SF Mono, Menlo 대체)

**Character:** 한 가족의 산세리프가 제목부터 캡션까지 굵기만 바꿔 위계를 만들고, 기계가 남긴 값(시각, 커밋 해시, 할 일 번호, 세션 로그)만 고정폭으로 갈라집니다. 두 글꼴은 Tailwind 테마의 `--font-sans`, `--font-mono`로 연결되어 있고, preset이 넣은 Inter를 대신합니다.

### Hierarchy
- **Title** (700, 28px, 1.25, -0.025em): 화면 제목 하나("아침 리뷰"). text-wrap: balance.
- **Heading** (600, 18px): 구역 제목("처리할 일", "기록"), 옆에 개수 배지를 둡니다.
- **Body** (400, 15px, 1.5): 원장 행 제목, 레일 링크, 인계 노트. 설명 문단은 최대 65ch, 인계 노트는 60ch.
- **Label** (600, 13px): 패널 제목(인계 노트, 세션 로그), 프로젝트 그룹 이름. 메타 값은 같은 13px에 400.
- **Caption** (400, 12px): 라벨-값 블록의 라벨, 툴팁, 예시 데이터 배지.
- **Button** (600, 12px, 0.1em, 대문자): shadcn base-sera 버튼의 기본 글자입니다. 한글에는 대문자 변환이 의미가 없고, 글자 버튼의 모양을 바꿀 때는 className으로 덮어씁니다.
- **Mono** (400, 13px, tabular-nums): 시각, 기간, 해시, 할 일 번호, 세션 로그 전체, 개수 배지와 레일의 처리할 일 건수(12px).

### Named Rules
**The Fixed Scale Rule.** 글자 크기는 12 / 13 / 15 / 18 / 28px 다섯 단계이며 rem으로 지정합니다. 루트 글자 크기는 뷰포트에 따라 바꾸지 않습니다. 입력 필드만 좁은 화면에서 iOS 확대를 막기 위해 16px입니다.

**The Machine Values Rule.** 사람이 아니라 기계가 만든 값은 Geist Mono에 tabular-nums로 씁니다. 숫자 열이 세로로 정렬되어야 원장이 읽힙니다.

## Layout

최대 너비 80rem의 가운데 정렬 컨테이너, 좌우 여백 16px(40rem 이상 32px). 넓은 화면(64rem 이상)에는 머리 띠가 없습니다. 레일이 이미 현재 화면을 표시하므로 제목은 sr-only `h1`로만 남기고, 조작은 그 조작이 다루는 내용 옆에 둡니다. 프로젝트 화면의 자동 진행 멈추기·재개는 본문 맨 위의 상태 줄("자동 진행 중" 또는 "자동 진행 멈춤"과 이유)에 있고, 이 줄은 위에 붙어 있습니다. 리뷰의 프로젝트 선택은 "기록" 제목 줄 끝에 있고 기록에만 적용합니다. 처리할 일은 몇 건 안 되고 급하므로 가리지 않습니다. 레일의 워드마크 줄과 본문 첫 줄은 모두 위에서 24px, 높이 36px로 같은 자리에 섭니다. 레일이 없는 좁은 화면에서는 `--page-header-height`(5.25rem) 높이의 제목 머리가 위에 붙습니다. 라벨-값 쌍을 나열하는 통계 머리는 두지 않습니다. 본문은 64rem 이상에서 13.5rem 고정 레일과 가변 본문의 2열이고, 레일은 sticky입니다. 구역 사이 간격은 40px입니다.

간격은 Tailwind 4px 단위의 4 / 6 / 8 / 12 / 16 / 24 / 32 / 40px 단계를 씁니다. 행 안쪽 여백 16px, 아이콘과 글자 사이 6px이 기본 리듬입니다.

반응형은 세 단계로 접힙니다. 64rem 이하에서는 레일이 사라지고 메뉴 버튼으로 여는 같은 내비게이션으로 바뀝니다. 원장은 컨테이너 쿼리(52rem 미만)로 한 줄 그리드를 세 줄 블록(번호와 제목, 시각과 상태, 에이전트와 커밋)으로 재배치합니다. 40rem 미만에서는 헤더가 한 열이 되고, 처리할 일 행의 버튼이 본문 아래로 내려갑니다. 펼친 패널은 48rem 이상(원장은 컨테이너 52rem 이상)에서 인계 노트와 세션 로그를 두 열로 둡니다.

### Named Rules
**The No Metadata String Rule.** 메타 정보는 라벨-값 블록이나 아이콘이 붙은 개별 항목으로 둡니다. 가운뎃점(·)으로 잇는 한 줄 나열은 쓰지 않습니다. 화면이 좁아지면 줄을 나누고, 한 줄에 우겨넣지 않습니다.

## Elevation & Depth

완전히 평평합니다. 그림자는 어디에도 없습니다. 표면은 1px 괘선(border)으로 경계를 짓고, 깊이는 색조로만 만듭니다. 펼쳐진 행은 muted 50%로 한 단 가라앉고, 호버는 muted로 채웁니다. 떠 있는 요소는 툴팁 하나이며, 그림자 대신 잉크 바탕의 반전으로 구분됩니다.

### Named Rules
**The Hairline Surface Rule.** 표면은 그림자가 아니라 1px 괘선으로 드러납니다. 행, 버튼, 배지, 표면 어디에도 그림자를 주지 않습니다.

## Shapes

모서리는 각집니다. base-sera 스타일의 버튼, 배지, 입력, 툴팁, 표면은 모두 반경 0입니다. preset은 `--radius`(0.625rem)와 그 배수 단계를 정의하지만, 지금 쓰는 컴포넌트는 그 단계를 쓰지 않습니다. 원형은 레인 노드 하나뿐입니다. 행 사이는 1px hairline으로 나눕니다.

원장의 서명 형태는 레인입니다. 프로젝트 그룹마다 행의 노드를 잇는 2px 괘선색 세로선이 흐르고, 선은 노드 위아래 0.5rem에서 끊깁니다. 첫 행 위와 마지막 행 아래로는 선을 긋지 않습니다. 노드가 곧 상태 표시입니다. 네 상태 모두 같은 16px 원(24 기준 화면, 반지름 10, 선 굵기 2.5) 하나로 그립니다. 완료는 체크 원(lucide `CircleCheck`), 대기는 점선 원(`CircleDashed`), 제외는 X 원(`CircleX`)으로 모두 muted-foreground이고, 실패만 느낌표 원(`CircleAlert`)을 attention 빨강으로 둡니다. 실패한 행의 시간은 완료처럼 시작–끝으로 씁니다. 진행 중은 괘선색 바탕 고리 위에서 live 색 loading-dev `Arc`가 돌며(reduced motion에서는 멈춤), 같은 지름이라 한 계열로 읽힙니다. 상태 이름은 노드 옆 sr-only 글자로만 전하고, 행 오른쪽에 상태를 다시 쓰지 않습니다.

## Components

모든 UI 요소는 shadcn/ui 컴포넌트입니다(`web/src/components/ui`). 손으로 만든 컨트롤은 두지 않고, 필요한 것이 없으면 같은 preset으로 shadcn 컴포넌트를 추가합니다. 모양을 바꿀 때는 shadcn 컴포넌트에 className을 넘겨 덮어씁니다.

### Buttons
도구처럼 조용하고 확실한 버튼입니다. 버튼은 아이콘 버튼이거나 글자 버튼이고, 아이콘과 글자를 함께 넣지 않습니다.
- **Icon Button:** 표준 아이콘 하나로 동작이 통하면 `IconButton`(`web/src/components/icon-button.tsx`)을 씁니다. 각진 36px 정사각형, 14px lucide 아이콘, 동사로 쓴 `label`이 aria-label과 툴팁 문구가 됩니다.
- **Primary:** 잉크(primary) 채움에 밝은 아이콘. 행마다 하나만 둡니다(재개하기, 다시 맡기기, 답하기, 답장 보내기). 호버에서 80% 불투명도로 옅어집니다.
- **Ghost:** 테두리와 배경 없음. 되돌리기에 씁니다.
- **Text Button:** 아이콘으로 뜻이 서지 않는 동작(예: "편집")은 글자만 둔 shadcn `Button`입니다. preset 기본은 40px 높이, 좌우 24px, 12px 600 넓은 자간입니다.
- **Hover / Press / Focus:** 호버는 배경색만 바뀝니다. 누르면 1px 내려갑니다. 포커스는 테두리가 ring으로 바뀌고 ring 30%의 2px 링이 둘러집니다.

### Count Badge
- **Style:** shadcn `Badge`에 각진 모서리, 최소 너비 24px, 12px mono tabular-nums.
- **State:** 처리할 것이 남을 때만 attention 채움에 흰 숫자로 나타납니다. 0이 되면 "처리할 일" 제목과 배지를 함께 지우고, 구역 전체를 "처리할 일이 없습니다" 한 문장(카드, 32px 원형 체크, 18px 600)으로 바꿉니다. 마지막 항목을 처리해 0이 된 순간에만 원과 체크가 한 번 그려지고(420ms + 260ms, 동작 줄이기에서는 바로 나타남), 처음부터 0이면 움직이지 않습니다. 처리한 항목은 되돌릴 수 있게 그 아래에 흐리게 남습니다.

### Cards / Containers
- **Corner Style:** 각진 모서리(0)
- **Background:** card 흰색
- **Shadow Strategy:** 없음(Elevation & Depth 참고)
- **Border:** 1px 괘선, 행 사이는 hairline
- **Internal Padding:** 처리할 일 행 16px, 원장 행 좌우 16px 위아래 8px

### Inputs / Fields
- **Style:** shadcn `Field`, `Textarea`, `NativeSelect`. 상자 없이 아래 1px input 밑줄만 있는 각진 필드입니다. 답장 입력은 최소 64px, 내용에 맞춰 자라며 크기 조절 손잡이는 없습니다. 좁은 화면 16px, 48rem 이상 14px 글자.
- **Focus:** 밑줄이 ring으로 바뀝니다.
- **Error:** 밑줄과 필드 라벨이 destructive로 바뀌고 아래에 오류 문구가 붙으며 필드로 포커스가 돌아갑니다.

### Navigation
- **Style:** 왼쪽 레일의 세로 링크 목록. 36px 높이, 좌우 12px, 15px 흐린 회색 글자, 왼쪽 16px 아이콘, 오른쪽 끝에 그 프로젝트의 처리할 일 건수(12px mono 600, attention 글자). 0이면 숫자를 쓰지 않습니다. 링크는 버튼이 아니므로 아이콘과 글자를 함께 둡니다.
- **Current:** muted 채움, foreground 글자 600.
- **Mobile:** 64rem 이하에서 헤더의 shadcn `NativeSelect`(40px, 밑줄형, 오른쪽 chevron)로 바뀝니다.

### Tooltip
아이콘 버튼마다 붙습니다. 잉크 바탕에 흰 12px 글자, 각진 모서리와 화살표, 위쪽에 열리며 짧게 페이드와 확대로 나타납니다.

### Status
어휘는 **완료**, **진행 중**, **대기**, **실패**, **제외** 다섯 가지입니다. 대기는 아직 아무도 맡지 않은 할 일(점선 원)이고, 실패는 서버가 open으로 되돌렸지만 마지막 작업 세션이 실패하거나 시간 초과된 할 일(느낌표 원, attention 빨강)입니다. 원장에서는 상태를 한 곳, 레인 노드로만 보여 줍니다(Lane 참고). 같은 정보를 행 오른쪽 배지나 구역 위 집계(완료 n, 진행 중 n, 커밋 n)로 다시 늘어놓지 않습니다. 제외된 행은 제목을 흐린 색에 취소선으로 두고, 사유 글자는 화면에 쓰지 않습니다(노드 옆 sr-only 글자에만 "제외 (중복)"처럼 담습니다).

### Disclosure Row
처리할 일 행과 원장 행은 같은 방식으로 펼칩니다. shadcn `Collapsible`의 측정 높이(`--collapsible-panel-height`)를 0에서 250ms ease-out으로 전환하고, `prefers-reduced-motion`에서는 전환을 없앱니다. 별도의 펼침 버튼은 두지 않습니다. 행 머리 전체가 클릭 영역이고, 그 실체는 제목 글자만 담은 native `<button aria-expanded aria-controls>`입니다(글자 전용 버튼). 클릭 영역은 버튼의 `::after`를 행 전체로 넓혀서 만들고, 행 안의 다른 버튼(재개하기 등)은 그 위에 올라가 따로 동작합니다. 펼칠 수 있다는 단서는 행 오른쪽 끝의 장식용 꺾쇠(aria-hidden, 펼치면 180° 회전)와 호버 배경, 손가락 커서입니다. 키보드 포커스는 행 전체 외곽선으로 보이고, Enter와 Space로 펼칩니다. "클릭하면 펼쳐집니다" 같은 안내 문구는 쓰지 않습니다. 펼친 패널은 인계 노트(본문 글꼴)와 세션 로그(mono, 시각 / 종류 / 내용 3열)를 나란히 두고, 좁은 폭에서 한 열로 쌓습니다.

### Icons
lucide-react 선 아이콘만 씁니다. 획 1.75, currentColor, 크기는 12 / 14 / 16 / 20px. 장식 아이콘은 `aria-hidden`이고, 아이콘만으로 뜻을 전하는 곳(종류 아이콘, 사실 목록의 라벨)에는 sr-only 글자를 함께 둡니다.

### Named Rules
**The Icon Or Text Rule.** 버튼은 아이콘 버튼이거나 글자 버튼이고, 둘 다인 버튼은 없습니다. 표준 아이콘 하나로 동작이 통하면 아이콘 버튼(aria-label과 동사 툴팁)을, 아니면 글자 버튼을 씁니다. 프로젝트 레일의 내비게이션 링크는 버튼이 아니므로 아이콘을 글자 옆에 둘 수 있습니다.

**The shadcn First Rule.** 모든 UI 요소는 shadcn/ui(preset b1oVxsfY, style base-sera, Base UI)로 표준화합니다. 특정한 모양 때문이 아니라 디자인 시스템을 하나로 유지하기 위해서입니다. 새 UI는 있는 shadcn 컴포넌트를 쓰거나 shadcn 컴포넌트를 추가하고, 직접 만든 컨트롤을 두지 않습니다. 모양은 shadcn 컴포넌트의 className으로 덮어씁니다.

## Do's and Don'ts

### Do:
- **Do** 색을 쓰기 전에 attention(사람이 처리할 것)인지 live(지금 진행 중)인지 답하세요. 둘 다 아니면 무채색입니다.
- **Do** 색은 Tailwind 테마 이름(`bg-muted`, `text-muted-foreground`, `bg-attention`, `text-live`)으로 쓰고, 임의의 색 값을 넣지 마세요.
- **Do** 새 UI는 shadcn/ui 컴포넌트를 쓰거나 같은 preset으로 추가하고, 모양은 className으로 덮어쓰세요.
- **Do** 버튼은 아이콘 버튼(`IconButton`, 동사 label) 또는 글자 버튼 중 하나로 만드세요.
- **Do** 상태는 완료 / 진행 중 / 대기 / 실패 / 제외 다섯 이름으로만 부르고, 원장에서는 레인 노드(체크 원, 도는 호, 점선 원, 느낌표 원, X 원) 한 곳에만 표시하세요.
- **Do** 시각, 해시, 할 일 번호, 로그는 Geist Mono에 tabular-nums로 쓰세요.
- **Do** 글자 크기는 12 / 13 / 15 / 18 / 28px 단계 안에서 고르세요.
- **Do** 주 버튼은 잉크색 채움으로 행마다 하나, 나머지는 outline이나 ghost로 두세요.
- **Do** 펼침은 Collapsible 측정 높이 250ms ease-out 전환으로, reduced motion에서는 즉시 바꾸세요.
- **Do** 예시 데이터는 헤더의 "예시 데이터" 배지로 표시하세요.

### Don't:
- **Don't** 초록을 쓰거나 완료를 강조하지 마세요.
- **Don't** 빨강을 파괴적이지 않은 동작의 버튼에 쓰지 마세요.
- **Don't** 아이콘과 글자를 한 버튼에 함께 넣지 마세요.
- **Don't** 행을 펼치려고 따로 버튼을 두지 마세요. 행 자체가 펼침 머리입니다.
- **Don't** 같은 상태를 두 곳에 표시하지 마세요(노드와 배지, 행과 집계).
- **Don't** 빈 상태나 구역에 화면 사용법을 설명하는 안내 문장을 붙이지 마세요.
- **Don't** shadcn 컴포넌트가 있는 자리에 손으로 만든 버튼, 입력, 배지를 두지 마세요.
- **Don't** preset의 Inter로 되돌리지 마세요. 글꼴은 Pretendard Variable과 Geist Mono입니다.
- **Don't** 가운뎃점(·)을 구분자로 쓰거나 메타 정보와 컨트롤을 한 줄로 나열하지 마세요.
- **Don't** 표면이나 컨트롤에 그림자를 주지 마세요.
- **Don't** 유채색 기운이 도는 바탕을 쓰지 마세요. 바탕은 무채색입니다.
- **Don't** 행이나 목록에 순차 등장 애니메이션을 넣지 마세요.
- **Don't** lucide 외의 아이콘이나 글리프 문자를 아이콘으로 쓰지 마세요.
- **Don't** 루트 글자 크기를 뷰포트 단위로 늘이거나 줄이지 마세요.
