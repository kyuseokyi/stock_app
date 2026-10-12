# admin_web TypeScript(strict) 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `admin_web/src`의 JS/JSX 24개 파일을 `strict: true` TypeScript로 전환한다. 런타임 동작은 바뀌지 않아야 한다.

**Architecture:** 첫 태스크에서 `allowJs: true` + `strict: true` 기반을 깐다. 이후 하위 레이어(config/lib/store → api → hooks → components → pages → ChartSnapshotModal → main/App)부터 파일 단위로 `git mv` 후 타입을 붙인다. 마지막 태스크에서 `allowJs`를 제거한다. 모든 태스크는 `tsc --noEmit`와 `vite build`가 통과한 상태로 끝나야 한다.

**Tech Stack:** TypeScript 5.x, React 18, Vite 5, TailwindCSS 3, axios 1, zustand 4, react-router-dom 6, TipTap 2, echarts 5 / echarts-for-react 3, graphql-request 7

**Spec:** `docs/superpowers/specs/2026-10-12-admin-web-typescript-migration-design.md`

---

## 공통 규칙 (모든 태스크에 적용)

### 검증 명령 (모든 태스크의 종료 조건)
`vite.config.js`는 build 시 VITE_* 3개가 없으면 throw하고, `.env.production`도 없다. 그래서 더미 값을 인라인으로 넣는다.

```bash
cd admin_web
npx tsc --noEmit
VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x VITE_STOCK_API_URL=http://x npm run build
```
Expected: `tsc`는 출력 없이 exit 0, build는 `✓ built in ...`.

### 타입 정책
1. **로직 무변경.** 타입 표기, 타입 선언, `import type`, 타입 단언 외의 변경은 금지한다. strict 때문에 null 가드, 기본값, 분기, `isAxiosError` 같은 **런타임 코드**가 필요해지면 추가하지 말고 DONE_WITH_CONCERNS로 보고한다.
2. **허용되는 우회 수단**
   - non-null 단언 `!`: 런타임 동작이 같을 때만 쓰고, 같은 줄에 근거 주석을 단다.
   - `as`: 경계(axios/GraphQL 응답, `JSON.parse`, `CustomEvent.detail`, catch의 `err`, echarts/zrender API)와 이 플랜이 명시한 위치에서만 쓴다.
   - `@ts-expect-error`: 서드파티 타입 공백에만 쓰고 사유 주석을 단다. `@ts-ignore`는 금지한다.
   - 명시적 `any`는 금지한다.
3. **API 타입은 `src/types/`(백엔드 스키마 기반)의 것만 쓴다.** 새 타입이 필요하면 백엔드 스키마(`backend/apps/{blog,auth}/schemas.py`, `backend/apps/stock_api/graphql/types.py`)를 확인하고 `src/types/`에 추가한다.
4. **리네임은 반드시 `git mv`** 로 한다. 내용 수정은 그 다음에 한다.
5. **스테이징은 명시 경로만** 한다. `git add -A`와 `git add .`는 금지한다. 저장소에는 커밋하면 안 되는 미커밋 파일(`.claude/`, `.serena/project.yml`)이 있다.
6. 커밋은 `dev` 브랜치에 한다. 커밋 메시지 끝에는 아래 두 줄을 그대로 붙인다.
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
   ```
7. 이 환경에는 Write/Edit 직전에 검색(grep/ls)과 근거 진술을 요구하는 훅(GateGuard)이 있다. 차단되면 `ls`나 `grep`을 한 번 실행하고, "무엇을 대체하는지 / 어디서 참조되는지 / 사용자 지시"를 진술한 뒤 재시도한다.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `admin_web/package.json`, `package-lock.json` | typescript·@types 추가, build 스크립트 | 1 |
| `admin_web/tsconfig.json` | 컴파일 옵션(strict, allowJs 임시) | 1, 8 |
| `admin_web/tailwind.config.js` | content glob에 ts/tsx 추가 | 1 |
| `admin_web/src/vite-env.d.ts` | `import.meta.env` 타입 | 1 |
| `admin_web/src/types/api.ts` | blog/auth REST DTO 타입(pydantic 기준) | 1 |
| `admin_web/src/types/stock.ts` | stock_api GraphQL 응답 타입 | 1 |
| `src/config.ts`, `src/lib/toast.ts`, `src/store/ui.ts` | 설정/토스트/UI 스토어 | 2 |
| `src/api/{client,auth,boards,blogs,comments,stockClient}.ts` | API 계층 | 3 |
| `src/hooks/useChartDrawings.ts` | 드로잉 상태 + 도형 타입 | 4 |
| `src/components/{RequireAuth,Layout,Sidebar,NotificationToaster,RichTextEditor}.tsx` | 레이아웃·공통 UI | 5 |
| `src/pages/*.tsx` (7개) | 페이지 | 6 |
| `src/components/ChartSnapshotModal.tsx` | 차트 삽입 모달 | 7 |
| `src/main.tsx`, `src/App.tsx`, `index.html`, `tsconfig.json` | 진입점, allowJs 제거 | 8 |
| `README.md`, `docs/ROADMAP.md` | 문서 현행화 | 9 |

---

### Task 1: TS 기반 설정 (의존성·tsconfig·env 타입·Tailwind glob·DTO 타입)

**Files:**
- Modify: `admin_web/package.json`, `admin_web/package-lock.json` (npm이 갱신)
- Create: `admin_web/tsconfig.json`
- Modify: `admin_web/tailwind.config.js`
- Create: `admin_web/src/vite-env.d.ts`
- Create: `admin_web/src/types/api.ts`
- Create: `admin_web/src/types/stock.ts`

- [ ] **Step 1: 의존성 설치**

```bash
cd admin_web
npm install --save-dev typescript@~5.6.3 @types/react@^18.3.12 @types/react-dom@^18.3.1
```
Expected: `package.json`의 devDependencies에 3개가 추가되고 `package-lock.json`이 갱신된다.

- [ ] **Step 2: `tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "allowJs": true,
    "checkJs": false
  },
  "include": ["src"]
}
```
`allowJs`와 `checkJs`는 Task 8에서 제거한다. `noUnusedLocals`와 `noUnusedParameters`는 켜지 않는다. 켜면 기존 코드의 미사용 변수를 지우는 로직 변경을 강요하게 된다.

- [ ] **Step 3: `src/vite-env.d.ts` 작성**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_AUTH_BASE_URL?: string
  readonly VITE_STOCK_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 4: Tailwind content glob 확장**

`admin_web/tailwind.config.js`:
```js
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
```
(이전 값: `'./src/**/*.{js,jsx}'`. 이걸 빠뜨리면 `.tsx`로 바뀐 파일의 클래스가 모두 퍼지되어, 빌드는 성공하지만 화면이 무스타일이 된다.)

