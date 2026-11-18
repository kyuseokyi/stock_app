# 앱 정체성 재정의 및 홈·네비게이션(5탭) 개편 기술 명세서

> **목적**: `FunNote`의 핵심 정체성을 **"① 내 펀드 수익률 확인 + ② 블로그·게임을 통한 투자 교육 (시장은 가벼운 참고용)"**으로 명확히 재정립하고, 이에 맞춰 웹(`web_client`)과 모바일 앱(`mobile`)의 **메인 네비게이션(5탭 + 우측 상단 내정보)** 및 **홈 화면 구성**을 개편하기 위한 상세 기술 명세 및 Claude Code 구현 플랜입니다.
>
> **제품 정의 기준 문서**: [`PRODUCT.md`](../PRODUCT.md)

---

## 0. 정체성 재정의 핵심 원칙 (Before vs After)

| 구분 | 기존 구조 (Before) | 개편 구조 (After) |
| :--- | :--- | :--- |
| **앱의 핵심 정체성** | 시황(마켓)·스크리너 중심의 종합 증시 정보 앱처럼 보임 | **① 내 펀드 수익률 확인** + **② 블로그·게임을 통한 투자 교육**이 메인 |
| **시장(시황)의 역할** | 홈 화면의 80% 차지 + 두 번째 메인 탭(`마켓`) | **가벼운 참고용 보조 자료** (홈 최하단 미니 요약 + 마지막 탭 `시장`) |
| **내 펀드의 위치** | `내정보 → 내 펀드 수익` 2단계 깊숙이 숨겨져 있음 | **메인 2번째 탭(`내 펀드`) 승격 + 홈 화면 최상단 요약 카드 배치** |
| **메인 네비게이션** | `홈 · 마켓 · (스크리너) · 커뮤니티 · 게임 · 내정보` (가변 5~6탭) | **`홈 · 내 펀드 · 블로그 · 게임 · 시장` (고정 5탭)** |
| **내정보 진입점** | 하단 마지막 탭(`내정보`) 차지 | **상단 헤더 우측 프로필/내정보 아이콘(버튼)**으로 이동 |

---

## 1. 네비게이션 및 라우팅 개편 명세 (`web_client` & `mobile`)

### 1-1. 고정 5탭 메뉴 구성 및 명칭
웹 상단 GNB([`AppNav.tsx`](../web_client/src/components/AppNav.tsx))와 모바일 하단 탭바([`mobile/src/app/(tabs)/_layout.tsx`](../mobile/src/app/%28tabs%29/_layout.tsx)) 모두 아래 **5개 탭 순서와 이름**으로 통일합니다:

| 순서 | 탭 이름 (`label`) | 섹션 키 (`Section`) | 웹 경로 (`to`) | 모바일 탭 파일 | 아이콘 (Ionicons / SVG) |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **1** | **홈** | `'home'` | `/` | `(tabs)/index.tsx` | `home-outline` |
| **2** | **내 펀드** | `'funds'` | `/me/funds` | `(tabs)/funds.tsx` *(신설/연결)* | `wallet-outline` (또는 `pie-chart-outline`) |
| **3** | **블로그** | `'community'` | `/community` | `(tabs)/community.tsx` | `book-outline` (또는 `reader-outline`) |
| **4** | **게임** | `'game'` | `/game` | `(tabs)/game.tsx` | `game-controller-outline` |
| **5** | **시장** | `'market'` | `/market` | `(tabs)/market.tsx` | `pulse-outline` |

> **⚠️ 회귀 방지 (라우트 URL & 푸시 딥링크 100% 보존)**:
> - 기존 URL 경로(`/community`, `/boards/:id`, `/posts/:id`, `/market`, `/me/funds`, `/me`)와 모바일 푸시 알림 이동 경로(`'/community'`, `'/fund'`, `'/profile'`)는 **절대 변경하거나 삭제하지 않는다.**
> - 탭에 표시되는 **사용자 노출 라벨(Label)만** `'커뮤니티' → '블로그'`, `'마켓' → '시장'`으로 변경하고, 경로 매핑(`sectionOf`)만 조정하여 기존 북마크와 알림이 100% 그대로 동작하게 한다.
> - 만약 관리자 스위치(`STOCK_FINDER`)가 켜져 있을 때는 하단 탭을 6개로 늘리지 않고, **`시장` 화면 상단 칩 바에 `[🔎 종목 찾기(스크리너)]` 진입 칩**을 노출하여 하단 5탭 레이아웃의 균형을 유지한다.

### 1-2. 상단 헤더 우측 `내정보` 버튼 배치
1. **웹 (`web_client/src/components/Layout.tsx`)**:
   - 상단 헤더 우측 영역에 현재의 `UserMenu` / `[로그인]` 버튼과 함께 언제든 `/me`(`내정보` — 알림/차단관리/약관/계정관리)로 이동할 수 있는 프로필 아이콘/링크를 유지한다.
   - 모바일 브라우저 폭(`sm:hidden`)에서도 상단 헤더 우측에 **내정보 아이콘 버튼(`<Link to="/me" aria-label="내정보">` 👤)**이 항상 노출되도록 한다.
