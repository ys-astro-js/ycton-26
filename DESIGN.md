---
name: afk
description: 맡기고 자리를 비운 개발자가 돌아와 밤사이 일을 확인하고 처리하는 로컬 도구
colors:
  bg: "#fafafa"
  surface: "#ffffff"
  surface-hover: "#f4f4f5"
  surface-selected: "#f4f4f5"
  text: "#18181b"
  text-secondary: "#52525b"
  text-muted: "#71717a"
  border: "#e4e4e7"
  border-strong: "#d4d4d8"
  control-border: "#71717a"
  lane: "#d4d4d8"
  solid: "#18181b"
  solid-hover: "#3f3f46"
  on-solid: "#ffffff"
  attention: "#dc2626"
  attention-text: "#b91c1c"
  attention-wash: "#fef2f2"
  attention-border: "#fecaca"
  live: "#2563eb"
  live-text: "#1d4ed8"
  focus: "#2563eb"
typography:
  title:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "\"tnum\" 1"
rounded:
  control: "6px"
  surface: "10px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
components:
  button-primary:
    backgroundColor: "{colors.solid}"
    textColor: "{colors.on-solid}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px 0 10px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.solid-hover}"
    textColor: "{colors.on-solid}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px 0 10px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
  button-secondary-expanded:
    backgroundColor: "{colors.surface-selected}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "36px"
  count-badge-attention:
    backgroundColor: "{colors.attention}"
    textColor: "{colors.on-solid}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    height: "22px"
  count-badge-quiet:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    height: "22px"
  rail-link:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "36px"
  rail-link-current:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.text}"
  list-surface:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.surface}"
  text-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
---

# Design System: afk

## Overview

**Creative North Star: "중립 회색 위의 원장"**

afk의 화면은 밤사이 일어난 일을 위에서 아래로 읽어 내려가는 원장입니다. 바탕은 노란 기운이 없는 중립 zinc 회색이고, 그 위에 흰 표면 몇 장과 잉크에 가까운 글자만 놓입니다. 표면은 행 목록을 담는 그릇이고, 정보는 카드 격자가 아니라 행으로 흐릅니다. 행을 펼치면 인계 노트와 세션 로그가 그 자리에서 열립니다.

색은 장식이 아니라 두 가지 뜻만 실어 나릅니다. 빨강(attention)은 사람이 처리해야 할 것, 파랑(live)은 지금 진행 중인 것과 키보드 포커스입니다. 완료는 강조하지 않습니다. 끝난 일은 조용한 회색으로 물러나고, 사람의 눈은 남은 일에만 갑니다. 초록은 어디에도 없습니다.

밀도는 높되 한 줄에 메타 정보를 늘어놓지 않습니다. 시각, 해시, 할 일 번호는 Geist Mono 고정폭으로, 한국어 본문은 Pretendard Variable로 씁니다. 모든 아이콘은 lucide-react의 1.75 획 선 아이콘이며 currentColor를 따릅니다.

**Key Characteristics:**
- 중립 zinc 회색 바탕, 흰 행 목록 표면, 잉크 글자
- 색은 attention(빨강)과 live(파랑) 두 뜻에만 씀
- 상태 어휘는 완료 / 진행 중 / 제외 세 가지, 상태마다 아이콘 하나
- 한국어는 Pretendard Variable, 시각, 해시, 번호는 Geist Mono tabular-nums
- 행을 그 자리에서 펼치는 측정 높이 전환, 순차 등장 없음

## Colors

중립 zinc 회색 단계 위에 빨강과 파랑을 신호로만 얹는 팔레트입니다. 원색 단계(`--zinc-*`, `--red-*`, `--blue-*`)는 컴포넌트에서 직접 쓰지 않고, 항상 역할 토큰(`--color-*`)을 거칩니다.

### Primary
- **주의 빨강** (attention): 사람이 처리할 것에만 씁니다. 처리 필요 행의 종류 아이콘(Jev 정지, 시간 초과, 질문), 처리 필요 개수 배지, 잘못 입력된 필드의 테두리입니다. 처리가 끝난 행의 아이콘은 즉시 muted 회색으로 물러납니다.
- **주의 글자 빨강** (attention-text): 빨강이 글자로 쓰일 때의 더 짙은 단계입니다. 입력 오류 문구, 세션 로그의 timeout, error 줄에 씁니다.

