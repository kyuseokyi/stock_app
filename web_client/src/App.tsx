import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import LegacyMarketRedirect from './components/market/LegacyMarketRedirect'
import ScreenerFeatureGate from './components/screener/ScreenerFeatureGate'
import AuthCompletePage from './pages/AuthCompletePage'
import CommunityPage from './pages/CommunityPage'
import HomePage from './pages/HomePage'
import MyPage from './pages/MyPage'
import NotFoundPage from './pages/NotFoundPage'
import PostListPage from './pages/PostListPage'
import PostDetailPage from './pages/PostDetailPage'

const GamePage = lazy(() => import('./pages/GamePage'))
const ScreenerLayout = lazy(() => import('./pages/screener/ScreenerLayout'))
const ScreenerPage = lazy(() => import('./pages/ScreenerPage'))
const MarketLayout = lazy(() => import('./pages/market/MarketLayout'))
const OverviewTab = lazy(() => import('./pages/market/OverviewTab'))
const GroupTab = lazy(() => import('./pages/market/GroupTab'))
const CalendarTab = lazy(() => import('./pages/market/CalendarTab'))
const FinderTab = lazy(() => import('./pages/screener/FinderTab'))
const PatternsTab = lazy(() => import('./pages/screener/PatternsTab'))
const StockDetailPage = lazy(() => import('./pages/StockDetailPage'))
const FundListPage = lazy(() => import('./pages/FundListPage'))
const FundReportPage = lazy(() => import('./pages/FundReportPage'))
const BlockedUsersPage = lazy(() => import('./pages/BlockedUsersPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const AccountDeletionPage = lazy(() => import('./pages/AccountDeletionPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
const SupportPage = lazy(() => import('./pages/SupportPage'))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        {/* 메뉴: 홈(/) · 마켓(/market) · 스크리너(/screener, 종목 찾기 스위치가 켜졌을 때만) · 커뮤니티(/community → 첫 게시판) · 게임(/game) · 내정보(/me) */}
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
        <Route path="me/blocks" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <BlockedUsersPage />
          </Suspense>
        } />
        <Route path="boards/:boardId" element={<PostListPage />} />
        <Route path="posts/:id" element={<PostDetailPage />} />
        <Route path="game" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <GamePage />
          </Suspense>
        } />
        <Route path="market" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <MarketLayout />
          </Suspense>
        }>
          {/* 칩: 개요 · 테마 · 업종 · 일정 */}
          <Route index element={<OverviewTab />} />
          <Route path="themes" element={<GroupTab key="theme" kind="theme" />} />
          <Route path="sectors" element={<GroupTab key="sector" kind="sector" />} />
          <Route path="calendar" element={<CalendarTab />} />
          <Route path="*" element={<Navigate to="/market" replace />} />
        </Route>
        {/* 스크리너에서 옮긴 화면의 옛 주소 — 스위치와 무관하게 새 주소로(쿼리·해시 유지) */}
        <Route path="screener/market/*" element={<LegacyMarketRedirect />} />
        <Route path="screener/themes/*" element={<LegacyMarketRedirect />} />
        <Route path="screener/sectors/*" element={<LegacyMarketRedirect />} />
        <Route path="screener/calendar/*" element={<LegacyMarketRedirect />} />
        <Route path="screener" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <ScreenerLayout />
          </Suspense>
        }>
          {/* 탭: 주도주(CANSLIM) · 조건검색 · 패턴. /screener 는 주도주로.
              스크리너 전체는 관리자 스위치 '종목 찾기(사용자 화면)'가 켜졌을 때만 — 꺼져 있으면 ScreenerLayout 이 마켓으로 보낸다.
              조건검색·패턴은 각자 스위치도 켜져야 하고, 그 탭만 꺼져 있으면 주도주로(관리자 > 스크리너 설정) */}
          <Route index element={<Navigate to="leaders" replace />} />
          <Route path="leaders" element={<ScreenerFeatureGate feature="leaders"><ScreenerPage /></ScreenerFeatureGate>} />
          <Route path="finder" element={<ScreenerFeatureGate feature="finder"><FinderTab /></ScreenerFeatureGate>} />
          <Route path="patterns" element={<ScreenerFeatureGate feature="patterns"><PatternsTab /></ScreenerFeatureGate>} />
          <Route path="*" element={<Navigate to="/screener/leaders" replace />} />
        </Route>
        <Route path="stock/:ticker" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <StockDetailPage />
          </Suspense>
        } />
        <Route path="auth/complete" element={<AuthCompletePage />} />
        {/* 공개 정책 문서 — 로그인 없이 열리고, 스토어·소셜 검수와 앱 내정보 링크가 이 주소를 쓴다 */}
        <Route path="privacy" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <PrivacyPage />
          </Suspense>
        } />
        <Route path="account-deletion" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <AccountDeletionPage />
          </Suspense>
        } />
        <Route path="terms" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <TermsPage />
          </Suspense>
        } />
        <Route path="support" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <SupportPage />
          </Suspense>
        } />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
