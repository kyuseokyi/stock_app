# 프론트엔드 전체 아키텍처 & 디자인 시스템 현대화 기획 및 클로드코드 구현 명세서 (Web · Admin · Mobile)

> **작성일**: 2026-11-27  
> **상태**: 확정 (클로드 코드가 단계별로 안전하게 마이그레이션할 수 있는 마스터 구현 명세서)  
> **대상 워크스페이스**: `web_client` (유저 웹), `admin_web` (관리자 웹), `mobile` (React Native / Expo 모바일 앱)  
> **목적**: 웹(`web_client`, `admin_web`)과 모바일(`mobile`) 전체의 스타일링·컴포넌트·클라이언트 상태·서버 상태·대용량 리스트 가상화 스택을 최신 표준 아키텍처로 전면 업그레이드하고 디자인 시스템을 통일한다.  
> **절대 원칙 (Zero Deletion & Regression 방지)**: 기존의 모든 비즈니스 로직(API 계약, 시세 노출 게이트 `marketData`/`REAL_MARKET`, 교육용 종가 게임, 내 펀드 기기 저장/Drive 백업, 4대 관리자 스크리너, 급등락·거래대금 분석, AI 심층 분석, RBAC 권한)은 **단 한 개도 누락하거나 깨뜨리지 않고 100% 보존**하면서 단계적(Phase 1 ~ Phase 6)으로 전환한다.

---

## 1. 목표 기술 스택 및 웹 ↔ 모바일 1:1 아키텍처 매핑

웹과 모바일이 동일한 멘탈 모델(Mental Model)과 디자인 토큰을 공유하도록 4대 핵심 레이어를 아래와 같이 정렬합니다.

| 아키텍처 레이어 | 웹 (`web_client` & `admin_web`) | 모바일 (`mobile` — React Native / Expo) | 핵심 도입 효과 및 설계 포인트 |
| :--- | :--- | :--- | :--- |
| **1. 스타일링 & UI 컴포넌트** | **Tailwind CSS v4 (`@theme` CSS 변수)** + **`shadcn/ui` (Radix UI 기반)** + `lucide-react` | **NativeWind v4 (또는 Unistyles v3 호환 유틸리티 브릿지)** + **`react-native-reusables` (Shadcn RN)** | • `tailwind.config.js` 대신 웹 표준 CSS 변수와 `@theme` 블록으로 파스텔 C안 디자인 토큰(Light/Dark)을 단일화.<br>• Radix 기반 `shadcn/ui` 프리미티브(Dialog, Sheet, Tabs, Select, Popover, Tooltip, Table, Command)로 접근성(WAI-ARIA, 키보드 내비게이션)과 커스터마이징 자유도를 동시에 확보. |
| **2. 클라이언트 상태 관리** | **Zustand v5** (`useShallow` Selector 강제 + **SSR/Next.js 대비 Context Factory 패턴** & `"use client"` 경계 분리) | **Zustand v5** (`useShallow` Selector 강제 + SecureStore/AsyncStorage 영속화 분리) | • 모든 컴포넌트에서 `useStore(s => s.field)` 또는 `useShallow`만 구독하여 불필요한 리렌더링을 원천 차단.<br>• SSR(Next.js 전환 또는 프리렌더링) 환경에서도 요청 간 전역 상태 오염이나 Hydration 불일치가 발생하지 않도록 `createStore` + React Context Provider 패턴과 `skipHydration` 기준 적용. |
| **3. 서버 상태 패칭 & 캐싱** | **TanStack Query v5 (`@tanstack/react-query`)** + **SSR `prefetchQuery` & `HydrationBoundary` 호환 아키텍처** | **TanStack Query v5 (`@tanstack/react-query`)** + **`AppState` (`focusManager`) & `NetInfo` (`onlineManager`) 연동** | • 기존 화면마다 흩어져 있던 수동 `useEffect + useState(loading/error/data)` 보일러플레이트를 **`queryOptions()` 팩토리** 기반으로 일원화.<br>• 초기 데이터 프리패칭(`HydrationBoundary`) 후 클라이언트 필터·정렬·무한 스크롤·뮤테이션·폴링(30초 지수/랭킹)을 TanStack Query가 매끄럽게 이어받음. |
| **4. 대용량 리스트 & 테이블 가상화** | **TanStack Virtual (`@tanstack/react-virtual`)** (`useVirtualizer`, `measureElement`, `React.memo`) | **FlashList (`@shopify/flash-list`)** (`estimatedItemSize`, `getItemType`, `React.memo`) | • 수백~수천 개 종목이 나오는 스크리너(주도주, 5·20 정배열, 조건검색, 급등락·거래대금 분석), 테마 목록, 랭킹, 블로그/댓글 목록에서 화면에 보이는 DOM/네이티브 뷰만 렌더링해 **60fps/120fps 스크롤 성능** 보장. |

