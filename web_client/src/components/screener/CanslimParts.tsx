import { letterBadgeClass, letterStatusText } from '../../lib/canslim'
import type { CanslimHistoryPoint, CanslimLetter } from '../../types/screener'

// 주도주(CANSLIM) 상세 조각 — 스크리너 상세 패널(CanslimDetail)과 종목 상세 화면(StockDetailPage)이 같이 쓴다.

// 점수 추이(최근 60거래일) — 작은 선 그래프. 하루뿐이면 숨김.
export function ScoreHistory({ history }: { history: CanslimHistoryPoint[] }) {
  if (history.length < 2) return null
  const w = 240
  const h = 40
  const pts = history.map((p, i) => `${(i / (history.length - 1)) * w},${h - (p.score / 100) * h}`).join(' ')
  const first = history[0]
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-ink-muted">
        <span>점수 추이 · 최근 {history.length}거래일</span>
        <span>{first.date} {first.score}점 → {history[history.length - 1].score}점</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-brand-strong" />
      </svg>
    </div>
  )
}

// 7항목 점수표 — 통과 여부·근거·기준·설명
export function LetterList({ letters }: { letters: CanslimLetter[] }) {
  return (
    <ul className="space-y-2">
      {letters.map((l) => (
        <li key={l.key} className="flex gap-3 rounded-btn bg-fill/50 p-3">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-bold ${letterBadgeClass(l.status)}`}>
            {l.key.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-bold text-ink">{l.label}</span>
              <span className="text-xs text-ink-muted">{letterStatusText(l.status)}</span>
            </div>
            <p className="text-sm text-ink">{l.display}</p>
            <p className="mt-0.5 text-xs text-ink-muted">{l.explanation} 기준: {l.threshold}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
