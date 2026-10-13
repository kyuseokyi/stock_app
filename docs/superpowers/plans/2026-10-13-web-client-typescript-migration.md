# web_client TypeScript 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `web_client/src`의 코드 파일 19개를 런타임 동작 변화 없이 `strict` TypeScript로 전환한다.

**Architecture:** `allowJs: true` + `strict: true`로 기반을 깔고, 하위 레이어(설정·스토어·API) → 컴포넌트 → 페이지 → 진입점 순으로 파일을 `git mv` 후 타입만 붙인다. 마지막 태스크에서 `allowJs`를 제거해 JS 잔존을 차단한다. 각 태스크는 `tsc --noEmit` + 빌드 통과가 종료 조건이다.

**Tech Stack:** React 18, Vite 5, Tailwind 3, axios 1, zustand 4, react-router-dom 6, TypeScript 5.6

**스펙:** `docs/superpowers/specs/2026-10-13-web-client-typescript-migration-design.md` (기준: `docs/superpowers/specs/2026-10-12-admin-web-typescript-migration-design.md`)

---

## 공통 규칙 (모든 태스크)

- **로직 무변경.** 타입 표기·선언·단언 외의 변경 금지. strict 때문에 가드/기본값/분기가 필요하면 추가하지 말고 보고(DONE_WITH_CONCERNS).
- 탈출구: 명시적 `any`·`@ts-ignore` 금지. `as`는 axios 에러·localStorage·SSE 데이터 같은 경계에서만. `!`는 근거 주석과 함께만.
- 리네임은 `git mv`. 스테이징은 명시 경로만(`git add -A`/`git add .` 금지). `.claude/`·`.serena/project.yml`은 절대 스테이징하지 않는다.
- 커밋 메시지 끝에 정확히 다음 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 브랜치: `dev`.
- 이 전환은 타입 전용이므로 TDD 테스트 대신 **`tsc --noEmit` + 빌드**가 검증이다. 각 태스크 검증 명령:
  ```bash
  cd web_client
  npx tsc --noEmit
  VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
  ```
  기대: 둘 다 에러 없이 종료(빌드는 `✓ built in`).

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `web_client/tsconfig.json` (신규) | strict TS 설정 |
| `web_client/src/vite-env.d.ts` (신규) | `import.meta.env` 키 타입 |
| `web_client/src/types/api.ts` (신규) | 백엔드 pydantic 응답 DTO + SSE 이벤트 타입 |
| `web_client/package.json`·`package-lock.json` | TS 의존성, build 스크립트 |
| `web_client/tailwind.config.js` | content glob에 ts/tsx 추가 |
| `web_client/index.html` | 진입점 `main.tsx` |
| `src/config.ts`, `src/store/{auth,boards}.ts`, `src/api/{client,auth,blog}.ts` | 데이터 레이어 |
| `src/components/ui/{Button,Card,Chip,EmptyState}.tsx`, `src/components/{Layout,LoginModal,NotificationToaster}.tsx` | 컴포넌트 |
| `src/pages/{HomePage,PostListPage,PostDetailPage,GamePage}.tsx` | 페이지 |
| `src/main.tsx`, `src/App.tsx` | 진입점 |

---

### Task 1: 기반 설정

**Files:**
- Modify: `web_client/package.json`, `web_client/package-lock.json`, `web_client/tailwind.config.js:3`
- Create: `web_client/tsconfig.json`, `web_client/src/vite-env.d.ts`, `web_client/src/types/api.ts`

- [ ] **Step 1: 의존성 설치** (admin_web과 동일 버전)

```bash
cd web_client
npm install -D typescript@~5.6.3 @types/react@^18.3.31 @types/react-dom@^18.3.7
```

- [ ] **Step 2: build 스크립트 변경** — `package.json`의 `"build": "vite build"` → `"build": "tsc --noEmit && vite build"`. 다른 키는 그대로.

