import { useState } from 'react'
import Card from '../ui/Card'
import type { Coach } from '../../types/game'

// 오늘의 코치 한 줄 요약. 본문(content_md)이 있으면 펼쳐서 제목·본문을 텍스트로 표시(마크다운 렌더 없음).
export default function CoachBanner({ coach }: { coach: Coach | null }) {
  const [open, setOpen] = useState(false)
  if (!coach) return null
  const expandable = coach.content_md !== null && coach.content_md !== ''

  return (
    <Card className="bg-sky-soft">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className="flex w-full items-start gap-2 text-left"
      >
        <span>{coach.coach_type === 'EVENING' ? '🌙' : '🌅'}</span>
        <span className="flex-1 text-sm text-ink">
          <span className="font-semibold">오늘의 코치</span> “{coach.summary_nudge}”
        </span>
        {expandable && <span className="text-ink-muted">{open ? '▲' : '▼'}</span>}
      </button>
      {open && expandable && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="font-semibold text-ink">{coach.title}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink">{coach.content_md}</p>
        </div>
      )}
    </Card>
  )
}