2. **모바일 앱 (`mobile`)**:
   - [`mobile/src/app/(tabs)/_layout.tsx`](../mobile/src/app/%28tabs%29/_layout.tsx)에서 `profile` 스크린은 `options={{ href: null }}`을 부여해 **하단 탭바 버튼에서는 숨기되 라우트(`/profile`)는 그대로 유지**한다.
   - 공통 상단 헤더 컴포넌트(또는 각 탭 상단 우측 영역 `ProfileHeaderButton`)를 추가하여, 로그인 상태면 닉네임 이니셜/프로필 아이콘을, 비로그인 상태면 `로그인 / 내정보` 아이콘(`person-circle-outline`)을 표시하고 탭 시 `router.push('/profile')`로 이동하게 한다.

---

## 2. 홈 화면 (`/`, `(tabs)/index.tsx`) 3단 구조 전면 개편

홈 화면을 열었을 때 사용자가 **"1순위: 내 펀드 수익 확인 → 2순위: 블로그·게임으로 투자 학습 → 3순위: 가벼운 시장 참고"** 순서로 자연스럽게 경험하도록 재배치합니다.

### 2-1. 섹션 ① [최상단 1순위] `내 펀드 수익 요약 카드` (`HomeFundCard`)
- **데이터 소스**: 기존의 기기 내 계정별 펀드 스토리지(`fundStorage` / `useFundList`)를 그대로 재사용.
- **표시 상태별 UI**:
  1. **등록된 펀드가 있는 경우**:
     - 대표 펀드(또는 등록된 펀드 요약)의 **펀드명 · 현재 누적 수익률(%, 상승 핑크레드 / 하락 블루) · 최근 기준일**을 큼직하게 표시.
     - 카드 클릭 시 해당 펀드 리포트 상세(`/me/funds/:id`, `/fund/[id]`)로 이동하며, 우측 상단에 `[내 펀드 전체 보기 ›]`(`/me/funds`) 링크 제공.
  2. **로그인했으나 등록된 펀드가 없는 경우 / 비로그인**:
     - *"💰 내 펀드 수익률을 등록하고 리포트를 받아보세요"* 안내 문구와 `[내 펀드 바로가기 ›]` CTA 버튼 표시.

### 2-2. 섹션 ② [중단 2순위 — 교육 투톱] `블로그 추천 글` & `오늘의 트레이딩 교육 카드`
1. **📌 추천 블로그 글 (`FeaturedPosts`)**:
   - 관리자가 지정한 추천 교육/분석 칼럼을 전면 배치.
   - 헤더 타이틀을 `📌 추천 블로그 글`로 표시하고 우측 링크를 `블로그 전체 보기 ›`(`/community`)로 연결.
2. **🎮 오늘의 실전 투자 교육 — 게임 & 차트 퀴즈 카드 (`HomeGameEduCard`)**:
   - *"배운 원칙을 실전 차트에서 연습해 보세요"* 한 줄 안내와 함께:
     - **`[📈 실시간 모의 트레이딩]`** 버튼 → `/game` 이동
     - **`[🧩 10초 차트 퀴즈]`** 버튼 → `/game` (퀴즈 모달/화면) 이동
   - 웹 넓은 화면(`lg+` 2단 그리드)에서는 좌측 메인 컬럼에 `내 펀드 요약 카드` + `추천 블로그 글`을 두고, 우측 사이드바(`<aside>`)에 `오늘의 트레이딩 교육 카드` + `컴팩트 시장 요약 카드`를 배치하여 한눈에 들어오게 구성한다.

### 2-3. 섹션 ③ [하단 3순위 — 참고용] `한 줄 시장 참고 스트립` (`HomeMarketReference`)
- **기존과의 차이**:
  - 기존 홈 화면에서 큰 면적을 차지하던 급등·급락 10종목 표, 주도 테마 랭킹, 업종 트리맵, 긴 AI 브리핑을 홈에서 제거(모두 `시장` 탭에서 열람 가능).
- **컴팩트 구성**:
  - 제목: `📊 오늘 시장 참고` + 우측 `[시장 자세히 보기 ›]`(`/market`)
  - 내용: **코스피 · 코스닥 · 나스닥(또는 S&P500) · 원/달러 환율** 4개 핵심 지표만 1줄(또는 2x2 미니 그리드)로 가볍게 표시하여 스크롤 부담을 없앤다.

---

## 3. 화면 타이틀 및 문구 변경 명세

