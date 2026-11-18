# 앱 정체성 재정의 및 홈·네비게이션(5탭) 개편 기술 명세서

> **목적**: `FunNote`의 핵심 정체성을 **"① 내 펀드 수익률 확인 + ② 블로그·게임을 통한 투자 교육 (시장은 가벼운 참고용)"**으로 명확히 재정립하고, 이에 맞춰 웹(`web_client`)과 모바일 앱(`mobile`)의 **메인 네비게이션(5탭 + 우측 상단 내정보)** 및 **홈 화면 구성**을 개편하기 위한 상세 기술 명세 및 Claude Code 구현 플랜입니다.
>
> **제품 정의 기준 문서**: [`PRODUCT.md`](../PRODUCT.md)

---

## 0. 핵심 원칙 (Before vs After & 기존 기능 100% 보존 규칙)

| 구분 | 기존 구조 (Before) | 개편 구조 (After) |
| :--- | :--- | :--- |
| **앱의 핵심 정체성** | 시황(마켓)·스크리너 중심의 종합 증시 정보 앱처럼 보임 | **① 내 펀드 수익률 확인** + **② 블로그·게임을 통한 투자 교육**이 메인 |
| **시장(시황)의 역할** | 홈 화면의 80% 차지 + 두 번째 메인 탭(`마켓`) | **가벼운 참고용 보조 자료** (홈 최하단 미니 요약 + 마지막 탭 `시장`) |
| **내 펀드의 위치 및 접근** | `내정보 → 내 펀드 수익` 2단계 깊숙이 숨겨져 있음 | **메인 2번째 탭(`내 펀드`) 승격 + 홈 최상단 배치** (**로그인 후 이동 가능, 비로그인 시 로그인 안내 표시**) |
| **메인 네비게이션** | `홈 · 마켓 · (스크리너) · 커뮤니티 · 게임 · 내정보` (가변 5~6탭) | **`홈 · 내 펀드 · 블로그 · 게임 · 시장` (기본 5탭)** |
| **내정보 진입점** | 하단 마지막 탭(`내정보`) 차지 | **상단 헤더 우측 프로필/내정보 아이콘(버튼)**으로 이동 (내부 메뉴는 그대로 유지) |

### 🛡️ [필수 규칙] 기존 기능 및 코드 삭제 절대 금지 (Zero Deletion & Reusability)
1. **기존 홈 시황 컴포넌트 보존**:
   - 웹의 [`MarketNote.tsx`](../web_client/src/components/home/MarketNote.tsx)와 모바일의 [`home-summary.tsx`](../mobile/src/features/home/home-summary.tsx), [`home-brief-banner.tsx`](../mobile/src/features/home/home-brief-banner.tsx), [`home-indices.tsx`](../mobile/src/features/home/home-indices.tsx), [`home-movers.tsx`](../mobile/src/features/home/home-movers.tsx) 등 **기존에 만들어 둔 모든 컴포넌트 파일과 코드는 단 한 줄도 삭제하지 않고 그대로 보존**한다.
   - 추후 언제든 다시 홈에 전체 시황 노트를 켜거나 다른 화면에서 재사용할 수 있도록 모듈과 테스트를 그대로 유지한다.
2. **기존 `내정보` 내부 링크 및 `스크리너` 기능 보존 + 관리자 웹(`admin_web`) 상시 노출**:
   - [`MyPage.tsx`](../web_client/src/pages/MyPage.tsx)(웹 `/me`)와 [`profile.tsx`](../mobile/src/app/%28tabs%29/profile.tsx)(모바일 `/profile`) 내부에 있는 `🎮 트레이딩 게임`, `💰 내 펀드 수익`, `🚫 차단한 사용자` 메뉴 행은 삭제하지 않고 그대로 유지한다.
   - `스크리너`(`주도주 · 5·20 정배열 · 조건검색 · 차트 패턴`)의 모든 화면·라우트·관리자 스위치(`STOCK_FINDER`, `FINDER`, `PATTERNS`) 로직도 삭제 없이 100% 보존한다.
   - **[핵심 규칙] 관리자 웹(`admin_web`)에는 모든 스크리너 기능을 항상 노출**:
     - 사용자 웹/앱에서 스크리너가 숨겨져 있더라도, 관리자 웹(`admin_web`)의 `시장 데이터` 사이드바에는 현재 있는 **`주도주(/market/leaders)`**와 **`5·20 정배열 스크리너(/market/ma-screener)`**뿐 아니라, 아직 관리자 웹에 빠져 있는 **`조건검색(/market/finder)`**과 **`차트 패턴(/market/patterns)`** 화면까지 모두 상시 메뉴로 추가하여 관리자는 언제나 모든 스크리너를 볼 수 있게 한다.

