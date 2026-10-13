# 📱 모바일 디자인 언어 — 토스(Toss) 스타일

> **목적**: stock_app 모바일(React Native / Expo / Unistyles v3) 전 화면에 일관 적용하는 디자인 기준.
> 신규 화면·컴포넌트는 이 문서를 먼저 읽고 토큰·패턴을 따른다. (게임 플레이 화면도 동일 언어 위에서 예외 처리)
> 토큰 구현 위치: [`mobile/unistyles.ts`](file:///Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/mobile/unistyles.ts)

---

## 1. 핵심 원칙 (토스가 "토스처럼" 보이는 이유)

1. **과감한 여백 (Breathing room)**: 요소를 빽빽이 채우지 않는다. 좌우 기본 거터 20px, 섹션 간 24~32px.
2. **한 화면 한 목적 (One thing per screen)**: 한 화면은 한 가지 핵심 행동/정보에 집중. 복잡하면 다음 단계로 분할(스텝/바텀시트).
3. **큰 타이포 + 강한 위계**: 큰 굵은 제목 → 작은 회색 보조문구. 폰트 크기·굵기 차이로 위계를 만들고 선/박스는 최소화.
4. **파스텔 팔레트(C안)**: 아주 연한 라벤더 바탕 + 카드는 연핑크/연블루를 번갈아, 칩·입력은 흰색. 포인트는 파스텔 블루(primary)·핑크(accent). 글자·수익률 숫자는 한 단계 진하게(상승=핑크레드, 하락=블루). 색은 항상 토큰으로(하드코딩 금지). 근거: [`docs/superpowers/specs/2026-10-14-pastel-theme-design.md`](superpowers/specs/2026-10-14-pastel-theme-design.md) (2026-10-14, 기존 '흑백+토스 블루 1색' 원칙 대체).
5. **카드보다 "구분선 없는 리스트"**: 경계선을 줄이고 여백으로 그룹을 나눈다. 카드는 꼭 필요한 강조에만.
6. **큰 탭 타깃 + 꽉 찬 CTA**: 주요 버튼은 화면 가로 full-width, 높이 56, 둥근 모서리, 굵은 글씨.
7. **친근한 구어체 마이크로카피**: "~했어요 / ~해요 / ~할까요?" 체. 숫자·금액은 크고 또렷하게.
8. **바텀시트 우선**: 중앙 팝업 모달 대신 아래에서 올라오는 바텀시트. 손가락이 닿는 하단에서 선택.

---

## 2. 컬러 토큰 (unistyles.ts 매핑)

라이트 퍼스트. 다크도 지원(OS 연동, `adaptiveThemes`)하되 동일 성격(라벤더 톤 어두운 바탕 + 채도 낮은 핑크/블루) 유지.
팔레트 출처: [파스텔 테마 C안 스펙](superpowers/specs/2026-10-14-pastel-theme-design.md) §2.

| 토큰 | Light | Dark | 용도 |
| :-- | :-- | :-- | :-- |
| `background` | `#f7f5ff` | `#1a1826` | 화면 바탕(아주 연한 라벤더) · 모달/시트 바탕 |
| `surface` | `#ffffff` | `#24212f` | 칩·입력·일반 카드(라벤더 위 흰색) · 차트 배경 |
| `surfacePink` | `#fde4ee` | `#3a2433` | 핑크 카드 (신규) |
| `surfaceBlue` | `#e2ecff` | `#222c45` | 블루 카드 (신규) |
| `border` | `#ebe7f7` | `#322e40` | 최소한의 경계선 |
| `text` | `#25223a` | `#f3f1fa` | 본문/제목 |
| `textSecondary` | `#8e8aa6` | `#a6a1bd` | 보조문구·캡션 |
| `primary` | `#6f8ef0` | `#9fb4f7` | CTA·선택·링크(파스텔 블루, 흰 굵은 글자 대비 ≥3:1) |
| `primarySoft` | `#e2ecff` | `#2a3150` | 선택 칩·내 행 배경 |
| `accent` | `#e88ab0` | `#f0a0c0` | 탭바 선택·배지(핑크 포인트) (신규) |
| `up` | `#c93a6c` | `#ff7aa2` | 상승/수익 글자 = 핑크레드 (국내 관례) |
| `upSoft` | `#fbd6e4` | `#3d2230` | BUY 버튼·수익 배지 배경 (신규) |
| `down` | `#4f73d9` | `#8aa4ff` | 하락/손실 글자 = 블루 |
| `downSoft` | `#d8e3fd` | `#23305a` | SELL 버튼·손실 배지 배경 (신규) |

> 게임 화면 카드 배치: 시즌 헤더=`surfacePink`, 오늘의 코치=`surfaceBlue`, 베팅 심리=`surfacePink`, 퀴즈 배너=`surfaceBlue`, 주문 패널=`surfacePink`, 포지션 카드=`surfaceBlue`. 칩·입력은 `surface`/`primarySoft`. BUY=`upSoft` 배경+`up` 글자, SELL=`downSoft` 배경+`down` 글자. 하단 탭바 선택 tint=`accent`.
> 카카오·네이버 버튼은 공급자 가이드 색 유지(토큰 대상 아님).
> 이전 팔레트(토스 무채색 + 토스 블루 `#3182f6`)는 2026-10-14 C안으로 대체됨.

---

## 3. 타이포그래피

- **글꼴**: Pretendard (토스 제품서체 Toss Product Sans의 공개 대체재). 미적용 시 시스템 기본.
- **스케일** (size / weight / lineHeight):
  | 역할 | size | weight | 비고 |
  | :-- | :-- | :-- | :-- |
  | Display (큰 금액) | 32 | 700 | 잔고·손익 등 숫자 강조 |
  | Title | 24 | 700 | 화면 제목 |
  | Section | 18 | 600 | 섹션 헤더 |
  | Body | 16 | 400 | 본문 기본 |
  | Caption | 13 | 400 | 보조문구(textSecondary) |
- 숫자(금액·%·수익률)는 **tabular/고정폭 느낌**으로 또렷하게. 원화는 `₩` + 천단위 콤마.

---

## 4. 간격 · 레이아웃 · 모서리 · 그림자

- **그리드**: 8px 베이스. `theme.gap(n)` = n×8. 좌우 화면 거터 = `gap(2.5)`=20.
- **모서리(radius)**: 카드/시트 = 20, 버튼 = 14(또는 pill=높이/2), 칩 = 999(완전 pill), 입력 = 12.
- **그림자**: 아주 옅게. `shadowColor #000`, opacity 0.06~0.08, radius 16, offset(0,4). 다크에서는 그림자 대신 `surface` 대비로 구분.
- **구분선**: 되도록 안 쓴다. 필요 시 `border` 1px, 좌우 거터만큼 들여쓰기.

---

## 5. 핵심 컴포넌트 패턴

- **Primary 버튼(CTA)**: full-width, height 56, radius 14, bg `primary`, 흰 글씨 weight 700. 비활성 = `surface` + `textSecondary`.
- **Secondary 버튼**: bg `surface`, 글씨 `text`. 테두리 없음.
- **칩/세그먼트**: pill, 미선택 = `surface`/`textSecondary`, 선택 = `primarySoft` 배경 + `primary` 글씨. (비중 25/50/100, 배율 1x/2x/5x 등)
- **리스트 행(Row)**: 좌측 아이콘/제목+보조문구, 우측 값/`›`. 행 높이 넉넉히(≥56), 구분선 대신 여백.
- **카드**: `surface` 배경, radius 20, padding `gap(2)`. 강조 정보에만.
- **바텀시트**: 모든 모달(랭킹/지인리그/퀘스트/퀴즈/MBTI)은 중앙 팝업이 아니라 하단 시트로. 상단 그랩바(handle), 둥근 상단 모서리.
- **상태 뷰**: 로딩 = 중앙 스피너 + "불러오고 있어요", 빈 상태 = 큰 이모지 + 한 줄 안내 + 행동 버튼, 에러 = 사유 + "다시 시도".
- **헤더**: 기본 `headerShown:false`(현재 유지), 화면 내부에 큰 타이포 제목을 둔다(토스식 인앱 타이틀).

---

## 6. 마이크로카피 (말투)

- 구어체 존댓말: "로그인했어요", "추천 글이 아직 없어요", "지금 트레이딩 할까요?"
- 명령형 대신 제안형. 숫자/결과는 담백하게, 감탄·과장 최소.
- 금액/수익률엔 부호와 색: `+₩180,000` (up 빨강) / `-₩42,000` (down 파랑).

---

## 7. 모션

- 전환은 부드럽게(스프링). 과한 바운스 금지.
- 수익률·잔고 숫자는 틱마다 **카운팅 애니메이션**(색도 up/down으로).
- 바텀시트는 아래→위 슬라이드 + 뒤 배경 딤(dim 40%).

---

## 8. 적용 방법 (개발자/에이전트용)

1. 색·간격은 **항상 `theme.colors.*` / `theme.gap()`** 사용. 하드코딩 금지(토큰만 바꾸면 전역 반영).
2. 새 토큰(`primarySoft` 등)은 `mobile/unistyles.ts`의 light/dark 양쪽에 추가.
3. 공통 컴포넌트(Button/Chip/Card/BottomSheet/Row/ListState)는 `mobile/src/ui/`에 두고 재사용. 화면별 재정의 금지.
4. 이 문서가 단일 출처(SSOT). 디자인 변경은 여기부터 고치고 → 토큰/컴포넌트 반영.

> ⚠️ **열린 결정(구현 전 확정 필요)**: ① Pretendard 폰트 번들 동봉 여부, ② 다크모드를 OS 자동(현행)으로 둘지 vs 라이트 고정, ③ 트레이딩 플레이 화면만 다크 집중 모드로 둘지. — 화면 구성 brainstorming에서 함께 정한다.
