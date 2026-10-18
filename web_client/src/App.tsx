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
const ScreenerPage = lazy(() => import('./pages/ScreenerPage'))
const FundListPage = lazy(() => import('./pages/FundListPage'))
const FundReportPage = lazy(() => import('./pages/FundReportPage'))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        {/* 메뉴: 홈(/) · 커뮤니티(/community → 첫 게시판) · 게임(/game) · 스크리너(/screener, 웹 먼저) · 내정보(/me) */}
        <Route index element={<HomePage />} />
        <Route path="community" element={<CommunityPage />} />
        <Route path="me" element={<MyPage />} />
        <Route path="me/funds" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <FundListPage />
          </Suspense>
        } />
        <Route path="me/funds/:id" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <FundReportPage />
          </Suspense>
        } />
        <Route path="boards/:boardId" element={<PostListPage />} />
        <Route path="posts/:id" element={<PostDetailPage />} />
        <Route path="game" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <GamePage />
          </Suspense>
        } />
        <Route path="screener" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <ScreenerPage />
          </Suspense>
        } />
        <Route path="auth/complete" element={<AuthCompletePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