---

## 1. 네비게이션 및 라우팅 개편 명세 (`web_client` & `mobile`)

### 1-1. 5탭 메뉴 구성 및 명칭
웹 상단 GNB([`AppNav.tsx`](../web_client/src/components/AppNav.tsx))와 모바일 하단 탭바([`mobile/src/app/(tabs)/_layout.tsx`](../mobile/src/app/%28tabs%29/_layout.tsx)) 모두 아래 순서와 이름으로 통일합니다:

| 순서 | 탭 이름 (`label`) | 섹션 키 (`Section`) | 웹 경로 (`to`) | 모바일 탭 파일 | 아이콘 (Ionicons / SVG) | 비로그인 시 동작 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **홈** | `'home'` | `/` | `(tabs)/index.tsx` | `home-outline` | 즉시 이동 |
| **2** | **내 펀드** | `'funds'` | `/me/funds` | `(tabs)/funds.tsx` *(신설)* | `wallet-outline` | **비로그인 시 이동 차단 + 로그인 안내 모달/바텀시트 표시** |
| **3** | **블로그** | `'community'` | `/community` | `(tabs)/community.tsx` | `book-outline` | 즉시 이동 |
| **4** | **게임** | `'game'` | `/game` | `(tabs)/game.tsx` | `game-controller-outline` | 즉시 이동 (게임 내 주문/퀴즈 시 로그인 안내) |
| **5** | **시장** | `'market'` | `/market` | `(tabs)/market.tsx` | `pulse-outline` | 즉시 이동 |

*(참고: 기존 `스크리너` 탭 또한 삭제하지 않고 그대로 코드에 유지하되, 기본 OFF 상태에서는 위 5탭이 노출되고 추후 관리자 스위치 `STOCK_FINDER`를 켜면 언제든 다시 활성화됩니다.)*

### 1-2. `내 펀드` 로그인 필수 게이트 및 비로그인 안내 (핵심 요구사항)

`내 펀드`는 로그인 계정별로 안전하게 관리되는 기능이므로, **로그인이 되어 있을 때만 `내 펀드` 화면으로 이동**할 수 있고 **비로그인 상태에서는 친절한 로그인 안내**를 띄웁니다.

1. **웹 (`web_client`) 동작**:
   - **상단/하단 탭바에서 `내 펀드` 클릭 시 (`AppNav.tsx`) 또는 홈 화면 `내 펀드` 카드 클릭 시**:
     - 로그인 상태(`user !== null`): `/me/funds`로 즉시 이동.
     - 비로그인 상태(`user === null`): 페이지 이동을 막고(`e.preventDefault()`), **로그인 안내 모달(`LoginModal`)**을 즉시 오픈한다. 모달 상단 안내 문구로 *"내 펀드 수익률을 확인하려면 로그인이 필요해요"*를 표시하고, 로그인 성공 시 자동으로 `/me/funds`로 이동하게 한다.
   - **주소창으로 `/me/funds` 직접 진입 시 (`FundListPage.tsx`)**:
     - 비로그인 상태면 안내 없이 튕기지 않고, 화면에 **로그인 안내 카드(`EmptyState`: *"🔒 로그인이 필요한 메뉴예요 — 로그인 후 내 펀드 수익률과 운용 리포트를 확인해 보세요"* + `[로그인하기]` 버튼)**를 렌더링한다.

2. **모바일 앱 (`mobile`) 동작**:
   - **하단 탭바에서 `내 펀드` 탭 터치 시 (`(tabs)/_layout.tsx`) 또는 홈 화면 `내 펀드` 카드 터치 시**:
     - 로그인 상태(`user !== null`): `내 펀드` 탭 화면(`(tabs)/funds.tsx`)으로 즉시 이동.
     - 비로그인 상태(`user === null`):
       - `Tabs.Screen`의 `listeners={{ tabPress: (e) => { if (!user) { e.preventDefault(); openFundLoginSheet(); } } }}`를 통해 탭 이동을 막고, 기존 게임 탭과 동일한 디자인의 **로그인 안내 바텀시트(`ui/BottomSheet`)**를 띄운다:
         - 제목: `"로그인이 필요해요"`
         - 설명: `"내 펀드 수익률을 확인하고 기기에 안전하게 보관하려면 먼저 로그인해 주세요."`
         - 버튼: `[닫기]` / **`[로그인하러 가기]`** (클릭 시 `router.push('/profile')` 로그인 화면으로 이동)
   - **딥링크 등으로 `(tabs)/funds.tsx` 또는 `/fund`에 비로그인 상태로 도달한 경우**:
     - 화면 중앙에 동일한 로그인 안내 카드와 `[로그인하러 가기]` 버튼을 표시한다.

