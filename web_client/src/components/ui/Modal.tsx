import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  /** 'top' = z-50 — 다른 모달 위에서도 열리는 로그인 창용 */
  layer?: 'default' | 'top'
  /** sm 이상에서 좁은 창(max-w-sm) */
  narrow?: boolean
  /** 제목 아래 짧은 안내(aria-describedby 로 연결) */
  description?: ReactNode
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'

// 공용 모달 — 부모가 열 때만 마운트한다(닫으면 언마운트 → 내부 state·타이머 자동 정리).
// 모바일: 하단 시트 / sm 이상: 중앙. ESC·바깥 클릭으로 닫힘. 열린 동안 body 스크롤 잠금.
// z-40: 로그인 모달(z-50)보다 아래, 게임 토스트(z-40)는 DOM 상 뒤에 렌더돼 모달 위에 보인다.
export default function Modal({ title, onClose, children, layer = 'default', narrow = false, description }: ModalProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const backdropRef = useRef<HTMLDivElement>(null)
  const downTargetRef = useRef<EventTarget | null>(null) // 드래그 오닫힘 방지: mousedown 시작 지점

  useEffect(() => {
    // 열기 직전 포커스를 저장했다가 닫힐 때 복원
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      // 간단 포커스 트랩 — 패널 안 첫/마지막 포커스 가능 요소 사이에서 순환
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        panelRef.current.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus()
    }
  }, [])

  return (
    <div
      ref={backdropRef}
      // !m-0: 부모가 space-y-* 면 형제 margin-top 이 fixed 백드롭에도 붙어 상단이 비므로 강제로 0
      className={`fixed inset-0 ${layer === 'top' ? 'z-50' : 'z-40'} !m-0 flex items-end justify-center bg-black/40 sm:items-center sm:p-4`}
      onMouseDown={(e) => {
        downTargetRef.current = e.target
      }}
      onClick={(e) => {
        // 누른 곳과 뗀 곳이 모두 바깥(백드롭)일 때만 닫는다
        if (downTargetRef.current === backdropRef.current && e.target === backdropRef.current) onClose()
        downTargetRef.current = null
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`flex max-h-[85vh] w-full flex-col rounded-t-card bg-canvas shadow-xl outline-none sm:rounded-card ${
          narrow ? 'sm:max-w-sm' : 'sm:max-w-lg'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="min-w-0 text-lg font-bold text-ink">
              {title}
            </h2>
            {/* 닫기 — 44px 터치 영역, 오른쪽 끝을 제목 줄에 맞춘다 */}
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-fill hover:text-ink"
              aria-label="닫기"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {description && (
            <p id={descId} className="mt-0.5 text-sm text-ink-muted">
              {description}
            </p>
          )}
        </div>
        {/* 하단 시트일 때 iPhone 홈 막대에 마지막 버튼이 겹치지 않게 safe-area 만큼 아래 여백 */}
        <div className="overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:pb-4">{children}</div>
      </div>
    </div>
  )
}
