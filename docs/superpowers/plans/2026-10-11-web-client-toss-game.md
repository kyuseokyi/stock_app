# web_client 토스 디자인 + 게임 대응 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web_client(React+Vite+Tailwind 커뮤니티 웹앱)에 토스 디자인 언어를 이식하고, 2단 네비(커뮤니티·게임)와 게임 스켈레톤 페이지를 추가한다.

**Architecture:** Tailwind `theme.extend`에 토스 토큰을 심어 유틸리티(`bg-brand`, `text-ink` 등)를 만들고, `src/components/ui/`에 작은 프레젠테이션 컴포넌트(Button·Card·Chip·EmptyState)를 둔다. Layout 헤더는 `useLocation()`으로 커뮤니티/게임 섹션을 판별하는 2단 구조로 바꾸고, 기존 화면은 API·store·SSE 로직을 건드리지 않고 스타일/토큰만 교체한다.

**Tech Stack:** React 18, Vite 5, TailwindCSS 3.4, react-router-dom 6, zustand 4. **테스트 러너 없음** — 각 태스크는 `cd web_client && npm run build` 성공으로 검증한다(스펙 §9 명시). 추출할 순수 로직이 없어 TDD 대신 빌드 검증 + 코드 리뷰를 쓴다.

**스펙:** `docs/superpowers/specs/2026-10-11-web-client-toss-game-design.md`

**토스 토큰(모바일 `unistyles.ts`와 값 일치):** brand `#3182f6` / brand-soft `#e8f1fe` / up `#f04452` / down `#3182f6` / ink `#191f28` / ink-muted `#8b95a1` / surface `#f2f4f6` / line `#e5e8eb`. radius: card 20 / btn 14 / field 12 / chip rounded-full.

> **공통 규칙**: 모든 커밋은 저장소 루트(`stock_app`)에서 전체 폴더 대상. 작업 경로는 `web_client/`. 커밋 메시지 말미에 아래 2줄을 붙인다:
> ```
> Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
> Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
> ```

---

### Task 1: Tailwind 토스 테마 + 전역 서식 토큰화

body 배경과 `.post-content` 서식을 토스 톤으로 바꾸고, 이후 모든 태스크가 쓸 토큰 유틸리티를 만든다.

**Files:**
- Modify: `web_client/tailwind.config.js`
- Modify: `web_client/src/index.css`

- [ ] **Step 1: Tailwind theme.extend에 토스 토큰 추가**

`web_client/tailwind.config.js` 전체를 아래로 교체:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#3182f6', soft: '#e8f1fe' }, // 토스 블루 / 연한 포인트
        up: '#f04452', // 상승·수익 = 빨강 (국내 관례)
        down: '#3182f6', // 하락·손실 = 파랑
        ink: { DEFAULT: '#191f28', muted: '#8b95a1' }, // 본문 / 보조
        surface: '#f2f4f6',
        line: '#e5e8eb', // border
      },
      borderRadius: { card: '20px', btn: '14px', field: '12px' },
    },
  },
  plugins: [],
}
```

> 주의: `colors.brand = { DEFAULT, soft }`이므로 유틸리티는 `bg-brand`(=#3182f6), `bg-brand-soft`(=#e8f1fe), `text-brand`가 된다. 슬래시(`bg-brand/soft`)는 불투명도 문법이라 쓰지 않는다. 마찬가지로 `text-ink`(=#191f28), `text-ink-muted`(=#8b95a1).

- [ ] **Step 2: index.css body/서식을 토스 토큰으로 교체**

`web_client/src/index.css` 전체를 아래로 교체:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-white text-ink antialiased;
}

/* 게시글 본문(관리자 HTML) 기본 서식 */
.post-content h2 {
  @apply mb-2 mt-5 text-xl font-bold text-ink;
}
.post-content h3 {
  @apply mb-2 mt-4 text-lg font-semibold text-ink;
}
.post-content p {
  @apply my-3 leading-relaxed;
}
.post-content ul {
  @apply my-3 list-disc pl-6;
}
.post-content ol {
  @apply my-3 list-decimal pl-6;
}
.post-content blockquote {
  @apply my-3 border-l-4 border-line pl-4 text-ink-muted;
}
.post-content a {
  @apply text-brand underline;
}
.post-content img {
  @apply my-4 max-w-full rounded-lg;
}
```