### Secondary
- **진행 파랑** (live): 지금 돌아가는 것과 포커스입니다. 진행 중 행의 레인 노드 고리, 모든 `:focus-visible` 외곽선(2px, 2px 간격)에 씁니다.
- **진행 글자 파랑** (live-text): 진행 중 상태 라벨의 글자색입니다.

### Neutral
- **바탕 회색** (bg): 페이지 바탕이며, 펼쳐진 행의 배경으로도 쓰여 열린 행을 표면에서 한 단 가라앉힙니다.
- **표면 흰색** (surface): 행 목록 그릇, 버튼, 입력 필드의 바탕입니다.
- **옅은 회색** (surface-hover / surface-selected): 호버, 현재 레일 항목, 펼쳐진 펼침 버튼, 조용한 개수 배지입니다.
- **잉크** (text / solid): 본문 글자이자 주 버튼의 채움색입니다.
- **보조 회색 / 흐린 회색** (text-secondary / text-muted): 보조 글자와 아이콘, 시각, 라벨, 제외된 항목입니다.
- **괘선 회색** (border / border-strong / lane): 행 사이 hairline, 보조 버튼 테두리, 레인 세로선입니다.
- **컨트롤 테두리** (control-border): 입력 필드와 선택 상자 테두리입니다. 3:1 대비를 위해 괘선보다 짙습니다.

### Named Rules
**The Two Meanings Rule.** 색은 attention(빨강)과 live(파랑) 두 뜻만 가집니다. 새 화면에서 색을 쓰려면 둘 중 어느 뜻인지 먼저 답해야 하고, 답할 수 없으면 회색입니다.

**The Quiet Done Rule.** 완료는 강조하지 않습니다. 초록을 쓰지 않으며, 완료 상태는 보조 회색 글자와 채운 muted 점으로만 표시합니다.

**The Red Is Not A Button Rule.** 빨강은 파괴적이지 않은 동작의 버튼에 쓰지 않습니다. 처리 필요 행의 주 동작도 잉크색 버튼입니다.

## Typography

**Body Font:** Pretendard Variable (Pretendard, system-ui, Apple SD Gothic Neo, Noto Sans KR 대체)
**Label/Mono Font:** Geist Mono Variable (ui-monospace, SF Mono, Menlo 대체)

**Character:** 한 가족의 산세리프가 제목부터 캡션까지 굵기만 바꿔 위계를 만들고, 기계가 남긴 값(시각, 커밋 해시, 할 일 번호, 세션 로그)만 고정폭으로 갈라집니다.

### Hierarchy
- **Title** (700, 28px, 1.2, -0.02em): 화면 제목 하나("아침 리뷰"). text-wrap: balance.
- **Heading** (650, 18px, 1.3, -0.01em): 구역 제목("처리 필요", "밤사이 기록"), 옆에 개수 배지를 둡니다.
- **Body** (400, 15px, 1.5): 기본 글자 크기입니다. 행 제목은 600으로 올립니다. 설명 문단은 최대 65ch, 인계 노트는 60ch.
- **Label** (600, 13px, 1.4): 패널 제목, 프로젝트 그룹 이름, 버튼(550), 상태, 메타 값.
- **Caption** (400, 12px): 라벨-값 블록의 라벨, 레일 개수, 배지.
- **Mono** (400, 13px, 1.6, tabular-nums): 시각, 기간, 해시, 할 일 번호, 세션 로그 전체.

### Named Rules
**The Fixed Scale Rule.** 글자 크기는 12 / 13 / 15 / 18 / 28px 다섯 단계뿐이며 rem으로 지정합니다. 루트 글자 크기는 뷰포트에 따라 바꾸지 않습니다. 입력 필드만 iOS 확대를 막기 위해 16px입니다.

**The Machine Values Rule.** 사람이 아니라 기계가 만든 값은 Geist Mono에 tabular-nums로 씁니다. 숫자 열이 세로로 정렬되어야 원장이 읽힙니다.

## Layout

최대 너비 80rem의 가운데 정렬 컨테이너, 좌우 여백 32px(40rem 이하 16px). 헤더는 왼쪽에 워드마크와 제목, 오른쪽에 라벨-값 정의 목록(기간, 프로젝트)을 둔 2열 그리드이며 아래 hairline으로 끝납니다. 본문은 13.5rem 고정 레일과 가변 본문의 2열이고, 레일은 sticky입니다. 구역 사이 간격은 40px입니다.

