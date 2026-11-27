# 프론트엔드 현대화 Phase 3 — TanStack Query 기반 + 핵심 화면 전환 설계

> 작성 2026-11-27 · 원 기획: [`docs/frontend_modernization_tailwind4_shadcn_tanstack_spec.md`](../../frontend_modernization_tailwind4_shadcn_tanstack_spec.md) 2.3절·Phase 3
> 이 문서가 원 기획과 다르면 **이 문서가 우선**. 앞 단계: [Phase 1](2026-11-27-frontend-modernization-phase1-admin-design.md) · [Phase 2](2026-11-27-frontend-modernization-phase2-zustand-design.md)

## 0. 원 기획에서 바꾼 것 (사용자 결정 2026-11-27)
| 원 기획 | 이 설계 | 이유 |
|---|---|---|
| 모든 화면의 수동 `useEffect + fetch` 전환 | **기반 + 핵심 화면만.** 나머지는 화면을 고칠 때 점진적으로 | 웹 124개 파일 — 회귀 검수 범위 |
| SSR `HydrationBoundary` 프리패칭 | **`makeQueryClient()` 팩토리만**(서버=매번 새 인스턴스, 브라우저=싱글톤). Hydration 브릿지·프리패칭은 SSR 도입 때 | 지금은 Vite SPA |
| `gameQueries` | **제외**(게임=WebSocket 실시간, 내 펀드=기기 저장 — 지금 구조 유지) | |
| 401 글로벌 핸들러를 Query 에 | **기존 axios 인터셉터 유지**(Query 쪽 중복 처리 없음) | 이미 로그아웃·안내까지 처리 |

## 1. 전환 방식
- **A — 시황 개요(`web_client/src/pages/market/OverviewTab.tsx`)**: `hooks/useMarketSection.ts` 의 **입출력(인자·`SectionState`·`reload`·`silentRefresh`·`fetchedAt` 등 지금 돌려주는 모든 것)은 그대로** 두고 내부만 `useQuery` 로. 지금 동작을 그대로 지킨다:
  - 늦게 온 옛 응답 버림 → 조회 키 단위 관리(Query 기본)
  - 조용한 갱신 실패 시 보이던 값 유지 → 오류여도 `data` 유지, `failed` 는 첫 로딩·[다시 시도] 실패에만
  - 앞 요청 진행 중이면 조용한 갱신 건너뜀 → `isFetching` 이면 skip
  - `keepCurrent(cur, next)` → `structuralSharing: (old, next) => keepCurrent(old, next) ? old : next`
  - `enabled=false` → 요청 없음·빈 상태(로딩·실패 아님), true 가 되면 그때 조회
  - 조용한 갱신은 `MARKET_REQUEST_TIMEOUT_MS` 로 fetcher 호출(지금과 같음)
  - 조회 키: 훅 시그니처를 바꾸지 않기 위해 fetcher 함수마다 고정 id(모듈 `WeakMap`)로 `['marketSection', id]`.
  - 폴링은 지금처럼 `useVisibleInterval` + `silentRefresh` 를 그대로 쓴다(타이머 동작 변화 없음).
- **B — 나머지 핵심 화면**: 화면에서 `useQuery(xxxQueries.yyy(...))` 직접 호출, `useEffect + useState(loading/error/data)` 제거.
  - web_client: `pages/market/GroupTab.tsx`, `pages/market/CalendarTab.tsx`, `pages/screener/FinderTab.tsx`, `pages/screener/PatternsTab.tsx`, `pages/PostListPage.tsx`
  - admin_web: `pages/MarketLeaders.tsx`, `pages/MarketMaScreener.tsx`, `pages/MarketFinder.tsx`, `pages/MarketPatterns.tsx`, `pages/MarketDailySurge.tsx`
  - 페이징 목록은 `placeholderData: keepPreviousData`(쪽 넘김 깜빡임 없음).
  - 저장·삭제(급등락 메모 저장·삭제, 수동 집계)는 `useMutation` + 관련 키 `invalidateQueries`.
  - 화면의 로딩·빈·오류 문구와 배치는 그대로(사용자에게 보이는 변화 없음).

## 2. 기반
- 의존성: `@tanstack/react-query@5.107.1`(두 웹), `@tanstack/react-query-devtools@5.107.1`(개발 모드에서만 동적 import, 운영 번들에 포함 안 됨).
- `src/lib/queryClient.ts`(두 웹 각각):
  - `makeQueryClient()` — 기본값: `retry: (n, err) => 4xx 면 false, 그 밖은 n < 1`(5xx·네트워크 1회), `refetchOnWindowFocus: false`, `staleTime: 30_000`.
  - `getQueryClient()` — `typeof window === 'undefined'` 면 매번 `makeQueryClient()`, 브라우저면 모듈 싱글톤(SSR 확장 대비).
  - `main.tsx` 에서 `<QueryClientProvider client={getQueryClient()}>`.
- `src/queries/`(조회 정의 모음 — 기존 `api/*.ts` 함수를 그대로 감쌈, API 계약 변경 없음):
  - web_client: `marketQueries.ts`(groups·calendar 등), `screenerQueries.ts`(finder·patterns), `blogQueries.ts`(posts)
  - admin_web: `screenerQueries.ts`(leaders·maScreener·finder·patterns·dailySurge 목록·그룹·상세)
  - 키 규칙: `[도메인, 종류, ...파라미터]`(예: `['screener', 'finder', filters]`).

## 3. 테스트
- `queryClient`: 4xx 재시도 안 함, 5xx 1회 재시도, 서버(window 없음)에서는 매번 새 인스턴스.
- `useMarketSection`(A) 동작 보존: 늦은 응답 버림, 조용한 갱신 실패 시 값 유지·`failed` false, `enabled=false` 요청 없음→true 에 조회, `keepCurrent` true 면 이전 값 유지, 갱신 중 중복 건너뜀.
- B 화면마다 로딩·성공·오류 3상태(가짜 api 모듈, Testing Library). admin 은 mutation 뒤 목록 재조회.

## 4. 검증
- web_client: `tsc`, `npm test`, `npm run lint`(새 위반 0), `build`
- admin_web: `tsc`, `npm test`, `build`
- 브라우저(가짜 API): 바뀐 화면마다 데이터 표시, 시황 개요 30초 갱신·탭 숨김 시 멈춤, 쪽 넘김 깜빡임 없음, 운영 빌드 번들에 devtools 없음(`grep -c ReactQueryDevtools dist/assets/*.js` = 0).
