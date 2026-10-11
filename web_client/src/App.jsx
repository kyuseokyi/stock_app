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
