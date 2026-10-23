import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import RequireAuth from './components/RequireAuth'
import LoginPage from './pages/LoginPage'
import BoardsPage from './pages/BoardsPage'
import BlogListPage from './pages/BlogListPage'
import BlogEditorPage from './pages/BlogEditorPage'
import BlogDetailPage from './pages/BlogDetailPage'
import MembersPage from './pages/MembersPage'
import StatsPage from './pages/StatsPage'
import TradingGameCoach from './pages/TradingGameCoach'
import TradingGameSettings from './pages/TradingGameSettings'
import TradingGameAcademy from './pages/TradingGameAcademy'
import TradingGameQuizzes from './pages/TradingGameQuizzes'
import MarketThemes from './pages/MarketThemes'
import MarketStatus from './pages/MarketStatus'
import MarketVerify from './pages/MarketVerify'
import ScreenerSettings from './pages/ScreenerSettings'
import FundNoticesPage from './pages/FundNoticesPage'
import AppVersionsPage from './pages/AppVersionsPage'

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
        <Route index element={<Navigate to="/boards" replace />} />
        <Route path="boards" element={<BoardsPage />} />
        <Route path="blogs" element={<BlogListPage />} />
        <Route path="blogs/new" element={<BlogEditorPage />} />
        <Route path="blogs/:id" element={<BlogDetailPage />} />
        <Route path="blogs/:id/edit" element={<BlogEditorPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="game/coach" element={<TradingGameCoach />} />
        <Route path="game/settings" element={<TradingGameSettings />} />
        <Route path="game/academy" element={<TradingGameAcademy />} />
        <Route path="game/quizzes" element={<TradingGameQuizzes />} />
        <Route path="market/themes" element={<MarketThemes />} />
        <Route path="market/status" element={<MarketStatus />} />
        <Route path="market/verify" element={<MarketVerify />} />
        <Route path="market/screener" element={<ScreenerSettings />} />
        <Route path="fund-notices" element={<FundNoticesPage />} />
        <Route path="app/versions" element={<AppVersionsPage />} />
        <Route path="*" element={<Navigate to="/boards" replace />} />
      </Route>
    </Routes>
  )
}