---

## 2. 4대 핵심 영역별 상세 기술 명세

### 2.1 스타일링 & 디자인 시스템: Tailwind CSS v4 + `shadcn/ui` (Web) & Shadcn RN (Mobile)

#### A. Tailwind CSS v4 `@theme` 기반 통합 디자인 토큰 (`src/styles/globals.css`)
기존 Tailwind v3의 `tailwind.config.js`를 Tailwind CSS v4의 `@import "tailwindcss";` 및 `@theme` 지시어로 업그레이드하고, FunNote의 **토스식 파스텔 C안 팔레트**와 `shadcn/ui` 시맨틱 변수(`--background`, `--card`, `--primary`, `--muted`, `--border` 등)를 1:1로 통합합니다.

```css
@import "tailwindcss";

@layer base {
  :root {
    /* FunNote 파스텔 C안 Light 토큰 + shadcn/ui 시맨틱 변수 통합 */
    --background: #f7f5ff;          /* canvas: 연한 라벤더 바탕 */
    --foreground: #25223a;          /* ink: 본문/제목 */
    --card: #ffffff;                /* surface: 흰색 카드 */
    --card-foreground: #25223a;
    --popover: #ffffff;
    --popover-foreground: #25223a;
    --primary: #4963c1;             /* brand-strong: WCAG AA 통과 블루 */
    --primary-soft: #e2ecff;        /* brand-soft: 선택 칩 배경 */
    --primary-foreground: #ffffff;
    --secondary: #efebfb;           /* fill: 입력·미선택 칩 배경 */
    --secondary-foreground: #25223a;
    --muted: #efebfb;
    --muted-foreground: #6a6681;    /* ink-muted: 보조 문구 */
    --accent: #aa5278;              /* 핑크 포인트 (탭바·강조) */
    --accent-foreground: #ffffff;
    --up: #b6265d;                  /* 한국 증시 상승/수익 (핑크레드) */
    --up-soft: #fbd6e4;
    --down: #3c5dc1;                /* 한국 증시 하락/손실 (블루) */
    --down-soft: #d8e3fd;
    --destructive: #a14f09;         /* 위험/오류 (상승색과 구분되는 앰버/벽돌색) */
    --destructive-soft: #fde7d4;
    --border: #ebe7f7;              /* line */
    --input: #efebfb;
    --ring: #6f8ef0;
    --radius-card: 20px;
    --radius-btn: 14px;
    --radius-field: 12px;
  }

  .dark {
    --background: #1a1826;
    --foreground: #f3f1fa;
    --card: #24212f;
    --card-foreground: #f3f1fa;
    --popover: #24212f;
    --popover-foreground: #f3f1fa;
    --primary: #9fb4f7;
    --primary-soft: #2a3150;
    --primary-foreground: #1a1826;
    --secondary: #2c2839;
    --secondary-foreground: #f3f1fa;
    --muted: #2c2839;
    --muted-foreground: #a6a1bd;
    --accent: #f0a0c0;
    --up: #ff7aa2;
    --up-soft: #3d2230;
    --down: #8aa4ff;
    --down-soft: #23305a;
    --destructive: #ff8f80;
    --destructive-soft: #46231f;
    --border: #322e40;
    --input: #2c2839;
    --ring: #9fb4f7;
  }
}

@theme inline {
  /* 기존 클래스명(bg-canvas, text-ink, bg-fill, text-up 등)과 shadcn 클래스명(bg-background, bg-card 등) 동시 호환! */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-canvas: var(--background);
  --color-surface: var(--card);
  --color-fill: var(--secondary);
  --color-ink: var(--foreground);
  --color-ink-muted: var(--muted-foreground);
  --color-line: var(--border);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-brand: #6f8ef0;
  --color-brand-soft: var(--primary-soft);
  --color-brand-strong: var(--primary);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-up: var(--up);
  --color-up-soft: var(--up-soft);
  --color-down: var(--down);
  --color-down-soft: var(--down-soft);
  --color-danger: var(--destructive);
  --color-danger-soft: var(--destructive-soft);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-card: var(--radius-card);
  --radius-btn: var(--radius-btn);
  --radius-field: var(--radius-field);
}
```
> 💡 **핵심 설계**: 기존 컴포넌트들이 사용하던 `bg-canvas`, `bg-surface`, `text-ink`, `text-ink-muted`, `border-line`, `text-up`, `text-down` 클래스와 `shadcn/ui`가 사용하는 `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border` 클래스를 **`@theme inline`에서 동일한 CSS 변수로 매핑**하여, 마이그레이션 도중 기존 화면이 단 한 곳도 깨지지 않게 보장합니다!

