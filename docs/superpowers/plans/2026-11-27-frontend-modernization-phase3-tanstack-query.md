# 프론트엔드 현대화 Phase 3 (TanStack Query) 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬 — superpowers:executing-plans. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 두 웹에 TanStack Query 기반(`makeQueryClient`·조회 정의 모음)을 깔고, 시황 개요는 기존 훅 내부만(A), 나머지 핵심 화면 10개는 `useQuery` 직접 호출(B)로 바꾼다. 사용자에게 보이는 동작 변화는 없다.

**설계:** [`../specs/2026-11-27-frontend-modernization-phase3-tanstack-query-design.md`](../specs/2026-11-27-frontend-modernization-phase3-tanstack-query-design.md)

**기술:** @tanstack/react-query 5.107.1, react-query-devtools 5.107.1(개발 모드만), vitest 2.1.9 + Testing Library + jsdom.

## 공통 규칙
- 작업 폴더 `/Users/kyuseok/Documents/private/projects/ivyro/work_space/wt-fe-p3`, 브랜치 `feature/fe-phase3-tanstack-query`.
- `web_client`·`admin_web` node_modules 는 작업 폴더에서 `npm ci` 로 독립 설치. 메인 폴더(`../stock_app`)에서 npm 명령 금지. mobile 은 건드리지 않는다.
- 금지: merge·push, env 읽기·수정, `git add -A`·`git add .`·`git stash`(목록 포함)·`git reset`·`git checkout --`·`rm -rf`, 실서버·외부 API 호출, Docker Desktop 켜기.
- 임시 파일은 `/Users/kyuseok/.claude/jobs/cfc9cd18/tmp/fe-p3/`. 띄운 서버는 끝날 때 끈다.
- **API 계약·화면 문구·배치는 바꾸지 않는다.** `api/*.ts` 함수는 그대로 쓰고 감싸기만 한다.
- 커밋 메시지 한국어, 끝 줄: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

### 작업 1: 기반 — 두 웹 공통 (TDD)
- [ ] 의존성: 각 앱에서 `npm ci && npm install --save-exact @tanstack/react-query@5.107.1 && npm install --save-exact -D @tanstack/react-query-devtools@5.107.1`. 두 앱 모두 jsdom·Testing Library 가 이미 있음(Phase 1·2).
- [ ] 실패하는 테스트 `src/lib/queryClient.test.ts`(두 앱):
```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { makeQueryClient, getQueryClient, shouldRetry } from './queryClient'

const httpErr = (status: number) => Object.assign(new Error(String(status)), { response: { status } })

describe('queryClient', () => {
  it('4xx 는 재시도하지 않는다', () => {
    for (const s of [400, 401, 403, 404, 409, 422]) expect(shouldRetry(0, httpErr(s))).toBe(false)
  })
  it('5xx·네트워크 오류는 1회만 재시도', () => {
    expect(shouldRetry(0, httpErr(503))).toBe(true)
    expect(shouldRetry(1, httpErr(503))).toBe(false)
    expect(shouldRetry(0, new Error('network'))).toBe(true)
  })
  it('기본값: 창 포커스 재조회 끔', () => {
    expect(makeQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
  it('브라우저에서는 싱글톤', () => {
    expect(getQueryClient()).toBe(getQueryClient())
  })
})
```
- [ ] 구현 `src/lib/queryClient.ts`(두 앱 같은 내용):
```ts
import { QueryClient } from '@tanstack/react-query'

// HTTP 상태 — axios 오류는 response.status, 그 밖(네트워크·시간 초과)은 undefined
function statusOf(err: unknown): number | undefined {
  const s = (err as { response?: { status?: unknown } } | null)?.response?.status
  return typeof s === 'number' ? s : undefined
}

/** 4xx(시세 비노출 403·404·검증 422 등)는 다시 물어도 같은 답이라 재시도하지 않는다. 5xx·네트워크는 1회. */
export function shouldRetry(failureCount: number, err: unknown): boolean {
  const s = statusOf(err)
  if (s !== undefined && s >= 400 && s < 500) return false
  return failureCount < 1
}

/** 요청마다 새 클라이언트 — SSR(서버)에서는 요청 간 캐시가 섞이지 않게 매번 새로 만든다. 401 은 axios 인터셉터가 처리한다. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  })
}

let browserClient: QueryClient | undefined

/** 서버(window 없음)는 매번 새로, 브라우저는 하나를 재사용 — 나중에 HydrationBoundary 를 붙일 때 그대로 쓴다. */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient()
  return (browserClient ??= makeQueryClient())
}
```
- [ ] `src/main.tsx` 에 Provider. devtools 는 개발 모드에서만 동적 import:
```tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { getQueryClient } from './lib/queryClient'
const Devtools = import.meta.env.DEV
  ? lazy(() => import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })))
  : null
// 기존 트리를 감싼다:
// <QueryClientProvider client={getQueryClient()}> …기존… {Devtools && <Suspense fallback={null}><Devtools initialIsOpen={false} /></Suspense>} </QueryClientProvider>
```
- [ ] 테스트 통과·`tsc` 통과 → 커밋 `feat: 웹·관리자 TanStack Query 기반 — makeQueryClient·getQueryClient(4xx 재시도 금지), Provider, 개발 모드 devtools`

