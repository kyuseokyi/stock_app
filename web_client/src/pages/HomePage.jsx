import { Navigate } from 'react-router-dom'
import { useBoardStore } from '../store/boards'

// 첫 게시판으로 자동 이동 (없으면 안내)
export default function HomePage() {
  const { boards, loaded, error } = useBoardStore()

  if (loaded && boards.length > 0) {
    return <Navigate to={`/boards/${boards[0].id}`} replace />
  }

  return (
    <div className="py-16 text-center">
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !loaded ? (
        <p className="text-slate-400">불러오는 중…</p>
      ) : (
        <p className="text-slate-400">표시할 게시판이 없습니다.</p>
      )}
    </div>
  )
}