| 위치 | 기존 문구 | 변경 문구 | 대상 파일 |
| :--- | :--- | :--- | :--- |
| 브라우저 탭 제목 (`/`) | `오늘 시장 노트 · FunNote` | `홈 · FunNote` | [`web_client/src/lib/pageTitle.ts`](../web_client/src/lib/pageTitle.ts) |
| 브라우저 탭 제목 (`/community`) | `커뮤니티 · FunNote` | `블로그 · FunNote` | [`web_client/src/lib/pageTitle.ts`](../web_client/src/lib/pageTitle.ts) |
| 브라우저 탭 제목 (`/market`) | `오늘의 증시 · FunNote` | `시장 · FunNote` | [`web_client/src/lib/pageTitle.ts`](../web_client/src/lib/pageTitle.ts) |
| 마켓 화면 상단 헤더 | `오늘의 증시` | `오늘의 시장` (부제: *"투자 참고용 시장 흐름이에요"*) | [`OverviewTab.tsx`](../web_client/src/pages/market/OverviewTab.tsx), [`market.tsx`](../mobile/src/app/%28tabs%29/market.tsx) |

---

## 4. 단계별 구현 로드맵 (Claude Code 작업 플랜)

Claude Code에서 아래 Micro-Step 순서로 안전하게 구현 및 검증을 진행합니다.

### 📍 Phase 1: 웹 클라이언트 (`web_client`) 5탭 네비게이션 및 홈 화면 개편
- [ ] **Step 1-1 (웹 네비게이션 & 헤더 개편)**:
  - [`web_client/src/lib/navSections.ts`](../web_client/src/lib/navSections.ts)에 `'funds'` 섹션 추가 및 5탭 순서(`['home', 'funds', 'community', 'game', 'market']`) 정의 (`/me/funds`는 `'funds'` 섹션으로 매핑).
  - [`web_client/src/components/AppNav.tsx`](../web_client/src/components/AppNav.tsx)에서 5탭 라벨(`홈 · 내 펀드 · 블로그 · 게임 · 시장`) 적용 및 [`Layout.tsx`](../web_client/src/components/Layout.tsx) 헤더 우측에 모바일/데스크톱 공통 `내정보(/me)` 진입 버튼 보강.
  - [`web_client/src/lib/pageTitle.ts`](../web_client/src/lib/pageTitle.ts) 타이틀 문구 업데이트 및 단위 테스트(Vitest) 갱신.
- [ ] **Step 1-2 (웹 홈 화면 3단 개편)**:
  - `web_client/src/components/home/HomeFundCard.tsx` (내 펀드 수익 요약 카드), `HomeGameEduCard.tsx` (게임·차트 퀴즈 교육 배너), `HomeMarketReference.tsx` (컴팩트 지수 요약) 작성.
  - [`web_client/src/pages/HomePage.tsx`](../web_client/src/pages/HomePage.tsx)를 `① 내 펀드 → ② 블로그 추천글 & 게임 교육 → ③ 참고용 시장 요약` 구조로 교체.
  - `cd web_client && npm run build && npm test` 통과 검증.

### 📍 Phase 2: 모바일 앱 (`mobile`) 5탭 네비게이션 및 홈 화면 개편
- [ ] **Step 2-1 (모바일 5탭 & 우측 상단 내정보 아이콘)**:
  - `mobile/src/app/(tabs)/funds.tsx` 탭 화면 연결(기존 `fund/index.tsx` 화면 컴포넌트 재사용, `/fund` 스택 라우트도 푸시 알림 호환을 위해 그대로 유지).
  - [`mobile/src/app/(tabs)/_layout.tsx`](../mobile/src/app/%28tabs%29/_layout.tsx)를 `홈 · 내 펀드 · 블로그 · 게임 · 시장` 5탭으로 변경하고 `profile` 탭은 `href: null`로 숨김 처리.
  - 공통 우측 상단 프로필/내정보 아이콘 버튼(`ProfileHeaderButton`)을 제작해 탭 화면 상단 헤더 우측에 배치(탭 시 `/profile` 이동).
- [ ] **Step 2-2 (모바일 홈 화면 개편)**:
  - `mobile/src/features/home/`에 `home-fund-card.tsx`, `home-game-edu-card.tsx`, `home-market-strip.tsx` 작성.
  - [`mobile/src/app/(tabs)/index.tsx`](../mobile/src/app/%28tabs%29/index.tsx)의 `ListHeaderComponent`에 `내 펀드 수익 요약 카드` + `트레이딩 교육 배너` + `추천 블로그 글`을 배치하고, `ListFooterComponent`에 컴팩트한 `오늘 시장 참고 스트립`을 배치.
  - `cd mobile && npm run typecheck && npm test` 통과 검증.

---

## 5. Claude Code 실행용 프롬프트 템플릿

Claude Code에 아래 명령어를 그대로 입력하면 Phase 1부터 Phase 2까지 순차적으로 구현 및 검증을 수행합니다:

```text
docs/app_identity_and_nav_redesign_spec.md 와 PRODUCT.md 문서를 읽고, Phase 1(웹)부터 Phase 2(모바일)까지 순서대로 Micro-Step 단위로 구현해줘.
기존 URL 경로와 푸시 알림 딥링크(Regression Prevention)가 절대 깨지지 않도록 유지하고, 각 단계 완료 시 테스트(vitest / jest / tsc --noEmit) 실행 후 한국어로 요약 보고해줘.
```