#### B. `shadcn/ui` 표준 컴포넌트 세트 (`src/components/ui/`)
* **필수 유틸리티**: `clsx`, `tailwind-merge`, `class-variance-authority (cva)`, `lucide-react`
* **도입할 `shadcn/ui` (Radix Primitives) 컴포넌트**:
  1. `Button`, `Badge`, `Card`, `Skeleton`, `Separator` (기존 `src/components/ui/` 컴포넌트의 Props 하위 호환 유지)
  2. `Dialog` & `Sheet` (Drawer/BottomSheet): 게임 랭킹/규칙/퀘스트/퀴즈 모달, 약관 동의 모달, 모바일 반응형 필터 시트를 Radix `Dialog`/`Sheet`로 교체하여 포커스 트랩(Focus Trap), `ESC` 닫기, 스크린리더 접근성 완벽 확보
  3. `Tabs` & `ToggleGroup`: 시황/스크리너/급등락/게임 모드 전환 탭
  4. `Select`, `Popover`, `DropdownMenu`, `Command`: 스크리너 정렬 드롭다운, 관리자 회원 등급 변경, 종목 빠른 검색 팔레트(`Cmd+K`)
  5. `Table`, `Switch`, `Slider`, `Tooltip`: 관리자 권한 매트릭스, 기능 플래그 스위치, 조건검색 범위 슬라이더

#### C. 모바일 (`mobile`) NativeWind v4 + Shadcn RN (`react-native-reusables`) 통합
* 기존 `mobile/unistyles.ts` 토큰은 100% 보존하여 기존 화면의 회귀를 막고, `NativeWind v4`(`className` 유틸리티)와 `@rn-primitives/*`(`slot`, `dialog`, `tabs`, `select`, `switch`, `popover`) 기반의 `mobile/src/ui/shadcn/` 컴포넌트를 추가하여 웹과 동일한 유틸리티 클래스 감각으로 UI를 작성합니다.
* 숫자와 수익률 표시는 웹·모바일 모두 `tabular-nums`(`fontVariant: ['tabular-nums']`)를 기본 적용하여 실시간 틱이나 카운팅 시 글자 흔들림을 방지합니다.

---

### 2.2 클라이언트 상태: Zustand v5 고도화 (Selector 최적화 & SSR/Next.js 안전 아키텍처)

1. **원자적 Selector 및 `useShallow` 강제 규칙**:
   * 스토어 전체를 구독하는 `const store = useTradingGameStore()` 패턴을 전면 금지합니다.
   * 단일 값은 `useAuthStore((s) => s.token)`, 복수 값은 `useTradingGameStore(useShallow((s) => ({ status: s.status, season: s.season })))` 형태로만 구독하여 틱(초당 4회) 수신 시 차트 외 주문 패널·헤더가 불필요하게 리렌더링되지 않게 합니다.