- [ ] **Step 5: `src/types/api.ts` 작성** (출처: `backend/apps/auth/schemas.py`, `backend/apps/blog/schemas.py`, `backend/shared/models.py`의 `UserRole`. datetime은 JSON에서 ISO 문자열로 온다.)

```ts
// 백엔드 pydantic 스키마와 1:1 대응하는 REST DTO 타입.
// 출처: backend/apps/auth/schemas.py, backend/apps/blog/schemas.py (datetime → ISO 문자열)

/** 경로 파라미터(useParams 문자열)와 숫자 id 를 모두 받는 식별자 */
export type Id = number | string

export type UserRole = 'FREE' | 'PREMIUM' | 'ADMIN'

// ---- auth ----
export interface UserOut {
  id: number
  email: string | null
  nickname: string | null
  role: UserRole
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user: UserOut
}

// ---- board ----
export interface BoardOut {
  id: number
  name: string
  order_index: number
  is_active: boolean
  comments_enabled: boolean
  min_role_required: UserRole
  created_at: string
  updated_at: string
}

export interface BoardCreate {
  name: string
  order_index?: number
  is_active?: boolean
  comments_enabled?: boolean
  min_role_required?: UserRole
}

export interface BoardUpdate {
  name?: string | null
  order_index?: number | null
  is_active?: boolean | null
  comments_enabled?: boolean | null
  min_role_required?: UserRole | null
}

// ---- blog ----
export interface BlogOut {
  id: number
  board_id: number
  title: string
  content: string
  thumbnail_url: string | null
  author_id: number | null
  view_count: number
  featured_at: string | null
  created_at: string
  updated_at: string
}

export interface BlogCreate {
  board_id: number
  title: string
  content: string
  thumbnail_url?: string | null
  author_id?: number | null
}

export interface BlogUpdate {
  board_id?: number | null
  title?: string | null
  content?: string | null
  thumbnail_url?: string | null
  featured?: boolean | null
}

export interface BlogListOut {
  total: number
  page: number
  size: number
  items: BlogOut[]
}

// ---- comment ----
export interface CommentOut {
  id: number
  post_id: number
  author_id: number | null
  author_name: string | null
  content: string
  created_at: string
  updated_at: string
}
```

- [ ] **Step 6: `src/types/stock.ts` 작성** (출처: `backend/apps/stock_api/graphql/types.py`. Strawberry가 필드명을 camelCase로 바꿔 내보낸다. `std_dev`는 `stdDev`가 된다.)

```ts
// stock_api GraphQL 응답 타입. 출처: backend/apps/stock_api/graphql/types.py
// Strawberry 기본 설정으로 snake_case 필드는 camelCase 로 노출된다.

export interface Stock {
  symbol: string
  name: string
  market: string // KOSPI/KOSDAQ/NASDAQ/NYSE/INDEX
  country: string // KR/US/GLOBAL
  currency: string // KRW/USD/PT
}

export interface Candle {
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface BollingerBand {
  period: number
  stdDev: number
  mid: (number | null)[]
  upper: (number | null)[]
  lower: (number | null)[]
}

export interface VolumeProfileBin {
  priceLow: number
  priceHigh: number
  volume: number
}

/** 정배열(PERFECT) / 역배열(REVERSE) / 혼조(MIXED) — 백엔드는 str 이지만 이 3값만 반환 */
export type MaOrder = 'PERFECT' | 'REVERSE' | 'MIXED'

export interface ChartData {
  symbol: string
  name: string
  market: string
  currency: string
  candles: Candle[]
  ma5: (number | null)[]
  ma20: (number | null)[]
  ma50: (number | null)[]
  ma120: (number | null)[]
  maOrder: MaOrder
  bollinger: BollingerBand
  volumeProfile: VolumeProfileBin[]
}
```

- [ ] **Step 7: build 스크립트에 타입 검사 추가**

`admin_web/package.json`의 `scripts.build`:
```json
    "build": "tsc --noEmit && vite build",
```

- [ ] **Step 8: 검증**

공통 검증 명령을 실행한다(`npx tsc --noEmit`, 더미 env `npm run build`). 이 시점에는 `.ts` 파일이 타입 정의뿐이고 JS는 `checkJs: false`라서 둘 다 통과해야 한다.

- [ ] **Step 9: 커밋**

```bash
cd ..   # 저장소 루트
git add admin_web/package.json admin_web/package-lock.json admin_web/tsconfig.json admin_web/tailwind.config.js admin_web/src/vite-env.d.ts admin_web/src/types/api.ts admin_web/src/types/stock.ts
git commit -m "chore(admin): TypeScript(strict) 기반 설정 — tsconfig·env 타입·DTO 타입·Tailwind ts glob

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: config · lib/toast · store/ui 전환

**Files:**
- Rename+Modify: `admin_web/src/config.js` → `config.ts`
- Rename+Modify: `admin_web/src/lib/toast.js` → `toast.ts`
- Rename+Modify: `admin_web/src/store/ui.js` → `ui.ts`

- [ ] **Step 1: 리네임**

```bash
cd admin_web
git mv src/config.js src/config.ts
git mv src/lib/toast.js src/lib/toast.ts
git mv src/store/ui.js src/store/ui.ts
```

- [ ] **Step 2: `config.ts` 타입 부여.** 주석은 그대로 두고, 아래 부분만 바꾼다.

```ts
type EnvKey = 'VITE_API_BASE_URL' | 'VITE_AUTH_BASE_URL' | 'VITE_STOCK_API_URL'

const DEV_FALLBACK: Record<EnvKey, string> = {
  VITE_API_BASE_URL: 'http://localhost:8000/api/v1', // blog(8000)
  VITE_AUTH_BASE_URL: 'http://localhost:8001/api/v1', // auth(8001)
  VITE_STOCK_API_URL: 'http://localhost:8002/graphql', // stock(8002)
}

