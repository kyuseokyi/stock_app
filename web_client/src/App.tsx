import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import AuthCompletePage from './pages/AuthCompletePage'
import CommunityPage from './pages/CommunityPage'
import HomePage from './pages/HomePage'
import MyPage from './pages/MyPage'
import PostListPage from './pages/PostListPage'
import PostDetailPage from './pages/PostDetailPage'

const GamePage = lazy(() => import('./pages/GamePage'))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        {/* 메뉴: 홈(/) · 커뮤니티(/community → 첫 게시판) · 게임(/game) · 내정보(/me) — 앱 하단 탭과 같은 4개 */}
        <Route index element={<HomePage />} />
        <Route path="community" element={<CommunityPage />} />
        <Route path="me" element={<MyPage />} />
        <Route path="boards/:boardId" element={<PostListPage />} />
        <Route path="posts/:id" element={<PostDetailPage />} />
        <Route path="game" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <GamePage />
          </Suspense>
        } />
        <Route path="auth/complete" element={<AuthCompletePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