2. **SSR / Next.js 호환 스토어 팩토리 및 Hydration 분리 (`"use client"`)**:
   * SSR 환경에서 모듈 레벨 싱글톤 스토어가 요청 간 공유되거나 `localStorage` 기반 초기값 때문에 Server HTML과 Client 첫 렌더 사이에 Hydration Mismatch 오류가 나는 것을 방지합니다:
     * 모든 스토어 모듈은 `createAuthStore()`, `createTradingGameStore()` **팩토리 함수**와 클라이언트 컴포넌트 전용 `StoreProvider` Context를 함께 제공합니다 (기존 `useAuthStore` 훅 시그니처는 내부에서 Context 또는 클라이언트 싱글톤을 자동 참조하도록 유지해 하위 호환 100% 보장).
     * `localStorage` / `sessionStorage`를 읽는 스토어(`auth`, `theme`, `ui`)는 SSR 안전 스토리지 어댑터(`typeof window !== 'undefined'`)와 `useHydrated()` 훅을 통해 클라이언트 마운트 이후 안전하게 복원합니다.
     * 상태를 사용하는 모든 인터랙티브 컴포넌트 파일 최상단에 `"use client"` 경계를 명시하여 향후 Next.js App Router 전환 시에도 즉시 동작하도록 구조화합니다.

---

### 2.3 서버 상태: TanStack Query v5 + SSR 프리패칭(`HydrationBoundary`) & 모바일 라이프사이클 연동

1. **공통 `QueryClient` 및 `queryOptions` 팩토리 표준화 (`src/queries/`)**:
   * 도메인별 Query Key & `queryOptions` 팩토리를 설계하여 서버 프리패칭과 클라이언트 `useQuery`가 동일한 키와 타입을 공유합니다:
     * `marketQueries.overview()`, `marketQueries.groups(kind, period, sort)`, `marketQueries.calendar(start, end)`
     * `screenerQueries.leaders(filters)`, `screenerQueries.ma5_20(filters)`, `screenerQueries.dailySurge(date, mode, sort)`
     * `gameQueries.activeSeason()`, `gameQueries.eduState()`, `gameQueries.leaderboard(period)`
     * `blogQueries.boards()`, `blogQueries.posts(boardId, page)`
2. **Next.js / SSR 프리패칭 + `HydrationBoundary` 브릿지 (`src/lib/queryHydration.tsx`)**:
   * 요청 단위 `makeQueryClient()` 팩토리(서버에서는 매 요청 새 인스턴스 생성, 브라우저에서는 싱글톤 유지)를 구현합니다.
   * 초기 진입 데이터는 `dehydrate(queryClient)` + `<HydrationBoundary state={dehydratedState}>`로 주입받을 수 있게 설계하고, 이후 필터 변경·탭 전환·페이지네이션·뮤테이션(`useMutation` + `invalidateQueries`)·주기적 폴링(`refetchInterval: 30_000`)은 클라이언트 TanStack Query가 담당합니다.
3. **모바일 (`mobile`) 전용 `AppState` & `NetInfo` 연동 (`mobile/src/lib/query-client.ts`)**:
   * `focusManager.setEventListener`: React Native `AppState`가 `active`로 돌아올 때 자동으로 stale 쿼리를 백그라운드 갱신.
   * `onlineManager.setEventListener`: 네트워크 재연결 시 실패했던 쿼리 자동 재시도.

---

### 2.4 대용량 리스트 가상화: TanStack Virtual (Web) & FlashList (Mobile)

스크리너 결과(최대 2,600종목), 급등락·거래대금 분석 표, 테마/업종 300개 목록, 게임 랭킹 Top 100, 관리자 회원 목록 등 긴 목록에 가상화(Virtualization)를 전면 적용합니다.

1. **웹 (`web_client` & `admin_web`) — `@tanstack/react-virtual`**:
   * 공통 가상화 컴포넌트 2종을 구축합니다:
     * **`VirtualList<T>` (`src/components/ui/VirtualList.tsx`)**: 카드형/행형 리스트용. `useVirtualizer({ count, getScrollElement, estimateSize })` + **`ref={virtualizer.measureElement}`(가변 높이 자동 실측)** 적용.
     * **`VirtualTable<T>` (`src/components/ui/VirtualTable.tsx`)**: 관리자 스크리너(`5·20 정배열`, `주도주`, `조건검색`, `급등락·거래대금 분석`, `회원 목록`) 테이블용. 상단 `<thead>`는 `sticky top-0 z-10`으로 고정하고 `<tbody>` 내부 행만 가상화 렌더링.
   * **덜컹거림(Jump/Jank) 방지 3대 규칙**:
     1. 모든 리스트 아이템 컴포넌트는 **`React.memo`**로 감싸고 핸들러는 `useCallback`으로 고정.
     2. 아코디언/상세 펼침이 있는 행(예: 모바일 웹 스크리너 행 펼침)은 `data-index={virtualRow.index}`와 `ref={virtualizer.measureElement}`를 연결하여 높이가 변할 때 즉시 재계산.
     3. `overscan: 8` 설정으로 빠른 휠/터치 스크롤 시에도 빈 공간(White flash)이 보이지 않게 버퍼 확보.
