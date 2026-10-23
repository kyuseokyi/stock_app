---
name: StockApp
description: 장 마감 뒤 저녁, 오늘 시장을 정리하는 라벤더빛 분석 노트
colors:
  lavender-canvas: "#f7f5ff"
  paper-white: "#ffffff"
  lavender-fill: "#efebfb"
  hairline-lilac: "#ebe7f7"
  night-ink: "#25223a"
  dusk-ink: "#6a6681"
  pastel-blue: "#6f8ef0"
  pastel-blue-soft: "#e2ecff"
  deep-periwinkle: "#4963c1"
  rose-up: "#b6265d"
  rose-up-soft: "#fbd6e4"
  cobalt-down: "#3c5dc1"
  cobalt-down-soft: "#d8e3fd"
  plum-accent: "#aa5278"
  ember-danger: "#a14f09"
  ember-danger-soft: "#fde7d4"
  kakao-yellow: "#FEE500"
  naver-green: "#03C75A"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "2.25rem"
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: "2rem"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: "1.75rem"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
  tab-label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
rounded:
  field: "12px"
  btn: "14px"
  card: "20px"
  pill: "9999px"
spacing:
  gutter: "16px"
  card-padding: "16px"
  modal-padding: "20px"
  chip-x: "12px"
  section-gap: "24px"
components:
  button-primary:
    backgroundColor: "{colors.pastel-blue}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.btn}"
    padding: "0 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.btn}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.hairline-lilac}"
  button-tertiary:
    backgroundColor: "{colors.lavender-fill}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.btn}"
    padding: "0 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.ember-danger-soft}"
    textColor: "{colors.ember-danger}"
    rounded: "{rounded.btn}"
    padding: "0 16px"
    height: "44px"
  chip:
    backgroundColor: "{colors.lavender-fill}"
    textColor: "{colors.dusk-ink}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  chip-active:
    backgroundColor: "{colors.pastel-blue-soft}"
    textColor: "{colors.deep-periwinkle}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.card}"
    padding: "16px"
  card-banner:
    backgroundColor: "{colors.pastel-blue-soft}"
    rounded: "{rounded.card}"
    padding: "16px"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
  badge-up:
    backgroundColor: "{colors.rose-up-soft}"
    textColor: "{colors.rose-up}"
    rounded: "{rounded.pill}"
  badge-down:
    backgroundColor: "{colors.cobalt-down-soft}"
    textColor: "{colors.cobalt-down}"
    rounded: "{rounded.pill}"
  toast:
    backgroundColor: "{colors.night-ink}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.pill}"
    padding: "10px 20px"
---

# Design System: StockApp

> 기준 구현은 일반 사용자 웹(`web_client/tailwind.config.js`, `web_client/src/index.css`, `web_client/src/components/ui/`)이다.
> 모바일 앱은 같은 팔레트를 `mobile/unistyles.ts`에 두고, 세부 규칙은 `docs/mobile_design_language.md`를 따른다.
> 모바일 팔레트는 아직 AA 보정 전 값이다(PRODUCT.md 접근성 항목 참고). 두 곳의 값이 다르면 이 문서의 frontmatter가 맞는 값이다.

## Overview

**Creative North Star: "저녁의 라벤더 노트"**

장이 끝난 저녁에 오늘 시장을 한 장의 노트로 정리하는 느낌을 목표로 한다. 바탕은 아주 연한 라벤더이고, 정보는 그 위에 놓인 흰 종이(카드)에 적힌다. 색은 흐리게 깔고 글자와 숫자는 진하게 쓴다. 파스텔은 분위기를 만들고, 읽어야 하는 것은 언제나 또렷해야 한다.

토스식 레이아웃을 따른다. 큰 굵은 제목 아래 작은 보조 문구를 두고, 선과 상자보다 여백과 글자 굵기로 위계를 만든다. 밀도는 중간 정도다. 스크리너와 게임은 표·차트가 촘촘하지만 카드 단위로 숨 쉴 틈을 둔다. 컴포넌트는 "말랑하고 또렷하게" 만든다. 모서리는 둥글고 색은 부드럽되, 글자·숫자·선택 상태는 분명하게 보인다.

