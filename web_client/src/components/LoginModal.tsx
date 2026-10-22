import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { getSocialProviders, socialStartUrl } from '../api/auth'
import { ENABLE_GUEST_LOGIN } from '../config'
import { errorCode, withErrorCode } from '../lib/errorCode'
import { prepareSocialVerifier, rememberLoginReturn } from '../lib/socialLogin'
import { useAuthStore } from '../store/auth'
import type { SocialProvider, SocialProviders } from '../types/api'
import Modal from './ui/Modal'

interface LoginModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

type ProvidersState =
  | { status: 'loading' }
  | { status: 'ready'; providers: SocialProviders }
  | { status: 'error'; code: string }

const SOCIAL_BUTTONS: { provider: SocialProvider; label: string; className: string }[] = [
  { provider: 'kakao', label: '카카오로 시작하기', className: 'bg-kakao text-black' },
  { provider: 'naver', label: '네이버로 시작하기', className: 'bg-naver text-white' },
]

// 로그인 모달 — 카카오·네이버 간편 로그인 + (개발용) 닉네임 로그인
// 공용 Modal(z-50 층) 위에 올려 대화상자 역할·ESC·포커스 가두기/복원·스크롤 잠금을 그대로 쓴다.
export default function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {
  if (!open) return null
  return <LoginDialog onClose={onClose} onSuccess={onSuccess} />
}

// 열릴 때만 마운트 — 닫으면 입력·오류·조회 상태가 함께 정리된다
function LoginDialog({ onClose, onSuccess }: Omit<LoginModalProps, 'open'>) {
  const login = useAuthStore((s) => s.login)
  const nicknameId = useId()
  const nicknameErrorId = useId()
  const nicknameRef = useRef<HTMLInputElement>(null)
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [socialError, setSocialError] = useState('')
  // 공급자 페이지로 이동을 시작한 버튼 — 연속 클릭으로 인증 코드를 두 번 만들지 않게 막는다
  const [starting, setStarting] = useState<SocialProvider | null>(null)
  const [providersState, setProvidersState] = useState<ProvidersState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0) // '다시 시도' 누를 때마다 공급자 재조회

  // 공급자 활성 여부 조회(키 미설정 공급자는 버튼 숨김)
  useEffect(() => {
    let alive = true
    getSocialProviders()
      .then((providers) => {
        if (alive) setProvidersState({ status: 'ready', providers })
      })
      .catch((err) => {
        if (alive) setProvidersState({ status: 'error', code: errorCode(err) })
      })
    return () => {
      alive = false
    }
  }, [attempt])

  // 공급자 페이지에서 '뒤로'로 돌아오면 브라우저가 이 화면을 그대로 복원(bfcache)한다 — 이동 중 상태를 풀어 다시 누를 수 있게
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setStarting(null)
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const visibleSocial =
    providersState.status === 'ready'
      ? SOCIAL_BUTTONS.filter((b) => providersState.providers[b.provider])
      : []
  const noOptions = providersState.status === 'ready' && visibleSocial.length === 0 && !ENABLE_GUEST_LOGIN

  const startSocial = async (provider: SocialProvider) => {
    if (starting) return
    setSocialError('')
    setStarting(provider)
    let cc: string
    try {
      cc = await prepareSocialVerifier()
    } catch {
      // verifier 를 보관할 수 없으면(저장소 차단·비보안 컨텍스트) 완료 후 교환이 불가 — 이동하지 않는다
      setStarting(null)
      setSocialError('이 브라우저에서는 간편 로그인을 시작할 수 없어요. 설정을 확인해 주세요.')
      return
    }
    rememberLoginReturn()
    window.location.assign(socialStartUrl(provider, cc))
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (loading) return
    const nick = nickname.trim()
    if (!nick) {
      setError('닉네임을 입력해 주세요.')
      nicknameRef.current?.focus() // 고칠 곳으로 바로 이동
      return
    }
    setLoading(true)
    setError('')
    try {
      await login(nick)
      setNickname('')
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(withErrorCode('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.', err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="로그인" description="간편 로그인으로 댓글·게임에 참여하세요." onClose={onClose} layer="top" narrow>
      <div className="space-y-2" aria-busy={providersState.status === 'loading'}>
        {providersState.status === 'loading' && (
          <p role="status" className="py-2 text-center text-sm text-ink-muted">
            로그인 방법을 불러오고 있어요
          </p>
        )}
        {visibleSocial.map((b) => (
          <button
            key={b.provider}
            type="button"
            onClick={() => void startSocial(b.provider)}
            disabled={starting !== null}
            aria-busy={starting === b.provider}
            className={`h-11 w-full rounded-btn text-sm font-semibold transition hover:brightness-95 disabled:cursor-wait disabled:opacity-70 ${b.className}`}
          >
            {starting === b.provider ? '이동하고 있어요…' : b.label}
          </button>
        ))}
        {socialError && (
          <p role="alert" className="text-center text-sm text-up">
            {socialError}
          </p>
        )}
        {/* 공급자 조회 실패는 닉네임 로그인이 있어도 보인다 — 오류 코드로 원인 확인용 */}
        {providersState.status === 'error' && (
          <div role="alert" className="rounded-field bg-fill px-3 py-3 text-center">
            <p className="text-sm text-up">로그인 서버에 연결할 수 없어요. (오류: {providersState.code})</p>
            <button
              type="button"
              onClick={() => {
                setProvidersState({ status: 'loading' })
                setAttempt((n) => n + 1)
              }}
              className="mt-2 inline-flex h-11 items-center rounded-btn px-4 text-sm font-semibold text-brand-strong hover:bg-surface"
            >
              다시 시도
            </button>
          </div>
        )}
        {noOptions && (
          <p role="status" className="py-2 text-center text-sm text-ink-muted">
            로그인을 준비하고 있어요.
          </p>
        )}
      </div>

      {ENABLE_GUEST_LOGIN && (
        <form onSubmit={submit} noValidate className="mt-5 border-t border-line pt-4">
          <label htmlFor={nicknameId} className="mb-2 block text-xs text-ink-muted">
            개발용 닉네임 로그인
          </label>
          <input
            id={nicknameId}
            ref={nicknameRef}
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value)
              if (error) setError('')
            }}
            maxLength={20}
            autoComplete="nickname"
            enterKeyHint="go"
            placeholder="닉네임 (예: 주린이)"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? nicknameErrorId : undefined}
            // 모바일은 16px — iOS 가 16px 미만 입력창에 포커스하면 화면을 확대한다
            className="w-full rounded-field border border-line bg-fill px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none aria-[invalid=true]:border-up sm:text-sm"
          />
          {error && (
            <p id={nicknameErrorId} role="alert" className="mt-2 break-words text-sm text-up">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-3 h-11 w-full rounded-btn bg-brand px-4 text-sm font-semibold text-ink hover:brightness-95 disabled:cursor-wait disabled:opacity-50"
          >
            {loading ? '로그인하고 있어요…' : '닉네임으로 시작'}
          </button>
        </form>
      )}
    </Modal>
  )
}
