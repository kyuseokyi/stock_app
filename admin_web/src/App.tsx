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
        <Route path="*" element={<Navigate to="/boards" replace />} />
      </Route>
    </Routes>
  )
}