- [ ] **Step 3: `web_client/tsconfig.json` 작성**

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
    "allowJs": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: `web_client/src/vite-env.d.ts` 작성**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_AUTH_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 5: `web_client/src/types/api.ts` 작성** (출처: `backend/apps/auth/schemas.py`, `backend/apps/blog/schemas.py`, `backend/apps/blog/routers/blogs.py`의 `publish_event`. web_client가 쓰는 응답만 정의)

```ts
// 백엔드 pydantic 응답 스키마와 1:1 대응하는 REST DTO 타입(web_client 사용분만).
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

// ---- SSE ----
/** blog SSE `notification` 이벤트 data(새 글). 출처: backend/apps/blog/routers/blogs.py publish_event */
export interface NewPostEvent {
  type: 'new_post'
  post_id: number
  board_id: number
  title: string
}
```

- [ ] **Step 6: Tailwind content 확장** — `web_client/tailwind.config.js` 3행:

```js
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
```

- [ ] **Step 7: 검증** — 공통 검증 명령 실행. 기대: 둘 다 통과.

- [ ] **Step 8: 커밋**

```bash
git add web_client/package.json web_client/package-lock.json web_client/tsconfig.json web_client/tailwind.config.js web_client/src/vite-env.d.ts web_client/src/types/api.ts
git commit -m "build(web): web_client TypeScript 기반 — tsconfig(strict·allowJs)·env 타입·API DTO·빌드 타입검사

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 데이터 레이어 (config · store · api)

**Files:** `git mv`로 `.js` → `.ts`
- `web_client/src/config.js`, `src/store/auth.js`, `src/store/boards.js`, `src/api/client.js`, `src/api/auth.js`, `src/api/blog.js`

- [ ] **Step 1: 리네임**

```bash
cd web_client/src
git mv config.js config.ts
git mv store/auth.js store/auth.ts
git mv store/boards.js store/boards.ts
git mv api/client.js api/client.ts
git mv api/auth.js api/auth.ts
git mv api/blog.js api/blog.ts
```

- [ ] **Step 2: `src/config.ts`** — 주석·로직 그대로, 타입만 추가. 파일 전체:

```ts
// 프론트 공개 설정 — 빌드 타임에 VITE_* 로 주입된다(번들에 그대로 실림).
//
// 환경 3단계:
//   local  : `npm run dev`(vite serve). VITE_* 없으면 아래 DEV_FALLBACK(localhost) 사용.
//   develop: 미니PC 배포. docker build args(VITE_*)로 haezean 터널 URL 주입.
//   product: 실서버. 별도 build args 로 product URL 주입(도메인 확정 시).
//
// ⚠️ 배포 빌드(vite build)에서 VITE_* 가 비면 localhost 로 폴백하지 않고 즉시 throw 한다
//    (localhost 가 조용히 구워지는 'green-but-broken' 배포 차단). 빌드 타임 방어는 vite.config.js.
type EnvKey = 'VITE_API_BASE_URL' | 'VITE_AUTH_BASE_URL'

