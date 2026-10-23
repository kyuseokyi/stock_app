import { Navigate } from 'react-router-dom'
import { useBoardStore } from '../store/boards'

// 커뮤니티(/community) — 첫 게시판으로 자동 이동 (없으면 안내). 홈(/)은 추천 글.
export default function CommunityPage() {
  const { boards, loaded, error } = useBoardStore()

  if (loaded && boards.length > 0) {
    return <Navigate to={`/boards/${boards[0].id}`} replace />
  }

  return (
    <div className="py-16 text-center">
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !loaded ? (
        <p className="text-ink-muted">불러오는 중…</p>
      ) : (
        <p className="text-ink-muted">표시할 게시판이 없습니다.</p>
      )}
    </div>
  )
}