간격은 4 / 8 / 12 / 16 / 24 / 32px 단계를 씁니다. 행 안쪽 여백 16px, 아이콘과 글자 사이 6–8px이 기본 리듬입니다.

반응형은 세 단계로 접힙니다. 64rem 이하에서는 레일이 사라지고 헤더의 프로젝트 선택 상자로 바뀝니다. 원장은 컨테이너 쿼리(52rem 이하)로 한 줄 그리드를 세 줄 블록(번호와 제목, 시각과 상태, 에이전트와 커밋)으로 재배치합니다. 40rem 이하에서는 헤더가 한 열이 되고, 처리 필요 행의 버튼이 본문 아래로 내려가며, 버튼 높이가 44px로 커집니다.

### Named Rules
**The No Metadata String Rule.** 메타 정보는 라벨-값 블록이나 아이콘이 붙은 개별 항목으로 둡니다. 가운뎃점(·)으로 잇는 한 줄 나열은 쓰지 않습니다. 화면이 좁아지면 줄을 나누고, 한 줄에 우겨넣지 않습니다.

## Elevation & Depth

거의 평평합니다. 그림자는 행 목록 표면 하나에만 쓰며, 1px 링과 아주 옅은 1–2px 그림자를 겹친 경계 역할입니다. 들어 올리는 그림자는 없습니다. 깊이는 대신 색조로 만듭니다. 펼쳐진 행은 바탕 회색으로 한 단 가라앉고, 호버는 옅은 회색으로 채웁니다.

### Shadow Vocabulary
- **표면 경계** (`box-shadow: 0 0 0 1px rgb(24 24 27 / 0.06), 0 1px 2px rgb(24 24 27 / 0.04)`): 처리 필요 목록, 원장 그룹, 빈 상태 상자. 테두리 대신 씁니다.

### Named Rules
**The One Surface Rule.** 그림자가 있는 표면은 행 목록의 그릇뿐입니다. 행, 버튼, 배지에는 그림자를 주지 않습니다.

## Shapes

반경은 두 단계입니다. 컨트롤(버튼, 레일 링크, 입력 필드)은 6px, 표면은 컨트롤 반경에 안쪽 여백 4px을 더한 10px입니다. 배지는 완전한 알약형입니다. 표면의 첫 행과 마지막 행은 표면 반경을 이어받아 펼침 배경이 모서리를 벗어나지 않습니다. 행 사이는 1px hairline으로 나눕니다.

원장의 서명 형태는 레인입니다. 프로젝트 그룹마다 행의 노드를 잇는 2px 세로선이 흐르고, 노드는 10px 원입니다. 완료는 채운 muted 점, 진행 중은 파란 2px 고리, 제외는 옅은 회색 1.5px 고리입니다. 노드 둘레에 표면색 3px 테두리를 둘러 선을 끊습니다.

## Components

### Buttons
도구처럼 조용하고 확실한 버튼입니다.
- **Shape:** 컨트롤 반경(6px), 최소 높이 36px(40rem 이하 44px), 아이콘 16px과 글자 사이 6px.
- **Primary:** 잉크색 채움에 흰 글자. 행마다 하나만 둡니다(재개하기, 다시 맡기기, 답하기, 답장 보내기).
- **Secondary:** 흰 바탕에 border-strong 테두리, 아이콘은 보조 회색. 펼침 버튼은 펼쳐진 동안 옅은 회색으로 채워집니다.
- **Quiet:** 테두리와 배경 없는 보조 회색 글자(되돌리기).
- **Hover / Press:** 호버는 `(hover: hover)` 기기에서만 배경색이 바뀝니다(150ms). 누르면 0.96으로 줄어듭니다.

### Count Badge
- **Style:** 알약형, 최소 너비 24px, 높이 22px, 12px 650 tabular-nums.
- **State:** 처리할 것이 남으면 빨강 채움에 흰 숫자, 0이면 옅은 회색에 보조 회색 숫자.

### Cards / Containers
- **Corner Style:** 표면 반경(10px)
- **Background:** 표면 흰색
- **Shadow Strategy:** 표면 경계 그림자 하나(Elevation & Depth 참고)
- **Border:** 투명 1px(고대비 모드 대비), 행 사이는 hairline
- **Internal Padding:** 행 16px