const DEV_FALLBACK: Record<EnvKey, string> = {
  VITE_API_BASE_URL: 'http://localhost:8000/api/v1', // blog(8000)
  VITE_AUTH_BASE_URL: 'http://localhost:8001/api/v1', // auth(8001)
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

// blog 서비스(게시판/게시글/댓글/알림 SSE)
export const API_BASE_URL = readEnv('VITE_API_BASE_URL')
// auth 서비스(게스트 로그인/JWT)
export const AUTH_BASE_URL = readEnv('VITE_AUTH_BASE_URL')
```

- [ ] **Step 3: `src/api/auth.ts`** — 파일 전체:

```ts
import axios from 'axios'
import { AUTH_BASE_URL as authURL } from '../config'
import type { TokenResponse } from '../types/api'

// 인증 서비스 base URL (auth 8001) — 빌드 타임 주입, 폴백/fail-fast 는 ../config

const authClient = axios.create({
  baseURL: authURL,
  headers: { 'Content-Type': 'application/json' },
})

// 임시 로그인 — 닉네임으로 게스트 계정 발급(카카오/구글 도입 전)
export const guestLogin = async (nickname: string): Promise<TokenResponse> => {
  const { data } = await authClient.post<TokenResponse>('/auth/guest', { nickname })
  return data // { access_token, token_type, user }
}
```

- [ ] **Step 4: `src/store/auth.ts`** — 파일 전체. `localStorage.getItem`은 `string | null`이고 JS 원본은 `JSON.parse(null) === null`에 기대므로 `!`로 표기만 맞춘다(런타임 동일).

```ts
import { create } from 'zustand'
import { guestLogin } from '../api/auth'
import type { UserOut } from '../types/api'

// localStorage 키 (client.ts 인터셉터와 공유)
export const TOKEN_KEY = 'wc_token'
const USER_KEY = 'wc_user'

const readUser = (): UserOut | null => {
  try {
    // getItem 이 null 이면 JSON.parse(null) === null → || null 로 동일 처리(원본 JS 동작). `!` 는 타입 표기용.
    return (JSON.parse(localStorage.getItem(USER_KEY)!) as UserOut | null) || null
  } catch {
    return null
  }
}

interface AuthState {
  token: string | null
  user: UserOut | null
  login: (nickname: string) => Promise<UserOut>
  logout: () => void
}

// 임시 로그인(닉네임) 전역 상태. 이후 카카오/구글도 동일 store에 토큰만 저장하면 됨.
export const useAuthStore = create<AuthState>()((set) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: readUser(),

  login: async (nickname) => {
    const { access_token, user } = await guestLogin(nickname)
    localStorage.setItem(TOKEN_KEY, access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    set({ token: access_token, user })
    return user
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    set({ token: null, user: null })
  },
}))
```

- [ ] **Step 5: `src/api/client.ts`** — 파일 전체:

```ts
import axios, { type AxiosError } from 'axios'
import { TOKEN_KEY } from '../store/auth'
import { API_BASE_URL as baseURL } from '../config'

// 블로그 서비스 base URL (조회 + 인증형 댓글 작성) — 빌드 타임 주입, 폴백/fail-fast 는 ../config

const client = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
})

// 로그인 상태면 Bearer 자동 부착(조회엔 무해, 작성엔 필수)
client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 401(토큰 만료/무효) → 저장 토큰 정리(재로그인 유도)
client.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('wc_user')
    }
    return Promise.reject(err)
  },
)

export default client
```

- [ ] **Step 6: `src/api/blog.ts`** — 파일 전체:

```ts
import client from './client'
import type { BlogListOut, BlogOut, BoardOut, CommentOut, Id } from '../types/api'

// 게시판/게시글/댓글 조회 API (읽기 전용)
export const listBoards = async (): Promise<BoardOut[]> => {
  const { data } = await client.get<BoardOut[]>('/boards', { params: { only_active: true } })
  return data
}

interface ListBlogsParams {
  boardId?: number
  page?: number
  size?: number
}

export const listBlogs = async ({ boardId, page = 1, size = 10 }: ListBlogsParams = {}): Promise<BlogListOut> => {
  const params: Record<string, number> = { page, size }
  if (boardId != null) params.board_id = boardId
  const { data } = await client.get<BlogListOut>('/blogs', { params })
  return data // { total, page, size, items }
}

export const getBlog = async (id: Id): Promise<BlogOut> => {
  const { data } = await client.get<BlogOut>(`/blogs/${id}`)
  return data
}

export const listComments = async (blogId: Id): Promise<CommentOut[]> => {
  const { data } = await client.get<CommentOut[]>(`/blogs/${blogId}/comments`)
  return data
}