### 작업 2: 시황 개요 A — `useMarketSection` 내부를 useQuery 로 (web_client)
- [ ] **먼저 지금 동작을 고정하는 테스트**(구현 바꾸기 전에 통과해야 함) `src/hooks/useMarketSection.test.tsx`(`// @vitest-environment jsdom`, `renderHook` + `QueryClientProvider` 래퍼 — 지금 구현은 Provider 가 없어도 동작하므로 래퍼를 둬도 통과):
  1. 첫 로딩 성공 → `data` 채워짐, `loading` false
  2. 첫 로딩 실패 → `failed` true, `reload()` 성공 → `failed` false
  3. `silentRefresh()` 실패 → 이전 `data` 유지, `failed` false
  4. `enabled=false` → fetcher 호출 0, `{data:null, loading:false, failed:false}`; `rerender` 로 true → 호출 1
  5. `keepCurrent` 가 true 를 주면 `silentRefresh` 뒤에도 이전 객체 그대로(`toBe`)
  6. `silentRefresh` 두 번 연달아(첫 요청 미완) → fetcher 추가 호출 1번만
  7. `silentRefresh` 는 `MARKET_REQUEST_TIMEOUT_MS` 를 인자로 넘긴다
  8. `fetchedAt` 이 실패 뒤에도 찍힌다(훅이 노출하는 방식 그대로 확인)
  9. 늦게 온 옛 응답: `reload()` 두 번 — 첫 응답이 늦게 도착해도 최종 `data` 는 두 번째 값
- [ ] 위 테스트가 **지금 코드에서 통과**하는지 확인하고 커밋 `test: 시황 섹션 훅 현재 동작 고정 테스트(전환 전)`.
- [ ] 내부를 `useQuery` 로 바꾼다(설계 1절 A 의 대응표대로). 반환 객체의 모양·이름은 그대로. fetcher→id 는 모듈 `WeakMap<Function, number>`.
- [ ] 같은 테스트가 그대로 통과(테스트는 고치지 않는다 — 고쳐야 한다면 동작이 바뀐 것이므로 멈추고 보고).
- [ ] `OverviewTab.tsx` 는 바꾸지 않는 것이 목표(바꿨다면 이유 보고).
- [ ] 커밋 `refactor: 시황 섹션 훅 내부를 TanStack Query 로(입출력·동작 그대로)`

### 작업 3: web_client B — 5개 화면
각 화면마다: ① 지금 화면의 로딩·성공·오류 표시를 확인하는 테스트(가짜 `api` 모듈 `vi.mock`)를 먼저 쓰고 지금 코드에서 통과 확인 → ② `src/queries/*.ts` 에 `queryOptions` 추가 → ③ 화면의 `useEffect+useState` 를 `useQuery` 로 → ④ 같은 테스트 통과.
- [ ] `queries/marketQueries.ts`(groups·calendar), `queries/screenerQueries.ts`(finder·patterns), `queries/blogQueries.ts`(posts) — 예:
```ts
import { queryOptions, keepPreviousData } from '@tanstack/react-query'
// import { getPosts } from '../api/blog' — 실제 함수 이름·인자는 기존 api 모듈 그대로
export const blogQueries = {
  posts: (boardId: number, page: number) =>
    queryOptions({ queryKey: ['blog', 'posts', boardId, page], queryFn: () => getPosts(boardId, page), placeholderData: keepPreviousData }),
}
```
- [ ] 대상: `pages/market/GroupTab.tsx`, `pages/market/CalendarTab.tsx`, `pages/screener/FinderTab.tsx`, `pages/screener/PatternsTab.tsx`, `pages/PostListPage.tsx`. 시세 비노출(`showMarket` 등)로 요청을 막던 조건은 `enabled` 로 그대로 옮긴다. 화면 문구·배치 변경 금지.
- [ ] 화면 하나씩 커밋 `refactor(web): <화면> 데이터 조회를 useQuery 로`

### 작업 4: admin_web B — 5개 화면
같은 방식. `queries/screenerQueries.ts` 에 leaders·maScreener·finder·patterns·dailySurge(목록·그룹·상세·날짜·뉴스). 급등락:
- [ ] 목록·그룹 쪽 넘김은 `keepPreviousData`.
- [ ] 메모 저장·삭제, 수동 집계는 `useMutation` + `invalidateQueries({ queryKey: ['screener', 'dailySurge'] })`. 기존 성공·실패 안내 문구·토스트 그대로.
- [ ] 화면별 테스트(로딩·성공·오류) + 급등락은 "메모 저장 뒤 목록 재조회" 테스트.
- [ ] 화면 하나씩 커밋 `refactor(admin): <화면> 데이터 조회를 useQuery 로`

### 작업 5: 검증·보고
- [ ] web_client: `npx tsc --noEmit && npm test && npm run lint` (새 위반 0 — 기존 StockDetailPage 1건은 그대로), 가짜 `VITE_*` 로 `npm run build`; `grep -c ReactQueryDevtools dist/assets/*.js` 합계 0.
- [ ] admin_web: `npx tsc --noEmit && npm test && npm run build`(가짜 `VITE_*`), devtools grep 0.
- [ ] 브라우저(가짜 API 서버 — Phase 1 의 `/Users/kyuseok/.claude/jobs/cfc9cd18/tmp/fe-p1/fake-api.mjs`·`fixtures.mjs` 를 복사해 확장 가능): 바뀐 화면마다 데이터 표시, 시황 개요 30초 갱신(가짜 서버 로그로 요청 간격 확인)·탭 숨김 시 멈춤, 쪽 넘김 깜빡임 없음, 콘솔 React 오류 없음.
- [ ] 보고: 앱별 검증 결과, 바꾼 파일, 커밋 목록, 계획과 다르게 한 점, 확신 없는 점.
