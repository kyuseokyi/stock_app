import { useId, useState, type ReactNode } from 'react'

// 필터 묶음 — 모바일(sm 미만)에서는 '필터 · n개 적용' 버튼으로 접고, 넓은 화면은 늘 펼친다.
// 필터 3~4줄이 목록을 화면 아래로 밀어내던 문제(주도주·패턴).
export default function FilterPanel({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between text-sm font-semibold text-ink sm:hidden"
      >
        <span>
          필터{activeCount > 0 && <span className="ml-1.5 font-medium text-brand-strong">· {activeCount}개 적용</span>}
        </span>
        <svg viewBox="0 0 24 24" className={`h-5 w-5 text-ink-muted transition ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div id={id} className={open ? 'mt-2' : 'hidden sm:block'}>
        {children}
      </div>
    </div>
  )
}
