import { type FormEvent, useEffect, useState } from 'react'
import { getSocialProviders, socialStartUrl } from '../api/auth'
import { ENABLE_GUEST_LOGIN } from '../config'
import { prepareSocialVerifier, rememberLoginReturn } from '../lib/socialLogin'
import { useAuthStore } from '../store/auth'
import type { SocialProvider, SocialProviders } from '../types/api'

interface LoginModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

type ProvidersState = { status: 'loading' } | { status: 'ready'; providers: SocialProviders } | { status: 'error' }

const SOCIAL_BUTTONS: { provider: SocialProvider; label: string; className: string }[] = [
  { provider: 'kakao', label: '카카오로 시작하기', className: 'bg-kakao text-black' },
  { provider: 'naver', label: '네이버로 시작하기', className: 'bg-naver text-white' },
]

// 로그인 모달 — 카카오·네이버 간편 로그인 + (개발용) 닉네임 로그인
export default function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {
  const login = useAuthStore((s) => s.login)
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [socialError, setSocialError] = useState('')
  const [providersState, setProvidersState] = useState<ProvidersState>({ status: 'loading' })

  // 열릴 때마다 공급자 활성 여부 조회(키 미설정 공급자는 버튼 숨김)
  useEffect(() => {
    if (!open) return
    let alive = true
    setProvidersState({ status: 'loading' })
    getSocialProviders()
      .then((providers) => {
        if (alive) setProvidersState({ status: 'ready', providers })
      })
      .catch(() => {
        if (alive) setProvidersState({ status: 'error' })
      })
    return () => {
      alive = false
    }
  }, [open])

  if (!open) return null

  const visibleSocial =
    providersState.status === 'ready'
      ? SOCIAL_BUTTONS.filter((b) => providersState.providers[b.provider])
      : []
  const noOptions = providersState.status !== 'loading' && visibleSocial.length === 0 && !ENABLE_GUEST_LOGIN

  const startSocial = async (provider: SocialProvider) => {
    setSocialError('')
    let cc: string
    try {
      cc = await prepareSocialVerifier()
    } catch {
      // verifier 를 보관할 수 없으면(저장소 차단·비보안 컨텍스트) 완료 후 교환이 불가 — 이동하지 않는다
      setSocialError('이 브라우저에서는 간편 로그인을 시작할 수 없어요. 설정을 확인해 주세요.')
      return
    }
    rememberLoginReturn()
    window.location.assign(socialStartUrl(provider, cc))
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const nick = nickname.trim()
    if (!nick) {
      setError('닉네임을 입력하세요.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await login(nick)
      setNickname('')
      onSuccess?.()
      onClose()
    } catch {
      setError('로그인에 실패했습니다. (auth 서버 8001 확인)')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-card bg-canvas p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">로그인</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-muted">간편 로그인으로 댓글·게임에 참여하세요.</p>

        <div className="space-y-2">
          {providersState.status === 'loading' && (
            <p className="py-2 text-center text-sm text-ink-muted">불러오는 중…</p>
          )}
          {visibleSocial.map((b) => (
            <button
              key={b.provider}
              type="button"
              onClick={() => void startSocial(b.provider)}
              className={`h-11 w-full rounded-btn text-sm font-semibold transition hover:brightness-95 ${b.className}`}
            >
              {b.label}
            </button>
          ))}
          {socialError && <p className="text-center text-sm text-up">{socialError}</p>}
          {noOptions && (
            <p className="py-2 text-center text-sm text-ink-muted">
              {providersState.status === 'error'
                ? '로그인 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
                : '로그인을 준비하고 있어요.'}
            </p>
          )}
        </div>

        {ENABLE_GUEST_LOGIN && (
          <form onSubmit={submit} className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-xs text-ink-muted">개발용 닉네임 로그인</p>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
              placeholder="닉네임 (예: 주린이)"
              className="w-full rounded-field border border-line bg-fill px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            {error && <p className="mt-2 text-sm text-up">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="mt-3 w-full rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
            >
              {loading ? '로그인 중…' : '닉네임으로 시작'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