function readEnv(name: EnvKey): string {
  const v = import.meta.env[name]
  if (v) return v
  if (import.meta.env.DEV) return DEV_FALLBACK[name] // vite dev(serve)에서만 폴백 허용
  throw new Error(
    `[config] ${name} 이(가) 빌드에 주입되지 않았습니다. ` +
      `docker build args(VITE_*) 또는 .env 를 확인하세요.`,
  )
}
```
`export const API_BASE_URL = readEnv('VITE_API_BASE_URL')` 등 export 3줄은 그대로 둔다.

- [ ] **Step 3: `toast.ts` 전체 내용**

```ts
// 클라이언트 토스트 — 전역 마운트된 NotificationToaster 가 window 이벤트로 수신해
// 우측 하단에 표시한다(별도 상태관리/라이브러리 없이 어디서든 호출 가능).
//   showToast('저장되었습니다')            // 기본(🔔)
//   showToast('이름을 입력하세요', { icon: '⚠️' })

/** 'app:toast' CustomEvent 의 detail 형태(NotificationToaster 가 수신) */
export interface ToastDetail {
  text: string
  icon: string
}

export function showToast(text: string, { icon = '🔔' }: { icon?: string } = {}): void {
  if (!text) return
  window.dispatchEvent(
    new CustomEvent<ToastDetail>('app:toast', { detail: { text, icon } }),
  )
}
```

- [ ] **Step 4: `ui.ts` 전체 내용**

```ts
import { create } from 'zustand'

interface UiState {
  sidebarOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
  toggleSidebar: () => void
}