증권사 MTS 같은 검은 바탕과 원색 빨강·파랑은 이 세계가 아니다. 상승·하락도 같은 파스텔 계열 안에서 한 단계 진한 핑크레드·코발트로 표시한다.

**Key Characteristics:**
- 연 라벤더 바탕 위 흰 카드. 층은 그림자가 아니라 색 차이로 나눈다.
- 파스텔은 배경에, 진한 색은 글자에 쓴다(모든 글자 4.5:1 이상, WCAG 2.2 AA).
- 상승은 핑크레드, 하락은 코발트 블루(한국 시장 관례). 부호·화살표를 함께 쓴다.
- 숫자는 `tabular-nums`로 자리를 맞춘다.
- 친근한 존댓말("~해요")과 넉넉한 둥근 모서리.

## Colors

연 라벤더를 바탕에 깔고, 파스텔 블루·핑크를 포인트로, 남색 잉크를 글자로 쓰는 저채도 팔레트다.

### Primary
- **Pastel Blue** (#6f8ef0): 주 버튼(CTA)과 로그인 버튼의 배경. 위 글자는 반드시 Night Ink다(흰 글자는 3.1:1로 미달). 입력창 포커스 테두리에도 쓴다.
- **Pastel Blue Soft** (#e2ecff): 선택된 칩, 표의 "내 행"·현재 베이스 행 배경, 코치·퀴즈 안내 배너 바탕.
- **Deep Periwinkle** (#4963c1): 블루를 글자로 쓸 때의 색. 링크, 선택 칩 글자, "종목 상세 보기 →" 같은 텍스트 버튼, 입력 커서, 키보드 포커스 링.

### Secondary
- **Rose Up** (#b6265d): 상승·수익·BUY 글자. Rose Up Soft 배지 위에서도 4.6:1이다.
- **Rose Up Soft** (#fbd6e4): BUY 버튼·수익 배지 배경, 트리맵 상승 첫 단계.
- **Cobalt Down** (#3c5dc1): 하락·손실·SELL 글자.
- **Cobalt Down Soft** (#d8e3fd): SELL 버튼·손실 배지 배경, 트리맵 하락 첫 단계.

### Tertiary
- **Plum Accent** (#aa5278): 내비게이션 선택 표시. 데스크톱 상단 메뉴의 밑줄, 모바일 하단 탭바의 선택 글자·아이콘에 쓴다. 이 밖에는 쓰지 않는다.

### Danger
- **Ember Danger** (#a14f09): 오류·실패 문구, 주문 차단 같은 막힘 안내, 탈퇴 같은 위험 행동, 입력 오류 테두리. 핑크레드(색상각 약 4°)와 구분되는 따뜻한 호박색(약 52°)이다. 흰 바탕 5.8:1, Lavender Fill 4.9:1, 자기 soft 4.8:1.
- **Ember Danger Soft** (#fde7d4): 오류 띠·주의 안내 박스·탈퇴 버튼 배경. 위 글자는 Night Ink 또는 Ember Danger.

### Neutral
- **Lavender Canvas** (#f7f5ff): 화면 바탕, 모달·시트 바탕, 헤더(90% 불투명 + 흐림).
- **Paper White** (#ffffff): 모든 카드, 입력창, 드롭다운 목록, 하단 탭바.
- **Lavender Fill** (#efebfb): 흰 카드 안의 미선택 칩·입력 트리거 배경.
- **Hairline Lilac** (#ebe7f7): 1px 경계선, 표 행 구분선, 보조 버튼 hover 배경.
- **Night Ink** (#25223a): 본문·제목·숫자, 주 버튼 글자, 토스트 배경.
- **Dusk Ink** (#6a6681): 보조 문구, 캡션, 표 머리, 미선택 칩·탭 글자, placeholder(투명도 없이).

### Provider Colors
- **Kakao Yellow** (#FEE500), **Naver Green** (#03C75A): 간편 로그인 버튼에만 쓴다. 공급자 공식 가이드를 따르므로 팔레트 규칙에서 예외다(네이버의 흰 글자 대비가 낮은 것도 가이드대로 둔다).

### Named Rules
**The Pastel-Under, Ink-Over Rule.** 파스텔은 배경으로만 깔고, 그 위의 글자는 진한 잉크나 같은 색상의 진한 단계로 쓴다. 파스텔 색을 그대로 글자로 쓰지 않는다(`text-brand`가 아니라 `text-brand-strong`).

**The Lightness-Only Rule.** 대비가 부족하면 색상(hue)과 채도는 그대로 두고 OKLCH 명도만 낮춘다. 새 색을 들여오지 않는다.

**The Pink-Is-a-Point Rule.** 핑크 계열은 상승·수익·BUY(롱)·돌파·게임 보상 금액과 내비 선택에만 쓴다. 오류·위험·주의는 Ember Danger, 분류 배지("경제지표", "대장주", "N일째 상위")는 Lavender Fill + Night Ink로 쓴다. 핑크 카드나 핑크 배경 화면은 없다.

**The Zero-Is-Neutral Rule.** 화면에 0으로 보이는 값(소수 1자리로 반올림해 0.0%, ₩0)은 상승도 하락도 아니므로 Dusk Ink로 쓴다. 판정은 표시 자릿수 기준이다(`pnlClass`).

## Typography

**Display Font:** 시스템 산세리프(`ui-sans-serif, system-ui`, Tailwind 기본). 별도 웹폰트를 불러오지 않는다.
**Body Font:** 같은 시스템 산세리프.

**Character:** 한 가지 글꼴로 크기와 굵기 차이만으로 위계를 만든다. 한국어 본문은 각 OS의 기본 한글 글꼴(Apple SD Gothic Neo, 맑은 고딕 등)이 맡는다. 모바일 문서의 Pretendard 도입은 아직 열린 결정이다.

### Hierarchy
- **Display** (700, 1.875rem, 2.25rem): 게임 잔고·손익처럼 화면에서 가장 큰 숫자. 드물게 쓴다.
- **Headline** (700, 1.5rem, 2rem): 화면 제목, 종목 상세의 종목명.
- **Title** (700, 1.125rem, 1.75rem): 카드·섹션 제목, 모달 제목, 로고.
- **Body** (400, 0.875rem, 1.25rem): 기본 본문. 화면 대부분의 글자가 이 크기다. 게시글 본문은 `leading-relaxed`로 줄 간격을 넓힌다.
- **Label** (500, 0.75rem, 1rem): 표 셀, 배지, 보조 정보.
- **Tab Label** (500, 11px): 모바일 하단 탭바 글자에만.

### Named Rules
**The Tabular Numbers Rule.** 가격·등락률·점수·금액처럼 세로로 비교하는 숫자에는 `tabular-nums`를 쓴다.

**The 12px Floor Rule.** 정보 글자는 12px(`text-xs`) 아래로 내리지 않는다. 11px는 탭바 글자에만, 10px는 "현재" 같은 아주 짧은 배지에만 남아 있으며 늘리지 않는다.

## Layout

- **본문 폭:** 기본 `max-w-3xl`(768px) 가운데 정렬. 게임·스크리너 섹션은 `lg` 이상에서 `max-w-6xl`(1152px)로 넓혀 차트+주문, 목록+상세 2단을 만든다. 헤더 폭도 함께 넓혀 로고·메뉴 정렬을 맞춘다.
- **거터:** 좌우 16px(`px-4`). 카드 안쪽 16px, 모달 안쪽 20px.
- **간격:** 4px 단위 Tailwind 스케일. 카드 사이 12~16px, 섹션 사이 24px 안팎.
- **반응형:** `sm`(640px) 미만은 상단 메뉴를 숨기고 하단 고정 탭바(높이 56px + safe-area)를 쓴다. 모달은 모바일에서 하단 시트, `sm` 이상에서 가운데 창이다. 넓은 표는 가로 스크롤(`overflow-x-auto`)로 감싼다.
- **쌓임 순서:** 헤더·탭바·게임 주문바 z-30, 모달 z-40, 로그인 창·토스트 z-50.

## Elevation & Depth

평평하게 두고 색으로 층을 나눈다. 라벤더 바탕(가장 낮음) → 흰 카드 → 카드 안의 라벤더 채움(칩·입력) 순으로 겹친다. 그림자는 화면 위에 떠 있는 것(모달, 드롭다운 메뉴, 토스트, 차트 위 설정 패널)에만 쓴다. 헤더와 하단 탭바는 그림자 대신 반투명 + 배경 흐림 + 1px 경계선으로 떠 있음을 표시한다.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`, Tailwind `shadow-lg`): 드롭다운 메뉴, 토스트, 차트 설정 패널.
- **Overlay** (`box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`, Tailwind `shadow-xl`): 모달과 로그인 창. 뒤에 40% 검정 딤을 깐다.

### Named Rules
**The Flat-At-Rest Rule.** 페이지에 붙어 있는 카드에는 그림자를 주지 않는다. 그림자는 "지금 위에 떠 있다"는 뜻일 때만 쓴다.

## Shapes

부드럽고 둥근 형태다. 모서리는 크기에 따라 세 단계로 나눈다. 입력창·드롭다운·작은 버튼은 12px, 버튼은 14px, 카드·모달은 20px다. 칩·배지·토스트는 완전한 알약 모양이다. 모바일 하단 시트는 위쪽 모서리만 20px로 둥글다. 경계선은 1px Hairline Lilac 하나만 쓴다. 굵은 색 띠(카드 왼쪽 강조선 등)는 쓰지 않는다. 게시글 인용구의 4px 왼쪽 선은 본문 서식의 예외다.

## Components

### Buttons
말랑한 모서리에 짧고 또렷한 글자다.
- **Shape:** 둥근 모서리(14px), 높이 44px, 좌우 16px, 14px 굵게(600).
- **Primary:** Pastel Blue 배경에 Night Ink 글자. 화면당 하나의 주된 행동에 쓴다.
- **Secondary:** Paper White 배경에 1px Hairline Lilac 안쪽 테두리, Night Ink 글자.
- **Hover / Focus:** Primary는 명도를 5% 낮추고(`brightness-95`), Secondary는 Hairline Lilac 배경으로 바뀐다. 키보드 포커스는 Deep Periwinkle 2px 바깥선(간격 2px)이며 마우스 클릭에는 보이지 않는다.
- **Tertiary:** Lavender Fill 배경에 Night Ink 글자. "더 보기"처럼 목록 끝의 보조 행동.
- **Danger:** Ember Danger Soft 배경에 Ember Danger 글자. 탈퇴처럼 되돌리기 어려운 행동에만.
- **Disabled:** 50% 불투명, 커서 금지.
- **Text button:** "종목 상세 보기 →"처럼 배경 없이 Deep Periwinkle 글자로 쓴다. 보이는 글자는 작아도 누르는 영역은 44px(`min-h-11`, 위아래 음수 여백으로 줄 간격 유지).

### Icons
- 아이콘은 하단 탭바와 같은 **무채색 선 아이콘**(24 격자, 선 두께 1.8, `currentColor`)이다. 글자 라벨과 함께 쓰고, 의미는 라벨이 전한다.
- **The No-Emoji-Controls Rule.** 버튼·탭·내비·라벨 같은 조작 요소에는 이모지를 쓰지 않는다(주문·퀴즈·게임 헤더 버튼 포함). 예외는 게임의 연속 출석 칩 🔥 하나이며, 화면 읽기에는 숨기고 칩에 "연속 출석 n일" 이름을 붙인다. 게임 토스트 아이콘(🎁🔓)·축하 장면(🎉)·빈 화면 그림처럼 조작이 아닌 놀이감 연출은 허용한다.

### Chips
- **Style:** 알약 모양, 좌우 12px·위아래 6px, 14px 중간 굵기(500). 미선택은 Lavender Fill 배경에 Dusk Ink 글자.
- **State:** 선택은 Pastel Blue Soft 배경에 Deep Periwinkle 글자. 게시판 탭, 스크리너 필터, 기간 선택이 같은 칩을 쓴다(`chipClass`).

### Cards / Containers
- **Corner Style:** 20px.
- **Background:** Paper White. 코치·퀴즈·게임 안내 배너만 Pastel Blue Soft.
- **Shadow Strategy:** 없음(Flat-At-Rest Rule).
- **Border:** 기본 없음. 떠 있는 패널만 1px Hairline Lilac.
- **Internal Padding:** 16px.
- 카드 안에 카드를 넣지 않는다. 카드 안의 묶음은 Lavender Fill 면이나 여백으로 나눈다.

### Inputs / Fields
- **Style:** Paper White 배경, 1px Hairline Lilac 테두리, 12px 모서리, 좌우 12px·위아래 8px, 14px 글자. placeholder는 Dusk Ink(투명도 없이).
- **Focus:** 테두리가 Pastel Blue로 바뀐다.
- **Combobox:** 종목 검색은 입력 아래 흰 목록(12px 모서리, 1px 테두리, Floating 그림자)을 띄우고 방향키·Enter로 고른다.

### Navigation
- **데스크톱(`sm` 이상):** 헤더 안 상단 메뉴. 16px 굵게, 미선택 Dusk Ink → hover Night Ink, 선택은 Night Ink 글자 + 2px Plum Accent 밑줄.
- **모바일:** 하단 고정 탭바 5칸(홈·커뮤니티·게임·스크리너·내정보). 24px 선 아이콘(1.8 두께) 위에 11px 라벨. 선택은 Plum Accent, 미선택은 Dusk Ink. 95% 흰색 + 배경 흐림.
- **헤더:** Lavender Canvas 90% + 배경 흐림, 아래 1px 경계선, 화면 위에 고정.

### Badges (Up / Down)
- 상승은 Rose Up Soft 배경에 Rose Up 글자, 하락은 Cobalt Down Soft 배경에 Cobalt Down 글자. 숫자에는 `+`/`-` 부호를 함께 쓴다.

### Treemap (signature)
테마·업종 지도. 칸의 명도가 등락 크기를 나타낸다. 상승 5단계(#fbd6e4 → #b6265d), 하락 5단계(#d8e3fd → #3c5dc1)이며, 가장 진한 단계만 흰 글자이고 나머지는 Night Ink 글자다. 모든 칸이 4.5:1 이상이다.

### Toast
Night Ink 알약에 흰 글자(14px 굵게), Floating 그림자. 화면 아래쪽 가운데에 잠깐 띄운다.

### Modal / Bottom Sheet
Lavender Canvas 바탕, 머리에 Title 글자와 닫기 버튼, 아래 1px 경계선. 모바일은 하단 시트(위 모서리 20px), `sm` 이상은 가운데 창(최대 512px, 모서리 20px). ESC·바깥 클릭으로 닫히고 포커스가 안에 갇힌다.

## Do's and Don'ts

### Do:
- **Do** 색은 항상 토큰(`brand`, `ink`, `up` 등)으로 쓴다. 웹은 `tailwind.config.js`, 차트처럼 JS가 색을 받아야 하는 곳은 `themeColors.ts`에서 가져온다.
- **Do** 블루 글자·링크에는 Deep Periwinkle(#4963c1)을 쓴다.
- **Do** 주 버튼은 Pastel Blue 배경 + Night Ink 글자로 만든다.
- **Do** 상승·하락은 색과 함께 부호(`+`/`-`)나 화살표를 쓴다.
- **Do** 비교하는 숫자에는 `tabular-nums`를 쓴다.
- **Do** 새 색 조합은 쓰이는 가장 어두운 배경 기준으로 4.5:1(큰 글자·아이콘·포커스 표시는 3:1)을 확인한다.

### Don't:
- **Don't** 파스텔 색(#6f8ef0, 각 soft 색)을 글자색으로 쓰지 않는다.
- **Don't** Pastel Blue 버튼에 흰 글자를 쓰지 않는다(3.1:1).
- **Don't** placeholder나 보조 글자에 투명도(`/70` 등)를 주지 않는다.
- **Don't** 페이지에 붙은 카드에 그림자를 주지 않고, 카드 안에 카드를 넣지 않는다.
- **Don't** 핑크로 카드나 화면 배경을 칠하지 않는다.
- **Don't** 오류·실패·위험 행동에 핑크(up)를 쓰지 않는다. Ember Danger를 쓴다.
- **Don't** 검은 바탕·원색 빨강/파랑의 증권사 MTS 스타일로 화면을 만들지 않는다.
- **Don't** 카카오·네이버 버튼 색을 팔레트에 맞춰 바꾸지 않는다.
