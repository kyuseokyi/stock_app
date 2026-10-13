# 파스텔 테마(C안: 라벤더 바탕 + 핑크·블루) 설계 스펙

> 작성일: 2026-10-14 · 상태: 승인됨(사용자: "디자인에 색상을 좀 넣었으면해 너무진하지않은 붉은 색상 파란색으로 파스텔같은" → 범위 "앱 전체 테마 변경", 대상 "모바일 + 웹 둘 다", 팔레트 "C안으로 진행해줘")
> 대체: `docs/mobile_design_language.md` §2 컬러 토큰(토스 무채색+블루 1색 원칙)을 이 스펙의 팔레트로 개정. 레이아웃·타이포·간격 원칙은 유지.

## 1. 원칙
- 바탕은 아주 연한 라벤더, 카드는 **연핑크/연블루를 번갈아**, 칩·입력은 흰색.
- **글자·수익률 숫자는 한 단계 진하게**(파스텔 배경 위 가독성). 상승=핑크레드, 하락=블루 의미 유지.
- 색은 항상 토큰으로(하드코딩 금지). 다크 모드도 같은 성격(라벤더 톤 어두운 바탕 + 채도 낮은 핑크/블루).

## 2. 토큰 (모바일 `mobile/unistyles.ts` = 웹 `web_client/tailwind.config.js`)

| 모바일 토큰 | 웹 클래스 | Light | Dark | 용도 |
|---|---|---|---|---|
| background | `canvas`(신규)·body | `#f7f5ff` | `#1a1826` | 화면 바탕 |
| surface | `surface` | `#ffffff` | `#24212f` | 칩·입력·일반 카드(라벤더 위 흰색) |
| surfacePink (신규) | `pink-soft` | `#fde4ee` | `#3a2433` | 핑크 카드 |
| surfaceBlue (신규) | `sky-soft` | `#e2ecff` | `#222c45` | 블루 카드 |
| border | `line` | `#ebe7f7` | `#322e40` | 경계선 |
| text | `ink` | `#25223a` | `#f3f1fa` | 본문 |
| textSecondary | `ink-muted` | `#8e8aa6` | `#a6a1bd` | 보조 |
| primary | `brand` | `#6f8ef0` | `#9fb4f7` | CTA·선택·링크(파스텔 블루, 흰 굵은 글자 대비 ≥3:1) |
| primarySoft | `brand-soft` | `#e2ecff` | `#2a3150` | 선택 칩·내 행 배경 |
| accent (신규) | `accent` | `#e88ab0` | `#f0a0c0` | 탭바 선택·배지(핑크 포인트) |
| up | `up` | `#c93a6c` | `#ff7aa2` | 상승/수익 글자 |
| upSoft (신규) | `up-soft` | `#fbd6e4` | `#3d2230` | BUY 버튼·수익 배지 배경 |
| down | `down` | `#4f73d9` | `#8aa4ff` | 하락/손실 글자 |
| downSoft (신규) | `down-soft` | `#d8e3fd` | `#23305a` | SELL 버튼·손실 배지 배경 |

- 웹 `kakao`·`naver`(공급자 가이드 색)는 변경 금지.
- admin_web 은 범위 밖(관리자 도구, 기존 유지).

## 3. 적용 지점
- **전역(토큰만)**: 바탕·글자·경계·primary 계열은 토큰 값 교체로 자동 반영(블로그·홈·내정보 포함). 웹은 페이지 바탕을 `bg-canvas` 로(현재 흰 바탕 지정 지점).
- **게임 화면 카드 색 배치**(모바일 `src/app/(tabs)/game.tsx`·`src/features/game/components/*`, 웹 `src/pages/GamePage.tsx`·`src/components/game/*`):
  - 시즌 헤더 카드 → surfacePink, 오늘의 코치 → surfaceBlue, 베팅 심리 → surfacePink, 퀴즈 배너 → surfaceBlue, 주문 패널 → surfacePink, 포지션 카드 → surfaceBlue.
  - 헤더 칩(랭킹·퀘스트·퀴즈)과 주문 패널 안 선택 칩은 surface(흰색)/primarySoft.
  - **BUY 버튼** = upSoft 배경 + up 글자, **SELL 버튼** = downSoft 배경 + down 글자(현재 진한 채움 → 파스텔).
  - 하단 탭바 선택 색 = accent(모바일 탭 레이아웃의 tint), 웹 상단 내비 선택 표시도 accent.
  - 랭킹 내 행 강조 = primarySoft(기존 유지).
- 차트 캔들 색은 up/down 토큰을 따름. 차트 배경은 surface(흰색).
- 모달·시트 바탕 = background(라벤더), 그 안의 카드 규칙 동일.

## 4. 검증
- 모바일 tsc/jest, 웹 tsc/build 통과.
- 에뮬레이터 스크린샷(라이트): 홈·게임·랭킹 시트·내정보. 웹 게임 페이지 빌드 확인.
- 대비: text/background ≥ 7:1, up/down 글자 on upSoft/downSoft ≥ 3:1(굵은 글자).
- 문서: `docs/mobile_design_language.md` §2 표·§1 원칙 4번 개정.