// 전역 UI 상태 (모바일 사이드바 드로어 토글)
export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
```
(`create<UiState>()(...)`는 zustand v4 TS의 권장 커리 형태이고, 런타임에서는 `create(...)`와 같다.)

- [ ] **Step 5: 검증.** 공통 검증 명령을 실행한다.

- [ ] **Step 6: 커밋**

```bash
cd ..
git add admin_web/src/config.ts admin_web/src/lib/toast.ts admin_web/src/store/ui.ts
git commit -m "refactor(admin): config·toast·ui 스토어 TS 전환

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```
(`git mv`로 원본 `.js` 삭제는 이미 스테이징됐다. 커밋 전에 `git status`에서 `renamed:`로 보이는지 확인한다.)

---

### Task 3: api 계층 6개 전환

**Files:**
- Rename+Modify: `admin_web/src/api/{client,auth,boards,blogs,comments,stockClient}.js` → `.ts`

- [ ] **Step 1: 리네임**

```bash
cd admin_web
for f in client auth boards blogs comments stockClient; do git mv src/api/$f.js src/api/$f.ts; done
```

- [ ] **Step 2: `client.ts`.** 아래 3곳만 바꾼다. 나머지 코드와 주석은 그대로 둔다.

```ts
import axios, { type AxiosError, type AxiosInstance } from 'axios'
```
```ts
function makeClient(baseURL: string): AxiosInstance {
```
```ts
    (error: AxiosError) => {
```
(axios의 onRejected 파라미터 타입은 `any`이므로, 이렇게 표기만 해도 런타임은 바뀌지 않는다. `axios.isAxiosError` 가드는 **추가하지 않는다**. 로직이 바뀌기 때문이다.)

- [ ] **Step 3: `auth.ts` 전체 내용**

```ts
import { authClient } from './client'
import type { TokenResponse, UserOut } from '../types/api'

// 인증 API + 로컬 토큰/유저 저장 관리 (인증 서비스 호출)
export const login = async (email: string, password: string): Promise<TokenResponse> => {
  const { data } = await authClient.post<TokenResponse>('/auth/login', { email, password })
  localStorage.setItem('token', data.access_token)
  localStorage.setItem('user', JSON.stringify(data.user))
  return data
}

export const logout = (): void => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export const getToken = (): string | null => localStorage.getItem('token')

export const getUser = (): UserOut | null => {
  const raw = localStorage.getItem('user')
  return raw ? (JSON.parse(raw) as UserOut) : null
}
```

- [ ] **Step 4: `boards.ts` 전체 내용**

```ts
import client from './client'
import type { BoardCreate, BoardOut, BoardUpdate, Id } from '../types/api'

// 게시판(boards) API 모듈
export const listBoards = async (): Promise<BoardOut[]> => {
  const { data } = await client.get<BoardOut[]>('/boards')
  return data
}

export const createBoard = async (payload: BoardCreate): Promise<BoardOut> => {
  const { data } = await client.post<BoardOut>('/boards', payload)
  return data
}

export const updateBoard = async (id: Id, payload: BoardUpdate): Promise<BoardOut> => {
  const { data } = await client.put<BoardOut>(`/boards/${id}`, payload)
  return data
}

export const deleteBoard = async (id: Id): Promise<void> => {
  await client.delete(`/boards/${id}`)
}
```

- [ ] **Step 5: `blogs.ts` 전체 내용**

```ts
import client from './client'
import type { BlogCreate, BlogListOut, BlogOut, BlogUpdate, Id } from '../types/api'

export interface ListBlogsParams {
  boardId?: number
  page?: number
  size?: number
}

// 블로그 게시글(blogs) API 모듈
export const listBlogs = async (
  { boardId, page = 1, size = 20 }: ListBlogsParams = {},
): Promise<BlogListOut> => {
  const params: Record<string, number> = { page, size }
  if (boardId != null) params.board_id = boardId
  const { data } = await client.get<BlogListOut>('/blogs', { params })
  return data // { total, page, size, items }
}

export const getBlog = async (id: Id): Promise<BlogOut> => {
  const { data } = await client.get<BlogOut>(`/blogs/${id}`)
  return data
}

export const createBlog = async (payload: BlogCreate): Promise<BlogOut> => {
  const { data } = await client.post<BlogOut>('/blogs', payload)
  return data
}

export const updateBlog = async (id: Id, payload: BlogUpdate): Promise<BlogOut> => {
  const { data } = await client.put<BlogOut>(`/blogs/${id}`, payload)
  return data
}

export const deleteBlog = async (id: Id): Promise<void> => {
  await client.delete(`/blogs/${id}`)
}
```

- [ ] **Step 6: `comments.ts` 전체 내용**

```ts
import client from './client'
import type { CommentOut, Id } from '../types/api'

// 댓글(comments) API 모듈
export const listComments = async (blogId: Id): Promise<CommentOut[]> => {
  const { data } = await client.get<CommentOut[]>(`/blogs/${blogId}/comments`)
  return data // CommentOut[]
}

export const createComment = async (blogId: Id, content: string): Promise<CommentOut> => {
  const { data } = await client.post<CommentOut>(`/blogs/${blogId}/comments`, { content })
  return data
}

export const updateComment = async (commentId: Id, content: string): Promise<CommentOut> => {
  const { data } = await client.put<CommentOut>(`/comments/${commentId}`, { content })
  return data
}

export const deleteComment = async (commentId: Id): Promise<void> => {
  await client.delete(`/comments/${commentId}`)
}
```

- [ ] **Step 7: `stockClient.ts`.** gql 문서 상수는 그대로 두고, 상단 import와 하단 함수 두 개만 바꾼다.

```ts
import { GraphQLClient, gql } from 'graphql-request'
import { STOCK_API_URL } from '../config'
import type { ChartData, Stock } from '../types/stock'
```
```ts
export async function searchStocks(query: string): Promise<Stock[]> {
  const data = await client.request<{ searchStocks: Stock[] }>(SEARCH_STOCKS, { query })
  return data.searchStocks
}

export async function getChartData(
  symbol: string,
  startDate: string,
  endDate: string,
  bbStdDev = 2.0,
): Promise<ChartData> {
  const data = await client.request<{ getChartData: ChartData }>(GET_CHART_DATA, {
    symbol,
    startDate,
    endDate,
    bbStdDev,
  })
  return data.getChartData
}
```

- [ ] **Step 8: 검증.** 공통 검증 명령을 실행한다. 아직 `.jsx`인 페이지들이 이 함수를 호출하지만 `checkJs: false`이므로 통과한다.

- [ ] **Step 9: 커밋**

```bash
cd ..
git add admin_web/src/api/client.ts admin_web/src/api/auth.ts admin_web/src/api/boards.ts admin_web/src/api/blogs.ts admin_web/src/api/comments.ts admin_web/src/api/stockClient.ts
git commit -m "refactor(admin): api 계층 TS 전환 — 백엔드 스키마 기반 DTO 타입 적용

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: hooks/useChartDrawings 전환 (도형 타입 정의)

**Files:**
- Rename+Modify: `admin_web/src/hooks/useChartDrawings.js` → `.ts`

도형 종류는 `ChartSnapshotModal.jsx`의 `addShape` 호출 4곳(`hline`·`rect`·`text`·`channel`)과 `makeChannel`의 반환 필드에서 확인한 것이다. `updateShape`의 실제 호출은 채널 선 이동(`ux1..uy2` 또는 `lx1..ly2` 패치) 하나뿐이다.

- [ ] **Step 1: 리네임** `cd admin_web && git mv src/hooks/useChartDrawings.js src/hooks/useChartDrawings.ts`

- [ ] **Step 2: 전체 내용**

```ts
import { useCallback, useState } from 'react'

// 도형 id 시퀀스 (모듈 단위, 렌더 간 안정)
let _seq = 0
const nextId = () => `d${++_seq}`

/** 드로잉 도구. null = 도구 해제 */
export type DrawingTool = 'hline' | 'rect' | 'text' | 'channel'

export interface HLineShape {
  type: 'hline'
  price: number
}
export interface RectShape {
  type: 'rect'
  xi1: number
  y1: number
  xi2: number
  y2: number
}
export interface TextShape {
  type: 'text'
  xi: number
  price: number
  text: string
}
/** 평행 채널 — 상단선(u*)/하단선(l*) 두 선의 끝점(x=카테고리 인덱스, y=가격) */
export interface ChannelShape {
  type: 'channel'
  ux1: number
  uy1: number
  ux2: number
  uy2: number
  lx1: number
  ly1: number
  lx2: number
  ly2: number
}

/** addShape 입력(id 없음) */
export type ShapeInput = HLineShape | RectShape | TextShape | ChannelShape
/** 저장된 도형(id 부여됨) */
export type Shape = ShapeInput & { id: string }
/** updateShape 패치 — 현재 유일한 사용처는 채널 선 이동 */
export type ShapePatch = Partial<Omit<ChannelShape, 'type'>>

/**
 * 차트 드로잉 상태 훅.
 * 도형은 데이터 좌표(xi=카테고리 인덱스, price=가격)로 저장해 리렌더/캡처 정합성을 유지한다.
 * ECharts에 독립적이므로 향후 web_client/mobile에서 재사용 가능.
 *
 * shape 형태:
 *   { id, type:'hline', price }
 *   { id, type:'rect',  xi1, y1, xi2, y2 }
 *   { id, type:'text',  xi, price, text }
 *   { id, type:'channel', ux1, uy1, ux2, uy2, lx1, ly1, lx2, ly2 }
 */
export function useChartDrawings() {
  const [tool, setTool] = useState<DrawingTool | null>(null)
  const [shapes, setShapes] = useState<Shape[]>([])

  // 생성한 도형(id 포함)을 반환 → 호출측에서 마지막 도형 추적 가능
  const addShape = useCallback((s: ShapeInput): Shape => {
    const shape: Shape = { id: nextId(), ...s }
    setShapes((prev) => [...prev, shape])
    return shape
  }, [])
  const removeShape = useCallback(
    (id: string) => setShapes((prev) => prev.filter((s) => s.id !== id)),
    [],
  )
  const updateShape = useCallback(
    (id: string, patch: ShapePatch) =>
      setShapes((prev) =>
        // 패치는 type 을 바꾸지 않으므로 판별자는 유지된다(TS 가 유니온 스프레드를 증명하지 못해 단언).
        prev.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)),
      ),
    [],
  )
  const clearAll = useCallback(() => setShapes([]), [])

  // 같은 도구 재클릭 시 해제(토글)
  const toggleTool = useCallback(
    (t: DrawingTool) => setTool((prev) => (prev === t ? null : t)),
    [],
  )

  return {
    tool,
    setTool,
    toggleTool,
    shapes,
    addShape,
    removeShape,
    updateShape,
    clearAll,
  }
}
```
(`as Shape` 한 곳은 이 플랜이 명시적으로 허용한 내부 단언이다. 주석의 도형 목록은 3종에서 실제로 쓰이는 channel까지 포함한 4종으로 바로잡았다. 동작 변화는 없다.)

- [ ] **Step 3: 검증.** 공통 검증 명령을 실행한다.

- [ ] **Step 4: 커밋**

```bash
cd ..
git add admin_web/src/hooks/useChartDrawings.ts
git commit -m "refactor(admin): useChartDrawings TS 전환 — 도형 판별 유니온 타입

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 소형 컴포넌트 5개 전환

**Files:**
- Rename+Modify: `admin_web/src/components/{RequireAuth,Layout,Sidebar,NotificationToaster,RichTextEditor}.jsx` → `.tsx`

- [ ] **Step 1: 리네임**

```bash
cd admin_web
for f in RequireAuth Layout Sidebar NotificationToaster RichTextEditor; do git mv src/components/$f.jsx src/components/$f.tsx; done
```

- [ ] **Step 2: `RequireAuth.tsx` 전체 내용**

```tsx
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getToken } from '../api/auth'

// 토큰이 없으면 로그인 화면으로 리다이렉트하는 라우트 가드
export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }
  return <>{children}</>
}
```
⚠️ `return children`을 `return <>{children}</>`로 바꾸는 이유가 있다. `@types/react` 18에서 JSX 요소로 쓰이는 컴포넌트는 `ReactNode`가 아니라 `JSX.Element | null`을 반환해야 한다. Fragment로 감싸도 렌더 결과(DOM)는 같다. **이 한 곳은 플랜이 허용한 무해 변경**이다.

- [ ] **Step 3: `Layout.tsx`.** 타입 변경이 필요 없을 가능성이 높다. `getUser()`가 이미 `UserOut | null`을 반환한다. 리네임만 하고 `tsc`로 확인한다. 에러가 나면 타입 표기로만 해결한다.

- [ ] **Step 4: `Sidebar.tsx`.** import 아래에 타입을 추가하고, 두 곳을 바꾼다.

```tsx
interface NavItem {
  to: string
  label: string
  icon: string
}
interface NavGroup {
  title: string
  items: NavItem[]
}