2. **모바일 (`mobile`) — `@shopify/flash-list`**:
   * 기존 `FlatList` 및 `ScrollView + map()`으로 렌더링하던 스크리너 목록(`leaders`, `finder`, `patterns`, `themes`), 블로그 글/댓글 목록, 랭킹 시트를 **`FlashList`**로 교체합니다.
   * `estimatedItemSize`를 실제 행 높이(예: 종목 행 `76`, 블로그 카드 `112`)로 정확히 지정하고, 리스트 아이템을 `React.memo`로 메모이제이션합니다.

---

## 3. 클로드코드(Claude Code) 단계별 구현 계획 (Phase 1 ~ Phase 6)

범위가 넓으므로 클로드 코드가 한 번에 한 단계씩 빌드와 테스트(`tsc --noEmit`, `vitest`, `jest`)를 통과시키며 안전하게 진행하도록 6개 Phase로 나눕니다.

### Phase 1: 웹 스타일링 기반 업그레이드 — Tailwind CSS v4 + `@theme` 토큰 + `shadcn/ui` 코어 구축 (`web_client` & `admin_web`)
* **작업 내용**:
  1. `web_client`와 `admin_web`에 Tailwind CSS v4(`tailwindcss@^4`, `@tailwindcss/vite`), `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@radix-ui/react-dialog`, `@radix-ui/react-tabs`, `@radix-ui/react-select`, `@radix-ui/react-popover`, `@radix-ui/react-tooltip`, `@radix-ui/react-switch`, `@radix-ui/react-slot` 설치.
  2. `src/styles/globals.css`(또는 `index.css`)를 Tailwind v4 `@import "tailwindcss";` 및 `@theme inline` 구조로 전환하고, 기존 커스텀 컬러(`canvas`, `surface`, `fill`, `ink`, `brand`, `up`, `down`, `danger`, `line`)와 `shadcn/ui` 시맨틱 컬러(`background`, `foreground`, `card`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`)를 동시 매핑.
  3. `src/lib/utils.ts`(`cn()` 헬퍼) 및 `src/components/ui/`에 `shadcn/ui` 표준 컴포넌트(`Button`, `Card`, `Badge`, `Chip`, `Dialog`, `Sheet`, `Tabs`, `Select`, `Switch`, `Table`, `Skeleton`, `EmptyState`) 구축 (기존 컴포넌트 import 경로와 Props 100% 호환 유지).
* **검증**: `npm run build` (`tsc --noEmit && vite build`) 및 `npm test` 통과 확인.

### Phase 2: Zustand v5 클라이언트 스토어 리팩토링 (Selector 최적화 & SSR/Next.js 안전 구조)
* **작업 내용**:
  1. `web_client/src/store/`(`auth.ts`, `tradingGame.ts`, `fund.ts`), `admin_web/src/store/`(`me.ts`, `ui.ts`), `mobile/src/features/*/store.ts`를 Zustand v5 표준으로 정리.
  2. SSR/Next.js 호환을 위한 `createStore` 팩토리 + `StoreProvider` Context 래퍼 및 `useHydrated` 훅 추가, 클라이언트 상태 컴포넌트에 `"use client"` 지시어 명시.
  3. 컴포넌트 내 스토어 구독부를 전수 점검하여 단일 필드 Selector 또는 `useShallow` 구독으로 교체(불필요한 리렌더링 제거).
* **검증**: 로그인/로그아웃, 약관 동의 게이트, 내 펀드 계정별 격리, 게임 실시간 틱 수신 테스트 통과 확인.

### Phase 3: TanStack Query v5 도입 및 서버 상태 레이어 통합 (`web_client` & `admin_web`)
* **작업 내용**:
  1. `@tanstack/react-query` 설치 및 `src/lib/queryClient.ts` (`makeQueryClient` SSR/CSR 겸용 팩토리, `HydrationBoundary` 헬퍼, 401 세션 만료 글로벌 핸들러 연동) 생성.
  2. `src/queries/` 폴더에 도메인별 `queryOptions` 정의:
     * `marketQueries.ts` (지수/거시 개요, 테마/업종 순위, 캘린더, 시세 공개 플래그 `screenerFeatures`)
     * `screenerQueries.ts` (주도주, 5·20 정배열, 조건검색, 차트 패턴, 급등락·거래대금 분석)
     * `blogQueries.ts` (게시판, 게시글, 댓글, 신고)
     * `gameQueries.ts` (활성 시즌, 교육용 종가 게임 상태, 리더보드, 규칙)
  3. 페이지/컴포넌트의 수동 `useEffect + fetch` 로직을 `useQuery`, `useInfiniteQuery`, `useMutation`으로 단계적 전환.
* **검증**: 기존 API 계약 테스트(`test_stock_search_contract.py` 등) 및 프론트엔드 Vitest 테스트 100% 통과 확인.

### Phase 4: TanStack Virtual (`@tanstack/react-virtual`) 대용량 리스트·테이블 가상화 적용 (`web_client` & `admin_web`)
* **작업 내용**:
  1. `@tanstack/react-virtual` 설치 및 공통 `VirtualList.tsx`, `VirtualTable.tsx` 컴포넌트 작성 (`measureElement` 가변 높이 측정 + `React.memo` 행 컴포넌트 적용).
  2. **적용 대상 화면**:
     * `admin_web`: `주도주(/market/leaders)`, `5·20 정배열 스크리너(/market/ma-screener)`, `조건검색(/market/finder)`, `차트 패턴(/market/patterns)`, `급등락·거래대금 분석(/market/daily-surge)`, `테마 보정(/market/themes)`, `회원 목록(/members)`, `퀴즈 관리(/game/quizzes)`.
     * `web_client`: `시장/테마/업종 순위 목록`, `블로그 게시글/댓글 목록`, `게임 랭킹 모달(Top 100)`.
* **검증**: 2,500개 행 렌더링 시 DOM 노드 수가 화면 가시 영역(약 15~25개)으로 유지되는지 및 스크롤 덜컹거림이 없는지 검증.

### Phase 5: 모바일 앱 (`mobile`) TanStack Query + FlashList + NativeWind v4 / Shadcn RN 업그레이드
* **작업 내용**:
  1. `mobile`에 `@tanstack/react-query`, `@shopify/flash-list`, `@react-native-community/netinfo` 및 Shadcn RN 프리미티브(`@rn-primitives/*`) 설치.
  2. `mobile/src/lib/query-client.ts`에 `AppState` 포커스 매니저 및 `NetInfo` 온라인 매니저 연결 후 루트 `_layout.tsx`에 `QueryClientProvider` 장착.
  3. 모바일의 시황·스크리너·블로그·게임 랭킹 리스트를 `FlashList` + `React.memo` 아이템으로 교체하여 모바일 스크롤 병목 제거.
  4. 모바일 UI 컴포넌트(`mobile/src/ui/`)를 Shadcn RN 패턴(접근성 role, 바텀시트, 탭, 칩, 카드)과 파스텔 C안 토큰으로 정교화.
* **검증**: `npm run typecheck` (`tsc --noEmit`) 및 `npm test` (`jest`) 통과 확인.

### Phase 6: 통합 디자인 폴리싱 & 회귀 테스트 (Web · Admin · Mobile)
* **작업 내용**:
  1. 모든 모달/드로어/드롭다운을 `shadcn/ui` (`Dialog`, `Sheet`, `Select`, `DropdownMenu`)로 통일하고 숫자 표기에 `tabular-nums` 일괄 적용.
  2. 라이트/다크 테마 전환 시 CSS 변수(`@theme`)와 차트(`lightweight-charts`) 배경·눈금 색상이 즉시 동기화되는지 점검.
  3. 전체 테스트 스위트(`pytest`, `web_client vitest`, `admin_web tsc/build`, `mobile jest`) 실행 및 검증 완료.