### 1-3. 상단 헤더 우측 `내정보` 아이콘/버튼 배치
1. **웹 (`web_client/src/components/Layout.tsx`)**:
   - 데스크톱/모바일 폭 모두 상단 헤더 우측에서 `내정보(/me)` 또는 로그인 모달에 즉시 접근할 수 있도록 우측 프로필/내정보 버튼(`UserMenu` 및 모바일용 `/me` 아이콘 링크)을 배치한다.
2. **모바일 앱 (`mobile`)**:
   - [`mobile/src/app/(tabs)/_layout.tsx`](../mobile/src/app/%28tabs%29/_layout.tsx)에서 `profile` 스크린은 `options={{ href: null }}`을 부여해 **하단 탭바 버튼에서는 숨기되 `/profile` 라우트와 내부 코드는 100% 그대로 유지**한다.
   - 공통 우측 상단 프로필/내정보 버튼(`ProfileHeaderButton`)을 탭 화면 상단 헤더 우측에 배치하여, 터치 시 언제든 `router.push('/profile')`(`내정보` 및 로그인 화면)로 이동할 수 있게 한다.

---

## 2. 홈 화면 (`/`, `(tabs)/index.tsx`) 3단 구조 개편 명세

> ⚠️ **보존 규칙**: 기존 [`MarketNote.tsx`](../web_client/src/components/home/MarketNote.tsx)(웹)와 [`home-summary.tsx`](../mobile/src/features/home/home-summary.tsx)(모바일) 컴포넌트 파일은 **삭제하지 않고 그대로 보존**하며, 홈 화면에서 조합하는 컴포넌트만 아래 3단 구성으로 교체합니다.

### 2-1. 섹션 ① [최상단 1순위] `내 펀드 수익 요약 카드` (`HomeFundCard`)
- **로그인 + 등록된 펀드가 있는 경우**:
  - 등록된 내 펀드의 **펀드명 · 최신 수익률/상태 한 줄(`fundStatusLine`) · 기준일**을 최상단 카드로 보여주며, 클릭 시 해당 펀드 리포트 상세(`/me/funds/:id`, `/fund/[id]`) 또는 `내 펀드` 탭으로 즉시 이동한다.
- **로그인했으나 아직 등록한 펀드가 없는 경우**:
  - *"💰 등록된 펀드가 아직 없어요 — 내 펀드를 등록하고 수익률 리포트를 받아보세요"* + **`[+ 내 펀드 등록하기 ›]`** 버튼 (클릭 시 `내 펀드` 탭으로 이동).
- **비로그인 상태인 경우**:
  - *"🔒 내 펀드 수익률 확인하기 — 로그인하면 내 펀드 수익률과 운용 리포트를 한눈에 볼 수 있어요"* + **`[로그인하고 내 펀드 보기 ›]`** 버튼 (클릭 시 로그인 안내 모달/시트 또는 로그인 화면 오픈).

### 2-2. 섹션 ② [중단 2순위 — 교육 투톱] `블로그 추천 글` & `오늘의 트레이딩 교육 카드`
1. **📌 추천 블로그 글 (`FeaturedPosts`)**:
   - 관리자가 지정한 추천 교육/분석 칼럼을 전면 배치.
   - 헤더 타이틀: `📌 추천 블로그 글`, 우측 더보기 링크: `블로그 전체 보기 ›` (`/community`).
2. **🎮 오늘의 실전 투자 교육 — 게임 & 차트 퀴즈 카드 (`HomeGameEduCard`)**:
   - *"블로그에서 배운 투자 원칙, 실전 차트 게임과 퀴즈로 연습해 보세요"* 안내와 함께:
     - **`[📈 실시간 모의 트레이딩]`** 버튼 → `/game` 이동
     - **`[🧩 10초 차트 퀴즈]`** 버튼 → `/game` 이동

