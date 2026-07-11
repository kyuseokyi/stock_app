import { useEffect, useState } from 'react'
import { createBoard, deleteBoard, listBoards, updateBoard } from '../api/boards'

export default function BoardsPage() {
  const [boards, setBoards] = useState([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setBoards(await listBoards())
    } catch (e) {
      setError('게시판 목록을 불러오지 못했습니다. 백엔드가 실행 중인지 확인하세요.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const onCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await createBoard({ name: name.trim(), order_index: boards.length + 1 })
      setName('')
      load()
    } catch {
      setError('게시판 생성에 실패했습니다.')
    }
  }

  const onDelete = async (id) => {
    if (!confirm('이 게시판을 삭제할까요? (하위 게시글도 함께 삭제됩니다)')) return
    try {
      await deleteBoard(id)
      load()
    } catch {
      setError('삭제에 실패했습니다.')
    }
  }

  const onToggleComments = async (board) => {
    try {
      await updateBoard(board.id, { comments_enabled: !board.comments_enabled })
      load()
    } catch {
      setError('댓글 설정 변경에 실패했습니다.')
    }
  }

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">게시판 관리</h2>

      <form
        onSubmit={onCreate}
        className="mb-6 flex gap-2 rounded-xl border border-slate-200 bg-white p-4"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="새 게시판 이름 (예: 공지사항)"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + 추가
        </button>
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">이름</th>
              <th className="px-4 py-3 font-medium">순서</th>
              <th className="px-4 py-3 font-medium">활성</th>
              <th className="px-4 py-3 font-medium">댓글</th>
              <th className="px-4 py-3 text-right font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  불러오는 중…
                </td>
              </tr>
            ) : boards.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  게시판이 없습니다. 위에서 추가해 보세요.
                </td>
              </tr>
            ) : (
              boards.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-400">{b.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{b.name}</td>
                  <td className="px-4 py-3">{b.order_index}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        b.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {b.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onToggleComments(b)}
                      role="switch"
                      aria-checked={b.comments_enabled}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                        b.comments_enabled ? 'bg-indigo-600' : 'bg-slate-300'
                      }`}
                      title={b.comments_enabled ? '댓글 허용됨 (클릭해 끄기)' : '댓글 비활성 (클릭해 켜기)'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          b.comments_enabled ? 'translate-x-4' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onDelete(b.id)}
                      className="text-sm font-medium text-red-500 hover:text-red-700"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
