import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeSocialCode } from '../api/auth'
import EmptyState from '../components/ui/EmptyState'
import { socialErrorMessage, takeLoginReturn, takeSocialVerifier } from '../lib/socialLogin'
import { useAuthStore } from '../store/auth'

const INVALID_ACCESS = '잘못된 접근이에요. 다시 로그인해 주세요.'

// 간편 로그인 완료 라우트(/auth/complete) — auth 콜백이 ?code=교환코드 또는 ?error=코드 로 보낸다.
export default function AuthCompletePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const loginWithToken = useAuthStore((s) => s.loginWithToken)
  const code = params.get('code')
  const errorCode = params.get('error')
  const [exchangeError, setExchangeError] = useState<string | null>(null)
  // 교환 코드는 1회용 — React StrictMode 의 effect 이중 실행에서 두 번째 교환(401)을 막는다
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    if (!code || errorCode) {
      takeSocialVerifier() // 실패 복귀 — 남은 verifier 정리
      return
    }
    startedRef.current = true
    // verifier 는 이 effect(1회 가드) 안에서만 꺼낸다 — 렌더 중에 꺼내면 StrictMode 이중 실행에서 사라진다
    const verifier = takeSocialVerifier()
    if (!verifier) {
      setExchangeError(INVALID_ACCESS)
      return
    }
    exchangeSocialCode(code, verifier)
      .then((res) => {
        loginWithToken(res)
        navigate(takeLoginReturn(), { replace: true })
      })
      .catch((err: unknown) => {
        const inactive = axios.isAxiosError(err) && err.response?.status === 403
        setExchangeError(socialErrorMessage(inactive ? 'inactive' : 'state_invalid'))
      })
  }, [code, errorCode, loginWithToken, navigate])

  const message = errorCode
    ? socialErrorMessage(errorCode)
    : (exchangeError ?? (code ? null : INVALID_ACCESS))

  if (!message) return <p className="py-16 text-center text-ink-muted">로그인 중…</p>

  const cancelled = errorCode === 'cancelled'
  return (
    <EmptyState
      emoji={cancelled ? '👋' : '🔒'}
      title={cancelled ? '로그인을 취소했어요' : '로그인하지 못했어요'}
      description={message}
      action={
        <Link
          to="/"
          replace
          className="inline-flex h-11 items-center justify-center rounded-btn bg-brand px-4 text-sm font-semibold text-white hover:brightness-95"
        >
          홈으로
        </Link>
      }
    />
  )
}