### 2-3. 섹션 ③ [하단 3순위 — 참고용] `컴팩트 오늘 시장 참고` (`HomeMarketReference`)
- 기존에 만들어 둔 지수 조회 훅/컴포넌트(`HomeIndices` 등)를 재활용하여, 홈 최하단에 **코스피 · 코스닥 · 미국 대표 지수 · 원/달러 환율**만 작고 가볍게 표시하고 우측에 `[시장 더보기 ›]` (`/market`) 링크를 둔다.

---

## 3. 관리자 웹 (`admin_web`) 전체 스크리너 상시 노출 명세

사용자 웹(`web_client`)과 모바일 앱(`mobile`)에서는 스크리너가 숨겨져 있더라도, **관리자 웹(`admin_web`)에서는 모든 스크리너 기능을 스위치와 무관하게 언제나 사용할 수 있도록** `시장 데이터` 사이드바([`admin_web/src/components/Sidebar.tsx`](../admin_web/src/components/Sidebar.tsx))와 라우터([`admin_web/src/App.tsx`](../admin_web/src/App.tsx))에 전체 스크리너 메뉴를 상시 배치합니다:

| 메뉴명 | 경로 | 파일 | 상태 및 설명 |
| :--- | :--- | :--- | :--- |
| **🏆 주도주** | `/market/leaders` | [`MarketLeaders.tsx`](../admin_web/src/pages/MarketLeaders.tsx) | ✅ 구현됨 (CANSLIM 7대 기준 스크리너) |
| **📈 5·20 정배열 스크리너** | `/market/ma-screener` | [`MarketMaScreener.tsx`](../admin_web/src/pages/MarketMaScreener.tsx) | ✅ 구현됨 (5·20일선 정배열 4모드 + 시총/거래대금/거래량/등락률 필터) |
| **🔎 조건검색** | `/market/finder` | `MarketFinder.tsx` *(신설)* | 🆕 추가 (`web_client`의 [`FinderTab.tsx`](../web_client/src/pages/screener/FinderTab.tsx)와 동일 — 프리셋 4종 + 볼린저/매물대/RSI/재무 전체 필터 + 상단 `screener` 데이터셋 상태 카드) |
| **📐 차트 패턴** | `/market/patterns` | `MarketPatterns.tsx` *(신설)* | 🆕 추가 (`web_client`의 [`PatternsTab.tsx`](../web_client/src/pages/screener/PatternsTab.tsx)와 동일 — 컵·컵핸들·쌍바닥·플랫베이스·박스권·HTF 리포트 + 차트 위 패턴 도형 오버레이 + 상단 `patterns` 데이터셋 상태 카드) |
| **🗂️ 스크리너 탭 설정** | `/market/screener` | [`ScreenerSettings.tsx`](../admin_web/src/pages/ScreenerSettings.tsx) | ✅ 구현됨 (사용자 웹·앱 노출 ON/OFF 스위치) |

---

## 4. 단계별 구현 로드맵 (Claude Code 작업 플랜)

Claude Code에서 아래 Micro-Step 순서로 안전하게 구현 및 검증을 진행합니다.

### 📍 Phase 1: 웹 클라이언트 (`web_client`) 5탭 네비게이션 · 로그인 게이트 · 홈 개편
- [ ] **Step 1-1 (웹 5탭 네비게이션 & `내 펀드` 비로그인 안내)**:
  - [`web_client/src/lib/navSections.ts`](../web_client/src/lib/navSections.ts)에 `'funds'` 섹션 추가 및 기본 5탭 순서(`['home', 'funds', 'community', 'game', 'market']`, 스크리너 스위치 ON 시 기존대로 노출 가능) 정의.
  - [`web_client/src/components/AppNav.tsx`](../web_client/src/components/AppNav.tsx)에서 라벨을 `홈 · 내 펀드 · 블로그 · 게임 · 시장`으로 변경하고, 비로그인 상태에서 `내 펀드` 탭 클릭 시 로그인 안내 모달(`LoginModal`)을 띄우도록 연결.
  - [`web_client/src/pages/FundListPage.tsx`](../web_client/src/pages/FundListPage.tsx)에서 비로그인 진입 시 즉시 리다이렉트하는 대신 친절한 로그인 안내 카드 + `[로그인하기]` 버튼을 표시하도록 개선.
  - [`web_client/src/components/Layout.tsx`](../web_client/src/components/Layout.tsx) 헤더 우측에 모바일/데스크톱 공통 `내정보(/me)` 진입 아이콘/버튼 유지.
