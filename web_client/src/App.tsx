import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import ScreenerFeatureGate from './components/screener/ScreenerFeatureGate'
import AuthCompletePage from './pages/AuthCompletePage'
import CommunityPage from './pages/CommunityPage'
import HomePage from './pages/HomePage'
import MyPage from './pages/MyPage'
import PostListPage from './pages/PostListPage'
import PostDetailPage from './pages/PostDetailPage'

const GamePage = lazy(() => import('./pages/GamePage'))
const ScreenerLayout = lazy(() => import('./pages/screener/ScreenerLayout'))
const ScreenerPage = lazy(() => import('./pages/ScreenerPage'))
const MarketTab = lazy(() => import('./pages/screener/MarketTab'))
const GroupTab = lazy(() => import('./pages/screener/GroupTab'))
const CalendarTab = lazy(() => import('./pages/screener/CalendarTab'))
const FinderTab = lazy(() => import('./pages/screener/FinderTab'))
const PatternsTab = lazy(() => import('./pages/screener/PatternsTab'))
const StockDetailPage = lazy(() => import('./pages/StockDetailPage'))
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
            <ScreenerLayout />
          </Suspense>
        }>
          {/* 탭: 시장 · 테마 · 업종 · 일정 · 주도주(CANSLIM) · 조건검색. /screener 는 시장 탭으로 */}
          <Route index element={<Navigate to="market" replace />} />
          <Route path="market" element={<MarketTab />} />
          <Route path="themes" element={<GroupTab key="theme" kind="theme" />} />
          <Route path="sectors" element={<GroupTab key="sector" kind="sector" />} />
          <Route path="calendar" element={<CalendarTab />} />
          <Route path="leaders" element={<ScreenerPage />} />
          {/* 조건검색·패턴은 관리자 스위치(관리자 > 스크리너 설정)가 켜졌을 때만 — 꺼져 있으면 주도주로 */}
          <Route path="finder" element={<ScreenerFeatureGate feature="finder"><FinderTab /></ScreenerFeatureGate>} />
          <Route path="patterns" element={<ScreenerFeatureGate feature="patterns"><PatternsTab /></ScreenerFeatureGate>} />
          <Route path="*" element={<Navigate to="market" replace />} />
        </Route>
        <Route path="stock/:ticker" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <StockDetailPage />
          </Suspense>
        } />
        <Route path="auth/complete" element={<AuthCompletePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