- [ ] **Step 3: 빌드로 토큰 유효성 검증**

Run: `cd web_client && npm run build`
Expected: 성공(exit 0). `@apply text-ink` / `border-line` 등 커스텀 유틸이 인식돼야 한다. 실패 시 토큰 이름 오타(`text-ink-muted` 등)를 점검.

- [ ] **Step 4: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/tailwind.config.js web_client/src/index.css
git commit -m "feat(web): Tailwind 토스 테마 토큰 + 전역 서식 토큰화

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 공통 UI 컴포넌트 (`src/components/ui/`)

토스 Tailwind 클래스를 캡슐화한 4개 컴포넌트. 커뮤니티·게임·로그인에서 재사용한다.

**Files:**
- Create: `web_client/src/components/ui/Button.jsx`
- Create: `web_client/src/components/ui/Card.jsx`
- Create: `web_client/src/components/ui/Chip.jsx`
- Create: `web_client/src/components/ui/EmptyState.jsx`

- [ ] **Step 1: Button.jsx 작성**

`web_client/src/components/ui/Button.jsx`:

```jsx
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
}) {
  const base =
    'inline-flex h-11 items-center justify-center rounded-btn px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
  const variants = {
    primary: 'bg-brand text-white hover:brightness-95',
    secondary: 'bg-surface text-ink hover:bg-line',
  }
  return (
    <button
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {loading && loadingText ? loadingText : children}
    </button>
  )
}
```

- [ ] **Step 2: Card.jsx 작성**

`web_client/src/components/ui/Card.jsx`:

```jsx
// 토스 스타일 카드: surface 채움, 큰 라운드
export default function Card({ className = '', children, ...props }) {
  return (
    <div className={`rounded-card bg-surface p-4 ${className}`} {...props}>
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Chip.jsx 작성 (컴포넌트 + chipClass 헬퍼)**

`web_client/src/components/ui/Chip.jsx`:

```jsx
// NavLink 등 다른 엘리먼트에도 칩 스타일을 입히기 위한 클래스 헬퍼
export function chipClass(active) {
  return `inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
    active ? 'bg-brand-soft text-brand' : 'bg-surface text-ink-muted hover:bg-line'
  }`
}

