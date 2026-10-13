import { useEffect, useRef, useState } from 'react'

interface Props {
  nickname: string | null
  onLogout: () => void
  onDeleteAccount: () => void
}

// 헤더 "{닉네임} 님" 드롭다운(로그아웃 · 회원 탈퇴). 바깥 클릭·Escape 로 닫힘.
export default function UserMenu({ nickname, onLogout, onDeleteAccount }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div ref={rootRef} className="relative text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-field px-2 py-1 text-ink-muted hover:bg-fill"
      >
        <span>
          <span className="font-medium text-ink">{nickname}</span> 님
        </span>
        <span aria-hidden className={`text-xs transition ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-32 overflow-hidden rounded-field border border-line bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={choose(onLogout)}
            className="block w-full px-3 py-2 text-left text-ink hover:bg-fill"
          >
            로그아웃
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={choose(onDeleteAccount)}
            className="block w-full px-3 py-2 text-left text-ink-muted hover:bg-fill"
          >
            회원 탈퇴
          </button>
        </div>
      )}
    </div>
  )
}