// 댓글 작성 (로그인 필요 — client 인터셉터가 Bearer 부착)
export const createComment = async (blogId: Id, content: string): Promise<CommentOut> => {
  const { data } = await client.post<CommentOut>(`/blogs/${blogId}/comments`, { content })
  return data
}
```

- [ ] **Step 7: `src/store/boards.ts`** — 파일 전체:

```ts
import { create } from 'zustand'
import { listBoards } from '../api/blog'
import type { BoardOut } from '../types/api'

interface BoardState {
  boards: BoardOut[]
  loaded: boolean
  error: string
  fetchBoards: () => Promise<void>
  boardName: (id: number) => string
}

// 활성 게시판 목록 전역 캐시 (헤더 탭 + 페이지 공유)
export const useBoardStore = create<BoardState>()((set, get) => ({
  boards: [],
  loaded: false,
  error: '',
  fetchBoards: async () => {
    if (get().loaded) return
    try {
      const boards = await listBoards()
      set({ boards, loaded: true, error: '' })
    } catch {
      set({ error: '게시판을 불러오지 못했습니다. 백엔드(8000)가 실행 중인지 확인하세요.' })
    }
  },
  boardName: (id) => get().boards.find((b) => b.id === id)?.name ?? '',
}))
```

- [ ] **Step 8: 검증** — 공통 검증 명령. 기대: 통과.

- [ ] **Step 9: 커밋**

```bash
git add web_client/src/config.ts web_client/src/store/auth.ts web_client/src/store/boards.ts web_client/src/api/client.ts web_client/src/api/auth.ts web_client/src/api/blog.ts
git status --short web_client   # 옛 .js 경로가 rename(R)으로 잡혔는지 확인
git commit -m "refactor(web): 데이터 레이어 TS 전환 — config·store·api

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: 컴포넌트

**Files:** `git mv`로 `.jsx` → `.tsx`
- `src/components/ui/Button.jsx`, `Card.jsx`, `Chip.jsx`, `EmptyState.jsx`, `src/components/Layout.jsx`, `LoginModal.jsx`, `NotificationToaster.jsx`

- [ ] **Step 1: 리네임**

```bash
cd web_client/src/components
git mv ui/Button.jsx ui/Button.tsx
git mv ui/Card.jsx ui/Card.tsx
git mv ui/Chip.jsx ui/Chip.tsx
git mv ui/EmptyState.jsx ui/EmptyState.tsx
git mv Layout.jsx Layout.tsx
git mv LoginModal.jsx LoginModal.tsx
git mv NotificationToaster.jsx NotificationToaster.tsx
```

- [ ] **Step 2: `ui/Button.tsx`** — 파일 전체:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  full?: boolean
  loading?: boolean
  loadingText?: ReactNode
}