// 사이드바 메뉴 정의 (그룹 → 항목)
const NAV_GROUPS: NavGroup[] = [
```
```tsx
const linkClass = ({ isActive }: { isActive: boolean }) =>
```
(나머지는 그대로 둔다.)

- [ ] **Step 5: `NotificationToaster.tsx`**

import 아래 추가:
```tsx
import type { ToastDetail } from '../lib/toast'

interface Toast {
  id: string
  text: string
  icon: string
}
```
바꿀 곳:
```tsx
  const [toasts, setToasts] = useState<Toast[]>([])
```
```tsx
    const onNotification = (e: MessageEvent<string>) => {
      let payload: { type?: string; title?: string } = {}
      try {
        payload = JSON.parse(e.data) as { type?: string; title?: string }
      } catch {
        return
      }
```
```tsx
    const onToast = (e: Event) => {
      const { text, icon = '🔔' } = (e as CustomEvent<Partial<ToastDetail>>).detail || {}
```
```tsx
  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id))
```
`es.addEventListener('notification', onNotification)`에서 타입 에러가 나면 원인은 커스텀 이벤트명(`EventSourceEventMap`에 없음)이다. 이 경우 등록부와 해제부를 `onNotification as EventListener`로 바꾼다(EventSource 경계 단언이므로 허용).

- [ ] **Step 6: `RichTextEditor.tsx`**

import에 추가:
```tsx
import type { Editor } from '@tiptap/react'
```
바꿀 곳:
```tsx
const btn = (active: boolean) =>
```
```tsx
function Toolbar({ editor, onChartClick }: { editor: Editor | null; onChartClick: () => void }) {
```
```tsx
    const prev = editor.getAttributes('link').href as string | undefined
```
```tsx
interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
}

export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
```
```tsx
  const insertChart = (dataURL: string) => {
```
`ChartSnapshotModal`은 아직 `.jsx`(Task 7에서 전환)이므로 `lazy(() => import('./ChartSnapshotModal'))`의 props는 JS에서 추론된다. 에러가 나도 **임시 우회를 넣지 말고** 에러 내용을 보고한다(`allowJs`에서는 보통 에러가 나지 않는다).

- [ ] **Step 7: 검증.** 공통 검증 명령을 실행한다.

- [ ] **Step 8: 커밋**

```bash
cd ..
git add admin_web/src/components/RequireAuth.tsx admin_web/src/components/Layout.tsx admin_web/src/components/Sidebar.tsx admin_web/src/components/NotificationToaster.tsx admin_web/src/components/RichTextEditor.tsx
git commit -m "refactor(admin): 레이아웃·사이드바·토스터·에디터 컴포넌트 TS 전환

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 페이지 7개 전환

**Files:**
- Rename+Modify: `admin_web/src/pages/{LoginPage,BoardsPage,BlogListPage,BlogDetailPage,BlogEditorPage,MembersPage,StatsPage}.jsx` → `.tsx`

- [ ] **Step 1: 리네임**

```bash
cd admin_web
for f in LoginPage BoardsPage BlogListPage BlogDetailPage BlogEditorPage MembersPage StatsPage; do git mv src/pages/$f.jsx src/pages/$f.tsx; done
```

- [ ] **Step 2: `MembersPage.tsx`, `StatsPage.tsx`.** 정적 마크업뿐이라 리네임만 한다.

- [ ] **Step 3: `LoginPage.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { login } from '../api/auth'
```
```tsx
  const from =
    (location.state as { from?: Location } | null)?.from?.pathname || '/boards'
```
```tsx
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
```
```tsx
    } catch (caught) {
      const err = caught as AxiosError
      if (!err.response) {
```
(catch 변수명을 `caught`로 바꾸고 바로 `err`에 단언한다. 이후 `err.response...` 코드는 그대로 둔다. 런타임은 같다.)

- [ ] **Step 4: `BoardsPage.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import type { BoardOut } from '../types/api'
```
```tsx
  const [boards, setBoards] = useState<BoardOut[]>([])
```
```tsx
  const onCreate = async (e: FormEvent<HTMLFormElement>) => {
```
```tsx
  const onDelete = async (id: number) => {
```
```tsx
  const onToggleComments = async (board: BoardOut) => {
```
`catch (e)`의 `e`는 사용하지 않으므로 그대로 둔다.

- [ ] **Step 5: `BlogListPage.tsx`**

```tsx
import type { BlogListOut, BlogOut, BoardOut } from '../types/api'
```
```tsx
  const [boards, setBoards] = useState<BoardOut[]>([])
  const [boardId, setBoardId] = useState('')
  const [data, setData] = useState<BlogListOut>({ total: 0, items: [], page: 1, size: PAGE_SIZE })
```
```tsx
  const onDelete = async (id: number) => {
```
```tsx
  const onToggleFeatured = async (post: BlogOut) => {
```
JSX 인라인 핸들러(`onChange={(e) => ...}`)는 타입이 추론되므로 표기가 필요 없다. 별도로 선언된 핸들러에 암묵적 any 에러가 나면, 해당 React 이벤트 타입(`ChangeEvent<HTMLSelectElement>` 등)만 표기한다.

- [ ] **Step 6: `BlogDetailPage.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import type { BlogOut, CommentOut } from '../types/api'
```
```tsx
  const [post, setPost] = useState<BlogOut | null>(null)
```
```tsx
  const [comments, setComments] = useState<CommentOut[]>([])
```
`useParams()`의 `id`는 `string | undefined`다. 이 페이지는 `/blogs/:id` 라우트에서만 렌더되므로 `id`가 항상 존재한다. 호출부 `getBlog(id)`, `listComments(id)`, `createComment(id, ...)`를 `id!`로 바꾸고, 첫 사용처에 주석을 단다.
```tsx
        // /blogs/:id 라우트 전용 페이지 → id 는 항상 존재
        const p = await getBlog(id!)
```
```tsx
  const onAddComment = async (e: FormEvent<HTMLFormElement>) => {
```
```tsx
  const onDeleteComment = async (commentId: number) => {
```

- [ ] **Step 7: `BlogEditorPage.tsx`**

```tsx
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { BoardOut } from '../types/api'
```
컴포넌트 위:
```tsx
interface BlogForm {
  board_id: number | string // select 값('')·로드된 게시글(number) 모두 수용
  title: string
  content: string
}
```
바꿀 곳:
```tsx
  const [boards, setBoards] = useState<BoardOut[]>([])
  const [form, setForm] = useState<BlogForm>({ board_id: '', title: '', content: '' })
```
```tsx
  const setField =
    (k: keyof BlogForm) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))
```
```tsx
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
```
`id`는 `isEdit`가 true일 때만 쓰인다(`getBlog(id)`, `updateBlog(id, payload)`). 두 곳을 `id!`로 바꾸고, 첫 곳에 주석 `// isEdit === Boolean(id) 이므로 이 분기에서 id 는 존재`를 단다. `onSubmit` 안의 `return showToast(...)` 패턴은 `void`를 반환하므로 그대로 둔다.

- [ ] **Step 8: 검증.** 공통 검증 명령을 실행한다.

- [ ] **Step 9: 커밋**

```bash
cd ..
git add admin_web/src/pages/LoginPage.tsx admin_web/src/pages/BoardsPage.tsx admin_web/src/pages/BlogListPage.tsx admin_web/src/pages/BlogDetailPage.tsx admin_web/src/pages/BlogEditorPage.tsx admin_web/src/pages/MembersPage.tsx admin_web/src/pages/StatsPage.tsx
git commit -m "refactor(admin): 페이지 7개 TS 전환

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: ChartSnapshotModal 전환 (897줄 단독)

**Files:**
- Rename+Modify: `admin_web/src/components/ChartSnapshotModal.jsx` → `.tsx`

이 파일에는 echarts 옵션 빌더(순수 함수), zrender 마우스 이벤트, `convertFromPixel`/`convertToPixel` 좌표 변환, 다수의 ref가 몰려 있다. **로직 무변경 원칙이 가장 중요한 태스크**다. 타입 표기만 하고, 계산식·분기·이벤트 바인딩 순서는 그대로 둔다. 원칙: **타입을 코드에 맞춘다. 코드를 타입에 맞추지 않는다.**

- [ ] **Step 1: 리네임** `cd admin_web && git mv src/components/ChartSnapshotModal.jsx src/components/ChartSnapshotModal.tsx`

- [ ] **Step 2: import 추가** (실제로 쓰는 것만 남긴다)

```tsx
import type { ECharts, EChartsOption } from 'echarts'
import type { ChartData, Stock, VolumeProfileBin } from '../types/stock'
import type {
  ChannelShape,
  DrawingTool,
  HLineShape,
  RectShape,
  Shape,
  TextShape,
} from '../hooks/useChartDrawings'
```

- [ ] **Step 3: 파일 내부 보조 타입** (모듈 상단, 상수 정의 전)

```tsx
/** 데이터 좌표 점 (xi=카테고리 인덱스, price=가격) */
interface DataPoint {
  xi: number
  price: number
}
/** 채널 좌표(makeChannel 반환) */
type ChannelCoords = Omit<ChannelShape, 'type'>
/** 텍스트 입력 오버레이 위치 */
interface TextInputState {
  px: number
  py: number
  xi: number
  price: number
}
interface ChartSnapshotModalProps {
  open: boolean
  onClose: () => void
  onInsert: (dataURL: string) => void
}
```
사각형 미리보기(`preview`) 타입은 `setPreview(...)`에 실제로 넘기는 객체 형태를 grep으로 확인해 정의한다(`RectShape`와 같은 좌표 필드면 `type RectPreview = Omit<RectShape, 'type'>`, `type` 필드가 포함되면 `RectShape`).

- [ ] **Step 4: 모듈 수준 함수 시그니처**

| 함수 | 시그니처 |
|---|---|
| `clampIdx` | `(i: number, len: number): number` |
| `buildMarks` | `(chart: ChartData, shapes: Shape[], preview: RectPreview \| null)` (반환 타입은 추론) |
| `defaultRange` | 실제 반환 객체 형태를 표기(예: `(): { start: string; end: string }`) |
| `MARKET_BADGE`, `MA_ORDER_BADGE` | 실제 값 형태 기준 `Record<string, …>` |
| `volumeProfileSeries` | `(vp: VolumeProfileBin[])` |
| `makeChannel` | `(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): ChannelCoords` |
| `computeChannelLines` | `(ch: ChannelCoords, dates: string[])` (반환 타입은 추론) |
| `channelSeries` | `(chart: ChartData, channels: ChannelShape[], previewChannel: ChannelCoords \| null)` (`channels`에 id 포함 도형이 들어오면 `(ChannelShape & { id: string })[]`) |
| `buildOption` | `(chart: ChartData, shapes: Shape[] = [], preview: RectPreview \| null = null, channelPreview: ChannelCoords \| null = null, showVP = true, showTooltip = false, editable = false)` |

- `shapes.filter((s) => s.type === 'hline')` 같은 필터는 TS가 좁혀 주지 않는다. 그 뒤 필드 접근에서 에러가 나면 **타입 가드 필터**로 바꾼다. 조건식이 같으므로 런타임도 같다.
  ```tsx
  const hlines = shapes.filter((s): s is HLineShape & { id: string } => s.type === 'hline')
  ```
- echarts 시리즈/옵션 객체 리터럴은 echarts의 엄격한 유니온 때문에 `EChartsOption`에 할당되지 않을 수 있다. 그래서 `buildOption`의 반환 타입을 강제하지 말고 추론에 맡긴다. 그래도 `<ReactECharts option={option} />`에서 막히면, **그 한 지점에서만** 사유 주석과 함께 `as EChartsOption` 경계 단언을 쓴다.
- custom series의 `renderItem(params, api)`는 `import type { CustomSeriesRenderItemParams, CustomSeriesRenderItemAPI } from 'echarts'`로 표기한다. 반환 객체가 타입과 맞지 않으면 그 반환식에만 경계 단언을 쓴다.
- 포매터 콜백(`formatter: (v) => ...`)의 파라미터는 실제 사용 형태에 맞춰 `number`나 echarts 콜백 타입으로 표기한다.

- [ ] **Step 5: 컴포넌트 props·state·ref 타입**

```tsx
export default function ChartSnapshotModal({ open, onClose, onInsert }: ChartSnapshotModalProps) {
  const chartRef = useRef<ReactECharts | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [selected, setSelected] = useState<Stock | null>(null)
  const [range, setRange] = useState(defaultRange)
  const [bbStdDev, setBbStdDev] = useState(2.0)
  // showVP / showTooltip / searching / loading / error 는 리터럴에서 추론
  const [chart, setChart] = useState<ChartData | null>(null)
  const [preview, setPreview] = useState<RectPreview | null>(null)
  const [channelPreview, setChannelPreview] = useState<ChannelCoords | null>(null)
  const [textInput, setTextInput] = useState<TextInputState | null>(null)
  const toolRef = useRef(tool)
  const dragStartRef = useRef<DataPoint | null>(null)
  const chPtsRef = useRef<DataPoint[]>([])
  const candlesRef = useRef<ChartData['candles']>([])
  const shapesRef = useRef<Shape[]>([])
  const editDragRef = useRef<EditDragState | null>(null)
  const suppressClickRef = useRef(false)
```
- `EditDragState`는 `editDragRef.current = { ... }`로 할당되는 **실제 객체의 키**를 grep으로 확인해 인터페이스로 정의한다. 현재 사용 키는 `id`, `line`, `cxi`, `cprice`, `x1`, `x2`, `y1`, `y2`이고, `line`은 `'upper' | 'lower'`다.
- `ReactECharts`는 클래스 컴포넌트 기본 export라서 `useRef<ReactECharts | null>`로 쓸 수 있다. `getEchartsInstance()`는 `ECharts`를 반환한다.
- `range`의 실제 형태는 `defaultRange` 반환값을 따른다.

- [ ] **Step 6: zrender 이벤트·좌표 변환**

- `inst.getZr().on('click' | 'mousedown' | 'mousemove' | 'mouseup', (e) => ...)`의 `e`는 코드가 쓰는 필드만 구조 타입으로 표기한다: `(e: { offsetX: number; offsetY: number })`. 코드가 그 밖의 필드를 쓰면 그 필드도 추가한다.
- `inst.convertFromPixel({ gridIndex: 0 }, [px, py])`와 `convertToPixel(...)`은 `number | number[]`를 반환한다. 코드가 `p[0]`, `p[1]`로 접근하면 `as number[]` 경계 단언을 쓴다.
- `toData(e)` 같은 내부 헬퍼는 반환 타입을 `DataPoint | null`로 표기한다(실제 반환 형태 기준).

- [ ] **Step 7: 이벤트 핸들러·기타**

- JSX 인라인 핸들러는 추론되므로 그대로 둔다. 별도로 선언된 핸들러는 React 이벤트 타입(`ChangeEvent<HTMLInputElement>`, `KeyboardEvent<HTMLInputElement>`, `FormEvent<HTMLFormElement>`)을 표기한다.
- `window`/`document`의 `keydown`(ESC 취소) 리스너 파라미터는 DOM `KeyboardEvent`다. React의 `KeyboardEvent`와 이름이 겹치면 React 쪽을 `type KeyboardEvent as ReactKeyboardEvent`로 별칭한다.
- 툴바 버튼 배열(`toggleTool(b.key)`)의 `key`는 `DrawingTool`이어야 한다. 배열을 `{ key: DrawingTool; label: string; ... }[]`로 표기한다(실제 필드 기준).
- `getDataURL({ type: 'png', ... })`의 결과는 `string`이다.

- [ ] **Step 8: 검증 + 우회 수단 집계.** 공통 검증 명령을 실행한 뒤 아래 결과를 보고서에 포함한다.

```bash
cd admin_web
grep -c " as " src/components/ChartSnapshotModal.tsx
grep -n "@ts-expect-error\|@ts-ignore\|: any\b\|<any>\|as any" src/components/ChartSnapshotModal.tsx
```
Expected: `@ts-ignore`와 `any`는 0건이다. `as`는 echarts/zrender 경계와 유니온 위치에서만 쓰였고, 각각 사유를 설명할 수 있어야 한다.

- [ ] **Step 9: 로직 무변경 자가 점검.** `git diff -M --cached --stat`과 `git diff -M HEAD -- src/components/ChartSnapshotModal.tsx`를 확인한다. 추가·삭제된 줄이 **타입 표기/타입 선언/import/주석**과 허용된 타입 가드 필터 변환뿐인지 본다. 그 밖의 변경이 있으면 보고서에 나열한다.

- [ ] **Step 10: 커밋**

```bash
cd ..
git add admin_web/src/components/ChartSnapshotModal.tsx
git commit -m "refactor(admin): ChartSnapshotModal TS 전환 — echarts/zrender 경계 타입

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 8: 진입점 전환 + `allowJs` 제거

**Files:**
- Rename+Modify: `admin_web/src/main.jsx` → `main.tsx`, `admin_web/src/App.jsx` → `App.tsx`
- Modify: `admin_web/index.html` (스크립트 경로)
- Modify: `admin_web/tsconfig.json` (`allowJs`/`checkJs` 제거)

- [ ] **Step 1: 리네임**

```bash
cd admin_web
git mv src/main.jsx src/main.tsx
git mv src/App.jsx src/App.tsx
```

- [ ] **Step 2: `main.tsx`.** `getElementById` 줄만 바꾼다.

```tsx
// index.html 에 #root 가 항상 존재
ReactDOM.createRoot(document.getElementById('root')!).render(
```

- [ ] **Step 3: `App.tsx`.** 리네임만 한다. 라우트 구성은 바꾸지 않는다.

- [ ] **Step 4: `index.html`**

```html
    <script type="module" src="/src/main.tsx"></script>
```
(이전 값: `/src/main.jsx`)

- [ ] **Step 5: `tsconfig.json`에서 `"allowJs": true,`와 `"checkJs": false`를 삭제한다.** 이때 직전 줄 `"skipLibCheck": true,` 끝의 쉼표를 지워 JSON을 유효하게 만든다. 결과:

```json
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  },
```

- [ ] **Step 6: 잔여 JS 확인**

```bash
find src \( -name "*.js" -o -name "*.jsx" \)
```
Expected: 출력 없음.

- [ ] **Step 7: 검증.** 공통 검증 명령을 실행한다. 이제 모든 파일이 strict로 검사된다.

- [ ] **Step 8: dev 서버 기동 확인**

```bash
(npm run dev -- --port 5174 --strictPort > /tmp/admin-dev.log 2>&1 &) ; sleep 5
curl -s http://localhost:5174/ | grep -o 'src="/src/main.tsx"'
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5174/src/main.tsx
pkill -f "vite.*5174"
```
Expected: `src="/src/main.tsx"`가 출력되고 `200`이 나온다(5174는 사용자의 5173 dev 서버와 겹치지 않게 하려는 것이다).

- [ ] **Step 9: 커밋**

```bash
cd ..
git add admin_web/src/main.tsx admin_web/src/App.tsx admin_web/index.html admin_web/tsconfig.json
git commit -m "refactor(admin): 진입점 TS 전환 + allowJs 제거 — admin_web 전체 strict TS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 9: 문서 현행화 + 클린 빌드 + 브라우저 스모크 (컨트롤러 수행)

**Files:**
- Modify: `README.md` (admin_web 섹션)
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: README.** admin_web 실행 섹션에 아래 내용을 추가한다(기존 문단 구조를 유지하고 해당 위치에 삽입).

```markdown
- admin_web 은 **TypeScript(strict)** 다. `npm run build` = `tsc --noEmit && vite build` 이므로 타입 에러가 있으면 빌드(및 Docker 배포 빌드)가 실패한다. 타입만 확인하려면 `npx tsc --noEmit`.
- API 응답 타입은 `admin_web/src/types/`(백엔드 pydantic·GraphQL 스키마 기준)에 있다. 백엔드 응답 스키마를 바꾸면 여기도 함께 갱신한다.
```

- [ ] **Step 2: ROADMAP.**
  - "### 블로그 (백엔드 + 어드민)" 아래에 `- [x] **admin_web TypeScript(strict) 전환** — 24개 파일, 백엔드 스키마 기반 DTO 타입(`src/types/`), build에 tsc 포함`을 추가한다.
  - "### 상시 백로그"에 `- [ ] web_client TypeScript 전환 (서브페이즈 6 직전, admin_web과 동일 방식)`을 추가한다.
  - 상단 "최종 업데이트" 날짜를 유지하거나 갱신한다.

- [ ] **Step 3: 클린 빌드(배포 조건 재현)**

```bash
cd admin_web
rm -rf node_modules dist
npm ci
npx tsc --noEmit
VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x VITE_STOCK_API_URL=http://x npm run build
```
Expected: 모두 성공한다(lockfile과 package.json이 일치해야 `npm ci`가 통과한다).

- [ ] **Step 4: 브라우저 스모크**
  - 백엔드: `backend/`에서 blog(8000), auth(8001), stock_api(8002)를 uvicorn으로 기동한다. dev DB 터널(15432)이 내려가 있으면 로컬 docker PG(5432)를 DB로 쓴다.
  - `admin_web`에서 `npm run dev`(5173)를 실행한다.
  - 체크리스트:
    1. 로그인(로컬 시드 관리자) → 레이아웃·사이드바 표시, Tailwind 스타일 적용
    2. 모바일 폭에서 햄버거 → 드로어 열기/닫기
    3. 게시판 목록, 생성
    4. 글 목록 → 상세(댓글 목록·작성)
    5. 글 작성(TipTap 굵게/제목/목록/링크)
    6. 차트 삽입 모달: 005930 검색 → 차트 렌더 → 수평선·사각형·텍스트·채널 드로잉 → 캡처 삽입 → 본문에 이미지
    7. 회원·통계 페이지
    8. 콘솔 에러 없음
  - 스모크로 생성한 테스트 게시판·게시글은 확인 후 UI에서 삭제한다(개발 DB 오염 방지).
  - 결과를 사용자에게 보고한다(스크린샷이나 GIF 첨부 가능).

- [ ] **Step 5: 커밋 (문서)**

```bash
cd ..
git add README.md docs/ROADMAP.md
git commit -m "docs: admin_web TypeScript 전환 반영 — README 빌드 안내·ROADMAP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```
