import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { login } from '../api/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/boards'

  const [email, setEmail] = useState('admin@stock.app')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      if (!err.response) {
        // 응답 자체가 없음 = 백엔드 미실행/CORS/네트워크 문제
        setError(
          '백엔드 서버에 연결할 수 없습니다. uvicorn(apps.blog.main:app)이 실행 중인지 확인하세요.',
        )
      } else if (err.response.status === 401) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      } else {
        setError(`로그인 실패 (HTTP ${err.response.status})`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-center text-xl font-bold text-slate-900">
          📈 StockApp <span className="text-indigo-600">Admin</span>
        </h1>
        <p className="mb-6 text-center text-sm text-slate-400">관리자 로그인</p>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              이메일
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          기본 계정: admin@stock.app / admin1234
        </p>
      </div>
    </div>
  )
}