// 토스 스타일 버튼. variant: primary(브랜드 채움) | secondary(surface)
// loadingText로 로딩 중 라벨을 커스텀(기존 화면 문구 보존용). 미지정 시 children 유지.
export default function Button({
  variant = 'primary',
  full = false,
  loading = false,
  loadingText,
  disabled = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex h-11 items-center justify-center rounded-btn px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand text-white hover:brightness-95',
    secondary: 'bg-surface text-ink hover:bg-line',
  }
  return (
    <button
      disabled={disabled || loading}
      className={`${base} ${variants[variant] ?? variants.primary} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {loading && loadingText ? loadingText : children}
    </button>
  )
}
```

- [ ] **Step 3: `ui/Card.tsx`** — 파일 전체:

```tsx
import type { ElementType, HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
}

// 토스 스타일 카드: surface 채움, 큰 라운드.
// as로 렌더 태그를 바꿔 시맨틱 보존(예: as="article" / as="section").
export default function Card({ as: Tag = 'div', className = '', children, ...props }: CardProps) {
  return (
    <Tag className={`rounded-card bg-surface p-4 ${className}`} {...props}>
      {children}
    </Tag>
  )
}
```

- [ ] **Step 4: `ui/Chip.tsx`** — 파일 전체:

```tsx
import type { HTMLAttributes } from 'react'

// NavLink 등 다른 엘리먼트에도 칩 스타일을 입히기 위한 클래스 헬퍼
export function chipClass(active: boolean): string {
  return `inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
    active ? 'bg-brand-soft text-brand' : 'bg-surface text-ink-muted hover:bg-line'
  }`
}

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  active?: boolean
}

// 정적 칩(span). 선택 상태는 active로.
export default function Chip({ active = false, className = '', children, ...props }: ChipProps) {
  return (
    <span className={`${chipClass(active)} ${className}`} {...props}>
      {children}
    </span>
  )
}
```

- [ ] **Step 5: `ui/EmptyState.tsx`** — 파일 전체:

```tsx
import type { ReactNode } from 'react'

interface EmptyStateProps {
  emoji?: string
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

// 큰 이모지 + 제목 + 안내문(+선택 액션). 게임 스켈레톤·빈 목록 공용.
export default function EmptyState({ emoji = '📭', title, description, action = null }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-5xl">{emoji}</div>
      <h2 className="mt-4 text-lg font-bold text-ink">{title}</h2>
      {description && <p className="mt-1.5 text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
```

- [ ] **Step 6: `LoginModal.tsx`** — 타입 변경점만(나머지 JSX·문구·로직은 원본 그대로 유지):
  1. 상단 import를 `import { type FormEvent, useState } from 'react'`로 변경.
  2. 컴포넌트 위에 props 타입 추가:
     ```tsx
     interface LoginModalProps {
       open: boolean
       onClose: () => void
       onSuccess?: () => void
     }
     ```
  3. 시그니처: `export default function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {`
  4. 제출 핸들러: `const submit = async (e: FormEvent<HTMLFormElement>) => {`

- [ ] **Step 7: `NotificationToaster.tsx`** — 타입 변경점만:
  1. import 추가: `import type { NewPostEvent } from '../types/api'`
  2. `STREAM_URL` 아래에 토스트 타입 추가:
     ```tsx
     interface Toast {
       id: string
       text: string
     }
     ```
  3. `const [toasts, setToasts] = useState<Toast[]>([])`
  4. 핸들러 시그니처·페이로드(SSE 경계 — `JSON.parse` 결과를 단언. 다른 type의 이벤트도 올 수 있으므로 `Partial`):
     ```tsx
     const onNotification = (e: MessageEvent<string>) => {
       let payload: Partial<NewPostEvent> = {}
       try {
         payload = JSON.parse(e.data) as Partial<NewPostEvent>
       } catch {
         return
       }
     ```
     이후 `id`·`text`·`setToasts`·`setTimeout`·리스너 등록/해제 코드는 원본 그대로. `es.addEventListener('notification', onNotification)`이 타입 에러면 핸들러를 `(e: MessageEvent)`로 바꾸고 `JSON.parse(e.data as string)`로 처리한다.

- [ ] **Step 8: `Layout.tsx`** — 타입 변경점만:
  1. `const sectionClass = (active: boolean) =>`
  - 나머지(스토어 구조분해, `NavLink`의 `({ isActive }) => chipClass(isActive)`)는 추론으로 통과한다. 통과하지 않으면 원인을 보고.

- [ ] **Step 9: 검증** — 공통 검증 명령. 기대: 통과. (페이지 `.jsx`는 아직 JS지만 `allowJs`로 빌드됨)

- [ ] **Step 10: 커밋** — 커밋 전 `git status --short web_client`로 의도한 7개 rename만 스테이징되는지 확인.

```bash
git add web_client/src/components/ui/Button.tsx web_client/src/components/ui/Card.tsx web_client/src/components/ui/Chip.tsx web_client/src/components/ui/EmptyState.tsx web_client/src/components/Layout.tsx web_client/src/components/LoginModal.tsx web_client/src/components/NotificationToaster.tsx
git status --short web_client
git commit -m "refactor(web): 컴포넌트 TS 전환 — ui 4종·Layout·LoginModal·NotificationToaster

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: 페이지

**Files:** `git mv`로 `.jsx` → `.tsx`
- `src/pages/HomePage.jsx`, `PostListPage.jsx`, `PostDetailPage.jsx`, `GamePage.jsx`

- [ ] **Step 1: 리네임**

```bash
cd web_client/src/pages
git mv HomePage.jsx HomePage.tsx
git mv PostListPage.jsx PostListPage.tsx
git mv PostDetailPage.jsx PostDetailPage.tsx
git mv GamePage.jsx GamePage.tsx
```

- [ ] **Step 2: `HomePage.tsx`, `GamePage.tsx`** — 변경 없음(리네임만). 추론으로 통과.

- [ ] **Step 3: `PostListPage.tsx`** — 타입 변경점만:
  1. import 추가: `import type { BlogListOut } from '../types/api'`
  2. `const toPreview = (html: string, n = 100) => {`
  3. 상태: `const [data, setData] = useState<Pick<BlogListOut, 'total' | 'items'>>({ total: 0, items: [] })`
  - `Number(boardId)`(boardId: `string | undefined`)·`.then(setData)`는 그대로 통과한다.

- [ ] **Step 4: `PostDetailPage.tsx`** — 타입 변경점만:
  1. import 수정/추가:
     ```tsx
     import { type FormEvent, useEffect, useState } from 'react'
     import type { AxiosError } from 'axios'
     import type { BlogOut, CommentOut } from '../types/api'
     ```
  2. 라우트 파라미터: 이 페이지는 `posts/:id` 라우트에서만 렌더되므로 `id`가 항상 있다. 원본 `const { id } = useParams()`를 다음으로 교체(런타임 동일):
     ```tsx
     // posts/:id 라우트 전용 → id 는 항상 존재(타입상 string | undefined). `!` 는 타입 표기용.
     const id = useParams().id!
     ```
  3. 상태:
     ```tsx
     const [post, setPost] = useState<BlogOut | null>(null)
     const [comments, setComments] = useState<CommentOut[]>([])
     ```
  4. 핸들러: `const submitComment = async (e: FormEvent<HTMLFormElement>) => {`
  5. catch 블록(axios 에러 경계 — `err`는 strict에서 `unknown`):
     ```tsx
     } catch (err) {
       const status = (err as AxiosError).response?.status
       if (status === 401) {
         setCommentError('로그인이 만료되었습니다. 다시 로그인해 주세요.')
       } else if (status === 403) {
         setCommentError('이 게시판은 댓글이 비활성화되어 있습니다.')
       } else {
         setCommentError('댓글 등록에 실패했습니다.')
       }
     }
     ```
     (원본은 `err.response?.status`를 두 번 읽음 — 같은 값이므로 런타임 동일.)
  - JSX·문구는 원본 그대로.

- [ ] **Step 5: 검증** — 공통 검증 명령. 기대: 통과.

- [ ] **Step 6: 커밋**

```bash
git add web_client/src/pages/HomePage.tsx web_client/src/pages/PostListPage.tsx web_client/src/pages/PostDetailPage.tsx web_client/src/pages/GamePage.tsx
git status --short web_client
git commit -m "refactor(web): 페이지 TS 전환 — Home·PostList·PostDetail·Game

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 진입점 + `allowJs` 제거

**Files:**
- `git mv` `web_client/src/main.jsx` → `main.tsx`, `src/App.jsx` → `App.tsx`
- Modify: `web_client/index.html:10`, `web_client/tsconfig.json`

- [ ] **Step 1: 리네임**

```bash
cd web_client/src
git mv main.jsx main.tsx
git mv App.jsx App.tsx
```

- [ ] **Step 2: `main.tsx`** — `getElementById` 한 줄만:

```tsx
// index.html 에 #root 가 항상 있다(타입상 HTMLElement | null). `!` 는 타입 표기용.
ReactDOM.createRoot(document.getElementById('root')!).render(
```

`App.tsx`는 변경 없음.

- [ ] **Step 3: `index.html` 10행**

```html
    <script type="module" src="/src/main.tsx"></script>
```

- [ ] **Step 4: `tsconfig.json`에서 `"allowJs": true` 줄 삭제**(앞 줄 `"skipLibCheck": true,`의 끝 쉼표도 제거해 JSON 유효성 유지).

- [ ] **Step 5: JS 잔존 확인**

```bash
cd web_client
find src -name '*.js' -o -name '*.jsx'
```
기대: 출력 없음.

- [ ] **Step 6: 탈출구 집계**

```bash
grep -rnE ': any\b|<any>|as any|@ts-ignore|@ts-expect-error' src
grep -rnE ' as [A-Z]|\)!' src
```
기대: 첫 명령은 출력 없음. 두 번째는 의도한 지점만 — `store/auth.ts`(`!`+`as`), `NotificationToaster.tsx`(`as`), `PostDetailPage.tsx`(`!`+`as`), `main.tsx`(`!`). 집계 결과를 보고에 포함.

- [ ] **Step 7: 검증** — 공통 검증 명령. 기대: 통과. 추가로 번들에 dev 폴백 URL이 없는지:

```bash
grep -l "localhost:800" dist/assets/*.js || echo "OK: localhost 없음"
```
기대: `OK: localhost 없음`(`import.meta.env.DEV`가 false로 치환되어 `DEV_FALLBACK`이 제거됨 — admin_web도 동일 확인 통과). 걸리면 수정하지 말고 보고.

- [ ] **Step 8: 커밋**

```bash
git add web_client/src/main.tsx web_client/src/App.tsx web_client/index.html web_client/tsconfig.json
git status --short web_client
git commit -m "refactor(web): 진입점 TS 전환·allowJs 제거 — web_client strict TS 완전 전환

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 문서 + 최종 검증

**Files:**
- Modify: `README.md`(`### 4. 일반 유저 웹 (web_client)` 섹션), `docs/ROADMAP.md:116`

- [ ] **Step 1: README** — `### 4. 일반 유저 웹 (web_client)` 섹션의 실행 코드 블록(```bash ... ```) 바로 아래에 다음 3줄 추가(admin_web 섹션의 같은 형식 3줄을 따름):

```markdown
- web_client 는 **TypeScript(strict)** 다. `npm run build` = `tsc --noEmit && vite build` 이므로 타입 에러가 있으면 빌드(및 Docker 배포 빌드)가 실패한다. 타입만 확인하려면 `npx tsc --noEmit`.
- 로컬에서 배포용 빌드를 확인할 때는 VITE_* 가 필수다: `VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build`.
- API 응답 타입은 `web_client/src/types/`(백엔드 pydantic 스키마 기준)에 있다. 백엔드 응답 스키마를 바꾸면 admin_web 타입과 함께 갱신한다.
```

- [ ] **Step 2: ROADMAP** — 116행을 다음으로 교체:

```markdown
- [x] web_client TypeScript 전환 (서브페이즈 6 직전, admin_web과 동일 방식) — 2026-10-13 strict 전환 완료
```

- [ ] **Step 3: 커밋**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: README·ROADMAP — web_client TypeScript(strict) 전환 반영

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

- [ ] **Step 4: 클린 설치 빌드(배포 보호)** — Docker와 같은 `npm ci` 경로:

```bash
cd web_client
npm ci
npx tsc --noEmit
VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
```
기대: 모두 통과.

- [ ] **Step 5: 브라우저 스모크(컨트롤러 수행)** — blog(8000)·auth(8001) + `cd web_client && npm run dev`(3000). 스펙 §4 체크리스트 7항목 확인. 자격증명은 채팅에 출력하지 않는다.