### Inputs / Fields
- **Style:** 흰 바탕, control-border 1px 테두리, 컨트롤 반경, 16px 글자. 답장 입력은 최소 72px 높이, 세로 크기 조절만.
- **Focus:** 전역 파란 2px 외곽선, 2px 간격.
- **Error:** 테두리가 빨강으로 바뀌고 아래에 attention-text 문구가 붙으며 필드로 포커스가 돌아갑니다.

### Navigation
- **Style:** 왼쪽 레일의 세로 링크 목록. 36px 높이, 15px 보조 회색 글자, 왼쪽 16px 아이콘, 오른쪽 끝에 mono 개수.
- **Current:** 옅은 회색 채움, 잉크 글자 600, 아이콘도 잉크.
- **Mobile:** 64rem 이하에서 헤더의 네이티브 선택 상자(44px, 오른쪽 chevron 아이콘)로 바뀝니다.

### Status
화면 어디서나 같은 어휘와 아이콘을 씁니다. **완료**(CircleCheck), **진행 중**(CircleDot), **제외**(CircleSlash). 13px 라벨, 아이콘 14px. 진행 중만 live-text에 550 굵기로 올라가고, 완료는 보조 회색, 제외는 흐린 회색입니다. 부가 설명은 흐린 회색 괄호로 붙입니다.

### Disclosure Row
처리 필요 행과 원장 행은 같은 방식으로 펼칩니다. 안쪽 내용을 ResizeObserver로 재서 높이를 0에서 측정값으로 250ms `cubic-bezier(0.2, 0, 0, 1)` 전환하고, 닫힌 패널은 `inert`입니다. 첫 렌더는 전환 없이 그리고, `prefers-reduced-motion`에서는 전환을 없앱니다. 펼친 패널은 인계 노트(본문 글꼴)와 세션 로그(mono, 시각 / 종류 / 내용 3열)를 나란히 두고, 좁은 폭에서 한 열로 쌓습니다. 원장 행의 chevron은 펼치면 180도 돕니다(150ms).

### Icons
lucide-react 선 아이콘만 씁니다. 획 1.75, currentColor, 크기는 14 / 16 / 18 / 20px. 장식 아이콘은 `aria-hidden`이고, 아이콘만으로 뜻을 전하는 곳(종류 아이콘, 사실 목록의 라벨)에는 sr-only 글자를 함께 둡니다.

## Do's and Don'ts

### Do:
- **Do** 색을 쓰기 전에 attention(사람이 처리할 것)인지 live(지금 진행 중)인지 답하세요. 둘 다 아니면 zinc 회색입니다.
- **Do** 원색 단계 대신 역할 토큰(`--color-*`)을 쓰세요.
- **Do** 상태는 완료 / 진행 중 / 제외와 CircleCheck / CircleDot / CircleSlash로만 부르세요.
- **Do** 시각, 해시, 할 일 번호, 로그는 Geist Mono에 tabular-nums로 쓰세요.
- **Do** 글자 크기는 12 / 13 / 15 / 18 / 28px 단계 안에서 고르세요.
- **Do** 주 버튼은 잉크색 채움으로 행마다 하나, 나머지는 테두리 버튼으로 두고, 누를 때 0.96으로 줄이세요.
- **Do** 펼침은 측정 높이 250ms ease-out 전환으로, reduced motion에서는 즉시 바꾸세요.
- **Do** 예시 데이터는 헤더의 "예시 데이터" 배지로 표시하세요.

### Don't:
- **Don't** 초록을 쓰거나 완료를 강조하지 마세요.
- **Don't** 빨강을 파괴적이지 않은 동작의 버튼에 쓰지 마세요.
- **Don't** 노란 기운이 도는 미색 바탕을 쓰지 마세요. 바탕은 중립 zinc입니다.
- **Don't** 가운뎃점(·)을 구분자로 쓰거나 메타 정보와 컨트롤을 한 줄로 나열하지 마세요.
- **Don't** 행 목록 그릇 밖의 요소에 그림자를 주지 마세요.
- **Don't** 행이나 목록에 순차 등장 애니메이션을 넣지 마세요.
- **Don't** lucide 외의 아이콘이나 글리프 문자를 아이콘으로 쓰지 마세요.
- **Don't** 루트 글자 크기를 뷰포트 단위로 늘이거나 줄이지 마세요.
