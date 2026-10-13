import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import AuthCompletePage from './pages/AuthCompletePage'
import HomePage from './pages/HomePage'
import PostListPage from './pages/PostListPage'
import PostDetailPage from './pages/PostDetailPage'

const GamePage = lazy(() => import('./pages/GamePage'))

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
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
