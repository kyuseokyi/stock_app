import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { listBoards } from '../api/boards'
import { createBlog, getBlog, updateBlog } from '../api/blogs'
import RichTextEditor from '../components/RichTextEditor'

export default function BlogEditorPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [boards, setBoards] = useState([])
  const [form, setForm] = useState({ board_id: '', title: '', content: '' })
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listBoards().then(setBoards).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isEdit) return
    getBlog(id)
      .then((p) =>
        setForm({ board_id: p.board_id, title: p.title, content: p.content }),
      )
      .catch(() => setError('게시글을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.board_id) return setError('게시판을 선택하세요.')
    if (!form.title.trim()) return setError('제목을 입력하세요.')
    setSaving(true)
    try {
      const payload = {
        board_id: Number(form.board_id),
        title: form.title.trim(),
        content: form.content,
      }
      if (isEdit) {
        await updateBlog(id, payload)
      } else {
        await createBlog(payload)
      }
      navigate('/blogs')
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-slate-400">불러오는 중…</p>
  }

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">
        {isEdit ? '게시글 수정' : '새 게시글 작성'}
      </h2>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
      )}

      <form
        onSubmit={onSubmit}
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-6"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">게시판</label>
          <select
            value={form.board_id}
            onChange={setField('board_id')}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">게시판 선택</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">제목</label>
          <input
            value={form.title}
            onChange={setField('title')}
            placeholder="제목을 입력하세요"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">
            내용
          </label>
          <RichTextEditor
            value={form.content}
            onChange={(html) => setForm((f) => ({ ...f, content: html }))}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate('/blogs')}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </div>
  )
}