// 정적 칩(span). 선택 상태는 active로.
export default function Chip({ active = false, className = '', children, ...props }) {
  return (
    <span className={`${chipClass(active)} ${className}`} {...props}>
      {children}
    </span>
  )
}
```

> `chipClass`를 분리한 이유: 게시판 탭은 `NavLink`라 span인 Chip을 직접 못 쓴다. Task 4에서 `NavLink className={({isActive}) => chipClass(isActive)}`로 재사용한다(DRY).

- [ ] **Step 4: EmptyState.jsx 작성**

`web_client/src/components/ui/EmptyState.jsx`:

```jsx
// 큰 이모지 + 제목 + 안내문(+선택 액션). 게임 스켈레톤·빈 목록 공용.
export default function EmptyState({ emoji = '📭', title, description, action = null }) {
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

- [ ] **Step 5: 빌드 검증**

Run: `cd web_client && npm run build`
Expected: 성공(exit 0). 아직 import하는 곳이 없어 번들에 포함되진 않지만, 구문/토큰 오류가 없어야 한다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/components/ui/
git commit -m "feat(web): 공통 UI 컴포넌트(Button·Card·Chip·EmptyState) 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: 게임 스켈레톤 페이지 + `/game` 라우트

백엔드 미연동 정적 "시즌 준비 중" 페이지를 만들고 라우팅에 연결한다. 모바일 `game.tsx`와 동일 문구.

**Files:**
- Create: `web_client/src/pages/GamePage.jsx`
- Modify: `web_client/src/App.jsx`

- [ ] **Step 1: GamePage.jsx 작성**

`web_client/src/pages/GamePage.jsx`:

```jsx
import EmptyState from '../components/ui/EmptyState'

// 게임 스켈레톤 — 백엔드(트레이딩 게임 Phase 1~5) 후 실제 화면으로 교체
export default function GamePage() {
  return (
    <EmptyState
      emoji="🎮"
      title="시즌을 준비하고 있어요"
      description="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
    />
  )
}
```

- [ ] **Step 2: App.jsx에 /game 라우트 추가**

`web_client/src/App.jsx` 전체를 아래로 교체(기존 라우트 보존 + GamePage import + game Route 추가):

```jsx
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import PostListPage from './pages/PostListPage'
import PostDetailPage from './pages/PostDetailPage'
import GamePage from './pages/GamePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="boards/:boardId" element={<PostListPage />} />
        <Route path="posts/:id" element={<PostDetailPage />} />
        <Route path="game" element={<GamePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 3: 빌드 + CSS 토큰 방출 검증**

Run: `cd web_client && npm run build`
Expected: 성공(exit 0). `/game`이 Layout 하위 라우트로 추가됨.

이어서 EmptyState가 실제로 쓰는 토큰 클래스가 번들 CSS에 방출됐는지 확인(JIT는 렌더되는 클래스만 생성하므로 오타를 잡아냄):

Run: `grep -oE 'text-ink|text-ink-muted' web_client/dist/assets/*.css | sort -u`
Expected: `text-ink`, `text-ink-muted` 두 줄이 모두 보인다. 비면 EmptyState의 토큰 이름 오타.

- [ ] **Step 4: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/pages/GamePage.jsx web_client/src/App.jsx
git commit -m "feat(web): 게임 스켈레톤 페이지 + /game 라우트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: Layout 2단 네비 개편 (커뮤니티·게임)

헤더 1차 네비에 커뮤니티/게임 섹션 토글을 두고, 커뮤니티 섹션일 때만 게시판 탭을 보인다. 로그인/로그아웃 로직은 그대로 두고 토스 스타일로만 바꾼다.

**Files:**
- Modify: `web_client/src/components/Layout.jsx`

- [ ] **Step 1: Layout.jsx 전체 교체**

`web_client/src/components/Layout.jsx` 전체를 아래로 교체:

```jsx
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useBoardStore } from '../store/boards'
import { useAuthStore } from '../store/auth'
import { chipClass } from './ui/Chip'
import LoginModal from './LoginModal'
import NotificationToaster from './NotificationToaster'

// 1차 섹션(커뮤니티·게임) 탭 스타일
const sectionClass = (active) =>
  `pb-1.5 text-base font-bold transition ${
    active ? 'border-b-2 border-brand text-brand' : 'text-ink-muted hover:text-ink'
  }`

export default function Layout() {
  const { boards, fetchBoards } = useBoardStore()
  const { user, logout } = useAuthStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const location = useLocation()
  // 섹션 판별: /game 경로면 게임, 그 외 전부 커뮤니티(별도 상태 불필요)
  const isGame = location.pathname.startsWith('/game')

  useEffect(() => {
    fetchBoards()
  }, [fetchBoards])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-lg font-bold text-ink">
              📈 StockApp
            </Link>
            {user ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-ink-muted">
                  <span className="font-medium text-ink">{user.nickname}</span> 님
                </span>
                <button
                  onClick={logout}
                  className="rounded-field bg-surface px-2.5 py-1 text-ink-muted hover:bg-line"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <button
                onClick={() => setLoginOpen(true)}
                className="rounded-field bg-brand px-3 py-1.5 text-sm font-medium text-white hover:brightness-95"
              >
                로그인
              </button>
            )}
          </div>

          {/* 1차 네비: 커뮤니티 · 게임 */}
          <nav className="mt-3 flex items-center gap-5">
            <Link to="/" className={sectionClass(!isGame)}>
              커뮤니티
            </Link>
            <Link to="/game" className={sectionClass(isGame)}>
              게임
            </Link>
          </nav>

          {/* 커뮤니티 섹션일 때만 게시판 탭 */}
          {!isGame && (
            <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {boards.map((b) => (
                <NavLink
                  key={b.id}
                  to={`/boards/${b.id}`}
                  className={({ isActive }) => chipClass(isActive)}
                >
                  {b.name}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>

      <NotificationToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
```

> 로고에서 "커뮤니티" 글자를 뗐다(이제 1차 네비 섹션이므로 중복 제거). 게시판 탭은 `chipClass`로 토스 칩 스타일 재사용.

- [ ] **Step 2: 빌드 + CSS 토큰 방출 검증**

Run: `cd web_client && npm run build`
Expected: 성공(exit 0). `useLocation` import, `chipClass` import가 해석돼야 한다.

이어서 2단 네비·칩이 쓰는 토큰이 번들 CSS에 방출됐는지 확인:

Run: `grep -oE 'bg-brand-soft|text-brand|border-brand|bg-surface|rounded-field' web_client/dist/assets/*.css | sort -u`
Expected: 5개 클래스가 모두 보인다. 빠진 게 있으면 Layout/Chip의 해당 토큰 오타.

- [ ] **Step 3: 육안 검증(로컬)**

Run: `cd web_client && npm run dev` 후 브라우저에서
- 헤더에 "커뮤니티 · 게임" 2단 네비가 보이고, 활성 섹션에 토스 블루 밑줄.
- 커뮤니티일 때만 게시판 칩 탭이 아래에 보이고, `/game`에선 사라짐.
- 로그인/로그아웃 버튼 동작 보존.

- [ ] **Step 4: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/components/Layout.jsx
git commit -m "feat(web): Layout 2단 네비(커뮤니티·게임) + 게시판 탭 조건부 표시

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 기존 화면 토스화 (글목록·글상세·홈·로그인·토스터)

API 계약·store·SSE 로직은 **불변**. indigo/slate/red 클래스를 토스 토큰으로 치환하고 Card/Button을 적용한다.

**Files:**
- Modify: `web_client/src/pages/PostListPage.jsx`
- Modify: `web_client/src/pages/PostDetailPage.jsx`
- Modify: `web_client/src/pages/HomePage.jsx`
- Modify: `web_client/src/components/LoginModal.jsx`
- Modify: `web_client/src/components/NotificationToaster.jsx`

- [ ] **Step 1: PostListPage.jsx 토스화**

`web_client/src/pages/PostListPage.jsx`의 `return (...)` 내부에서 아래 치환(로직·훅·`toPreview`는 그대로):

제목 `h1`:
```jsx
      <h1 className="mb-5 text-xl font-bold text-ink">
        {boardName(Number(boardId)) || '게시판'}
      </h1>
```
에러 배너:
```jsx
      {error && (
        <p className="mb-4 rounded-field bg-up/10 px-4 py-2 text-sm text-up">{error}</p>
      )}
```
로딩/빈 상태:
```jsx
      {loading ? (
        <p className="py-10 text-center text-ink-muted">불러오는 중…</p>
      ) : data.items.length === 0 ? (
        <p className="py-10 text-center text-ink-muted">아직 게시글이 없습니다.</p>
      ) : (
```
글 카드 Link:
```jsx
              <Link
                to={`/posts/${p.id}`}
                className="block rounded-card bg-surface p-4 transition hover:bg-line"
              >
                <h2 className="font-semibold text-ink">{p.title}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                  {toPreview(p.content)}
                </p>
                <p className="mt-2 text-xs text-ink-muted">
                  {new Date(p.created_at).toLocaleDateString('ko-KR')} · 조회 {p.view_count}
                </p>
              </Link>
```
페이지네이션:
```jsx
        <div className="mt-6 flex items-center justify-center gap-3 text-sm text-ink-muted">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-field bg-surface px-3 py-1 disabled:opacity-40"
          >
            이전
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-field bg-surface px-3 py-1 disabled:opacity-40"
          >
            다음
          </button>
        </div>
```

- [ ] **Step 2: PostDetailPage.jsx 토스화 (Card·Button 적용)**

`web_client/src/pages/PostDetailPage.jsx` 상단 import에 추가:
```jsx
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
```
로딩/에러 반환:
```jsx
  if (loading) return <p className="py-10 text-center text-ink-muted">불러오는 중…</p>
  if (!post) return <p className="py-10 text-center text-up">{error}</p>
```
"목록으로" 링크:
```jsx
      <Link to={board ? `/boards/${board.id}` : '/'} className="text-sm text-ink-muted hover:text-brand">
        ← 목록으로
      </Link>
```
본문 article (`<article>` → `Card`로 교체, `mt-3` 유지):
```jsx
      <Card className="mt-3 sm:p-6">
        {board && (
          <span className="mb-2 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
            {board.name}
          </span>
        )}
        <h1 className="mb-2 text-2xl font-bold text-ink">{post.title}</h1>
        <p className="mb-6 text-sm text-ink-muted">
          {new Date(post.created_at).toLocaleString('ko-KR')} · 조회 {post.view_count}
        </p>
        <div
          className="post-content text-ink"
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </Card>
```
댓글 section (`<section>` → `Card`로 교체, `mt-6` 유지):
```jsx
      <Card className="mt-6 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-ink">
          댓글 <span className="text-brand">{comments.length}</span>
        </h2>

        <ul className="space-y-3">
          {comments.length === 0 ? (
            <li className="py-4 text-center text-sm text-ink-muted">아직 댓글이 없습니다.</li>
          ) : (
            comments.map((c) => (
              <li key={c.id} className="rounded-field bg-white px-4 py-3">
                <p className="text-sm font-medium text-ink">
                  {c.author_name || '익명'}
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {new Date(c.created_at).toLocaleString('ko-KR')}
                  </span>
                </p>
                <p className="mt-1 text-sm text-ink">{c.content}</p>
              </li>
            ))
          )}
        </ul>

        {!commentsEnabled ? (
          <p className="mt-5 rounded-field bg-white px-4 py-3 text-center text-sm text-ink-muted">
            이 게시판은 댓글이 비활성화되어 있습니다.
          </p>
        ) : user ? (
          <form onSubmit={submitComment} className="mt-5">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={`${user.nickname} 님, 댓글을 입력하세요`}
              className="w-full rounded-field border border-line bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            {commentError && <p className="mt-1 text-sm text-up">{commentError}</p>}
            <div className="mt-2 flex justify-end">
              <Button
                type="submit"
                disabled={submitting || !content.trim()}
                loading={submitting}
                loadingText="등록 중…"
              >
                댓글 등록
              </Button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setLoginOpen(true)}
            className="mt-5 w-full rounded-field bg-surface px-4 py-3 text-center text-sm text-brand hover:bg-line"
          >
            로그인하고 댓글 작성하기
          </button>
        )}
      </Card>
```
> `Button`에 `loadingText="등록 중…"`을 넘겨 기존 문구를 보존한다(회귀 방지). 댓글 카드 내부 행은 Card가 surface라서 한 단계 더 밝은 `bg-white`로 대비를 준다.

- [ ] **Step 3: LoginModal.jsx 토스화 (로직 불변)**

`web_client/src/components/LoginModal.jsx`의 `return (...)`만 아래로 교체(상단 로직·`submit`·훅 그대로):

```jsx
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">로그인</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          닉네임을 입력하면 바로 시작합니다. (소셜 로그인은 준비 중)
        </p>
        <form onSubmit={submit}>
          <input
            autoFocus
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            placeholder="닉네임 (예: 주린이)"
            className="w-full rounded-field border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          {error && <p className="mt-2 text-sm text-up">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
          >
            {loading ? '로그인 중…' : '닉네임으로 시작'}
          </button>
        </form>
      </div>
    </div>
  )
```
> CTA는 Button 컴포넌트 대신 인라인 유지(모달 폼 제출 특수 라벨 "로그인 중…" 보존). 토큰만 토스로.

- [ ] **Step 4: NotificationToaster.jsx 토스화 (SSE 로직 불변)**

`web_client/src/components/NotificationToaster.jsx`의 토스트 `div`/`p`/`button` className만 치환(useEffect/EventSource 로직 그대로):

```jsx
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 rounded-card border border-line bg-white px-4 py-3 shadow-lg"
        >
          <span className="mt-0.5 text-lg">🔔</span>
          <p className="flex-1 text-sm text-ink">{t.text}</p>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="shrink-0 text-ink-muted hover:text-ink"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
```

- [ ] **Step 5: HomePage.jsx 토스화**

`web_client/src/pages/HomePage.jsx`의 안내 문구 색만 토큰으로 치환(리다이렉트 로직 불변):

```jsx
  return (
    <div className="py-16 text-center">
      {error ? (
        <p className="text-sm text-up">{error}</p>
      ) : !loaded ? (
        <p className="text-ink-muted">불러오는 중…</p>
      ) : (
        <p className="text-ink-muted">표시할 게시판이 없습니다.</p>
      )}
    </div>
  )
```

- [ ] **Step 6: 빌드 + CSS 토큰 방출 + 코드 전역 잔존 검사**

Run: `cd web_client && npm run build`
Expected: 성공(exit 0).

번들 CSS에 이번 태스크의 핵심 토큰이 방출됐는지:

Run: `grep -oE 'bg-up\/10|text-up|bg-brand-soft|bg-surface|rounded-card|rounded-btn|rounded-field' web_client/dist/assets/*.css | sort -u`
Expected: 나열된 클래스가 모두 보인다(일부 다른 태스크와 중복 생성 가능).

구 팔레트(indigo/slate/red-NNN)가 `src`에 남지 않았는지 — 성공 기준 1("기존 화면이 토스 톤")을 직접 확인:

Run: `grep -rnE 'indigo-|slate-|red-[0-9]' web_client/src`
Expected: **출력 없음**(exit 1). 남아 있으면 해당 파일을 토큰으로 마저 치환.

- [ ] **Step 7: 육안 회귀 검증(로컬)**

Run: `cd web_client && npm run dev` 후
- 글목록 카드/페이지네이션, 글상세 본문·댓글 작성·로그인 모달·알림 토스터·홈 안내가 토스 톤으로 보인다.
- **회귀**: 게시판 글 로드, 글 상세, 댓글 작성(로그인 시)·401/403 에러 문구, SSE 알림 토스트, 로그인/로그아웃이 기존대로 동작한다.

- [ ] **Step 8: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/pages/PostListPage.jsx web_client/src/pages/PostDetailPage.jsx web_client/src/pages/HomePage.jsx web_client/src/components/LoginModal.jsx web_client/src/components/NotificationToaster.jsx
git commit -m "feat(web): 글목록·글상세·홈·로그인 모달·알림 토스터 토스 스타일 적용

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: README 반영

루트 `README.md`의 web_client 섹션에 2단 네비·게임 스켈레톤·토스 테마를 반영한다(CLAUDE.md 규칙 7).

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README의 web_client 설명 갱신**

`README.md`에서 web_client 관련 섹션을 찾아(없으면 admin_web 섹션 근처에 추가), 아래 내용을 반영:
- web_client는 커뮤니티/블로그 리더 + 게임 진입점.
- 네비: 2단(커뮤니티·게임). 커뮤니티 섹션에서만 게시판 탭 표시. `/game`은 "시즌 준비 중" 스켈레톤(백엔드 Phase 1~5 후 실제 화면).
- 디자인: 토스 라이트 스타일, `docs/mobile_design_language.md` 토큰을 Tailwind `theme.extend`로 이식(brand #3182f6 등). 로그인은 닉네임 모달 유지.
- 로컬 기동: `cd web_client && npm install && npm run dev`, 빌드 검증 `npm run build`. 환경변수 `VITE_*`(API_BASE_URL 등, `src/config.js` 참조).

> 실제 README 현재 구조를 먼저 읽고(`sed -n` 또는 Read), 기존 web_client 문단이 있으면 교체, 없으면 admin_web 다음에 동일 포맷으로 추가한다. 기존 다른 섹션은 건드리지 않는다(회귀 방지).

- [ ] **Step 2: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add README.md
git commit -m "docs: web_client 2단 네비·게임 스켈레톤·토스 테마 README 반영

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## 검증 요약

- 각 태스크: `cd web_client && npm run build` 성공.
- 최종 육안(로컬 `npm run dev`): 커뮤니티/게임 2단 네비 전환, 게시판 칩 탭, 글목록/상세, 로그인 모달, 게임 스켈레톤, 알림 토스터가 모두 토스 톤.
- 회귀 불변: 게시판/글/댓글/로그인/SSE 알림 동작과 API 계약·store·SSE 연결 로직.

## 범위 밖(후속)

- 간편로그인(소셜) — 백엔드 `/auth/social` 후.
- 게임 실시간 플레이·주문·랭킹 — 트레이딩 게임 Phase 1~6.
- 웹 홈 피드·프로필 페이지 신규, 다크모드 — 현재 라이트 고정.
