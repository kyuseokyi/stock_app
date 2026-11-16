import { useEffect, useMemo, useState } from 'react'
import { getLending } from '../../api/lending'
import { formatPct } from '../../lib/format'
import { formatShares, LENDING_NOTE, lendingView } from '../../lib/lending'
import type { LendingPoint } from '../../types/lending'
import Card from '../ui/Card'

// 종목 상세 '대차잔고' — 잔고 주수 선 + 일별 증감 막대(점수 추이와 같은 SVG 미니 그래프).
// 데이터가 없거나(개발 서버 — 키움 키 없음) 불러오기에 실패하면 섹션 전체를 숨긴다.
export default function LendingSection({ ticker }: { ticker: string }) {
  const [points, setPoints] = useState<LendingPoint[]>([])

  useEffect(() => {
    let cancelled = false
    setPoints([])
    getLending(ticker)
      .then((rows) => !cancelled && setPoints(rows))
      .catch(() => undefined) // 실패면 숨김 그대로
    return () => {
      cancelled = true
    }
  }, [ticker])

  const view = useMemo(() => lendingView(points), [points])
  if (!view) return null
  const { first, last, chgPct } = view

  return (
    <Card as="section" aria-label="대차잔고" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold text-ink">대차잔고</h2>
        <span className="text-xs text-ink-muted tabular-nums">{last.date} 기준</span>
      </div>
      <p className="text-sm text-ink tabular-nums">
        잔고 <span className="font-semibold">{formatShares(last.balanceQty)}</span>
        {chgPct !== null && (
          <span className={`ml-1.5 font-semibold ${chgPct > 0 ? 'text-up' : chgPct < 0 ? 'text-down' : ''}`}>
            {formatPct(chgPct)}
          </span>
        )}
        <span className="ml-1.5 text-xs text-ink-muted">
          · 그날 증감 {last.netQty > 0 ? '+' : ''}{formatShares(last.netQty)}
        </span>
      </p>
      <svg
        viewBox={`0 0 ${view.width} ${view.height}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`대차잔고 ${first.date} ${formatShares(first.balanceQty)}에서 ${last.date} ${formatShares(last.balanceQty)}`}
      >
        {view.bars.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            className={b.up ? 'fill-up/60' : 'fill-down/60'}
          />
        ))}
        <line x1={0} x2={view.width} y1={view.zeroY} y2={view.zeroY} className="stroke-ink-muted/30" strokeWidth={0.5} />
        <polyline points={view.line} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-brand-strong" />
      </svg>
      <div className="flex justify-between text-xs text-ink-muted">
        <span>{first.date}</span>
        <span>선: 잔고 · 막대: 일별 증감</span>
        <span>{last.date}</span>
      </div>
      <p className="text-xs text-ink-muted">{LENDING_NOTE}</p>
    </Card>
  )
}
