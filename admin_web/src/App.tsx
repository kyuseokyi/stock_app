import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import RequirePermission from './components/RequirePermission'
import { firstAllowedPath, NAV_PERMS } from './lib/navPermissions'
import { useMeStore } from './store/me'
import LoginPage from './pages/LoginPage'
import BoardsPage from './pages/BoardsPage'
import BlogListPage from './pages/BlogListPage'
import BlogEditorPage from './pages/BlogEditorPage'
import BlogDetailPage from './pages/BlogDetailPage'
import MembersPage from './pages/MembersPage'
import CommentReportsPage from './pages/CommentReportsPage'
import ChartPostsAuditPage from './pages/ChartPostsAuditPage'
import StatsPage from './pages/StatsPage'
import TradingGameCoach from './pages/TradingGameCoach'
import TradingGameSettings from './pages/TradingGameSettings'
import TradingGameAcademy from './pages/TradingGameAcademy'
import TradingGameQuizzes from './pages/TradingGameQuizzes'
import MarketThemes from './pages/MarketThemes'
import MarketDailySurge from './pages/MarketDailySurge'
import MarketStatus from './pages/MarketStatus'
import MarketVerify from './pages/MarketVerify'
import MarketLeaders from './pages/MarketLeaders'
import MarketMaScreener from './pages/MarketMaScreener'
import MarketFinder from './pages/MarketFinder'
import MarketPatterns from './pages/MarketPatterns'
import ScreenerSettings from './pages/ScreenerSettings'
import FundNoticesPage from './pages/FundNoticesPage'
import AppVersionsPage from './pages/AppVersionsPage'
import AdSettingsPage from './pages/AdSettingsPage'
import AdminAccountsPage from './pages/AdminAccountsPage'
import ChangePasswordPage from './pages/ChangePasswordPage'

// 첫 화면 — 권한 있는 첫 메뉴로(에디터·분석 관리자가 🔒 화면부터 보지 않게)
function HomeRedirect() {
  const user = useMeStore((s) => s.user)
  return <Navigate to={firstAllowedPath(user)} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="boards" element={<RequirePermission perms={NAV_PERMS['/boards'] ?? []}><BoardsPage /></RequirePermission>} />
        <Route path="blogs" element={<RequirePermission perms={NAV_PERMS['/blogs'] ?? []}><BlogListPage /></RequirePermission>} />
        <Route path="blogs/new" element={<RequirePermission perms={NAV_PERMS['/blogs'] ?? []}><BlogEditorPage /></RequirePermission>} />
        <Route path="blogs/:id" element={<RequirePermission perms={NAV_PERMS['/blogs'] ?? []}><BlogDetailPage /></RequirePermission>} />
        <Route path="blogs/:id/edit" element={<RequirePermission perms={NAV_PERMS['/blogs'] ?? []}><BlogEditorPage /></RequirePermission>} />
        <Route path="members" element={<RequirePermission perms={NAV_PERMS['/members'] ?? []}><MembersPage /></RequirePermission>} />
        <Route path="reports" element={<RequirePermission perms={NAV_PERMS['/reports'] ?? []}><CommentReportsPage /></RequirePermission>} />
        <Route path="blog-chart-audit" element={<RequirePermission perms={NAV_PERMS['/blog-chart-audit'] ?? []}><ChartPostsAuditPage /></RequirePermission>} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="game/coach" element={<RequirePermission perms={NAV_PERMS['/game/coach'] ?? []}><TradingGameCoach /></RequirePermission>} />
        <Route path="game/settings" element={<RequirePermission perms={NAV_PERMS['/game/settings'] ?? []}><TradingGameSettings /></RequirePermission>} />
        <Route path="game/academy" element={<RequirePermission perms={NAV_PERMS['/game/academy'] ?? []}><TradingGameAcademy /></RequirePermission>} />
        <Route path="game/quizzes" element={<RequirePermission perms={NAV_PERMS['/game/quizzes'] ?? []}><TradingGameQuizzes /></RequirePermission>} />
        <Route path="market/daily-surge" element={<RequirePermission perms={NAV_PERMS['/market/daily-surge'] ?? []}><MarketDailySurge /></RequirePermission>} />
        <Route path="market/themes" element={<RequirePermission perms={NAV_PERMS['/market/themes'] ?? []}><MarketThemes /></RequirePermission>} />
        <Route path="market/status" element={<RequirePermission perms={NAV_PERMS['/market/status'] ?? []}><MarketStatus /></RequirePermission>} />
        <Route path="market/verify" element={<RequirePermission perms={NAV_PERMS['/market/verify'] ?? []}><MarketVerify /></RequirePermission>} />
        <Route path="market/leaders" element={<RequirePermission perms={NAV_PERMS['/market/leaders'] ?? []}><MarketLeaders /></RequirePermission>} />
        <Route path="market/ma-screener" element={<RequirePermission perms={NAV_PERMS['/market/ma-screener'] ?? []}><MarketMaScreener /></RequirePermission>} />
        <Route path="market/finder" element={<RequirePermission perms={NAV_PERMS['/market/finder'] ?? []}><MarketFinder /></RequirePermission>} />
        <Route path="market/patterns" element={<RequirePermission perms={NAV_PERMS['/market/patterns'] ?? []}><MarketPatterns /></RequirePermission>} />
        <Route path="market/screener" element={<RequirePermission perms={NAV_PERMS['/market/screener'] ?? []}><ScreenerSettings /></RequirePermission>} />
        <Route path="fund-notices" element={<RequirePermission perms={NAV_PERMS['/fund-notices'] ?? []}><FundNoticesPage /></RequirePermission>} />
        <Route path="app/versions" element={<RequirePermission perms={NAV_PERMS['/app/versions'] ?? []}><AppVersionsPage /></RequirePermission>} />
        <Route path="app/ads" element={<RequirePermission perms={NAV_PERMS['/app/ads'] ?? []}><AdSettingsPage /></RequirePermission>} />
        <Route path="admins" element={<AdminAccountsPage />} />
        <Route path="account/password" element={<ChangePasswordPage />} />
        <Route path="*" element={<HomeRedirect />} />
      </Route>
    </Routes>
  )
}