- [ ] **Step 1-2 (웹 홈 화면 3단 개편 — 기존 `MarketNote.tsx` 삭제 금지)**:
  - 기존 `MarketNote.tsx`는 그대로 보존한 채, `HomeFundCard.tsx`, `HomeGameEduCard.tsx`, `HomeMarketReference.tsx`를 작성하여 [`HomePage.tsx`](../web_client/src/pages/HomePage.tsx)에 배치.
  - `cd web_client && npm run build && npm test` 통과 검증.

### 📍 Phase 2: 모바일 앱 (`mobile`) 5탭 네비게이션 · 로그인 게이트 · 홈 개편
- [ ] **Step 2-1 (모바일 5탭 & `내 펀드` 비로그인 안내 시트 & 우측 상단 내정보 아이콘)**:
  - `mobile/src/app/(tabs)/funds.tsx` 탭 화면 추가(기존 `fund/index.tsx` 재사용, 기존 `/fund` 스택 라우트도 100% 유지).
  - [`mobile/src/app/(tabs)/_layout.tsx`](../mobile/src/app/%28tabs%29/_layout.tsx)를 `홈 · 내 펀드 · 블로그 · 게임 · 시장` 5탭으로 구성하고 `profile` 탭은 `href: null`로 숨김 처리.
  - 비로그인 상태에서 `내 펀드` 탭 터치 시 이동을 막고 `"로그인이 필요해요"` 안내 바텀시트(`BottomSheet`)를 띄워 `[로그인하러 가기]`(`/profile`)로 안내.
  - 탭 화면 상단 우측에 공통 `ProfileHeaderButton`(`내정보` 이동 아이콘) 배치.
- [ ] **Step 2-2 (모바일 홈 화면 개편 — 기존 `home-summary.tsx` 등 삭제 금지)**:
  - 기존 `home-summary.tsx` 등 시황 요약 파일들은 삭제하지 않고 그대로 유지한 채, `home-fund-card.tsx`, `home-game-edu-card.tsx`, `home-market-strip.tsx`를 추가하여 [`mobile/src/app/(tabs)/index.tsx`](../mobile/src/app/%28tabs%29/index.tsx)에 연결.
  - `cd mobile && npm run typecheck && npm test` 통과 검증.

### 📍 Phase 3: 관리자 웹 (`admin_web`) 전체 스크리너(`조건검색` · `차트 패턴`) 상시 메뉴 추가
- [ ] **Step 3-1 (`admin_web` 조건검색 `/market/finder` 추가)**:
  - `web_client`의 `FinderTab` 관련 컴포넌트·API를 `admin_web`에 이식하여 `admin_web/src/pages/MarketFinder.tsx` 생성(상단 `screener` 데이터셋 상태 카드 포함, 종목 상세 링크는 `/market/verify?ticker=` 연결).
- [ ] **Step 3-2 (`admin_web` 차트 패턴 `/market/patterns` 추가)**:
  - `web_client`의 `PatternsTab` 관련 컴포넌트·API를 `admin_web`에 이식하여 `admin_web/src/pages/MarketPatterns.tsx` 생성(상단 `patterns` 데이터셋 상태 카드 + `StockDailyChart` 패턴 도형 오버레이 포함).
  - [`admin_web/src/components/Sidebar.tsx`](../admin_web/src/components/Sidebar.tsx) 및 [`admin_web/src/App.tsx`](../admin_web/src/App.tsx)에 `🔎 조건검색(/market/finder)`, `📐 차트 패턴(/market/patterns)` 상시 노출 추가 후 `cd admin_web && npm run build` 검증.

---

## 5. Claude Code 실행용 프롬프트 템플릿

Claude Code에 아래 명령어를 그대로 입력하면 Phase 1부터 Phase 3까지 안전하게 구현합니다:

```text
docs/app_identity_and_nav_redesign_spec.md 와 PRODUCT.md 문서를 읽고, Phase 1(웹) → Phase 2(모바일) → Phase 3(관리자 웹 전체 스크리너 상시 노출)까지 순서대로 Micro-Step 단위로 구현해줘.
특히 (1) '내 펀드' 탭/카드는 로그인 후에만 이동 가능하고 비로그인 시 로그인 안내가 뜨도록 구현하고, (2) 기존에 만들어 둔 시황/스크리너/내정보 코드는 절대 삭제하지 말고 보존(Zero Deletion)하며, (3) 관리자 웹(admin_web)에는 모든 스크리너 기능(주도주·5·20 정배열·조건검색·차트 패턴)이 스위치와 무관하게 항상 노출되도록 구현해줘.
각 단계 완료 시 테스트(vitest / jest / tsc --noEmit) 실행 후 한국어로 요약 보고해줘.
```

