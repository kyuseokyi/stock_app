import type { ReactNode } from 'react'

// 카드 안 작은 묶음 제목 + 본문
export default function Section({ title, aside, children, label }: {
  title: ReactNode; aside?: ReactNode; children: ReactNode; label?: string
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={label}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {aside && <span className="text-xs text-ink-muted">{aside}</span>}
      </div>
      {children}
    </section>
  )
}
