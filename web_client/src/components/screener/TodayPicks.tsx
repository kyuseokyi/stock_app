import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { getCanslimAbove } from '../../api/screener'
import { getPatternsNearPivot } from '../../api/patterns'
import { formatPrice } from '../../lib/format'
import { patternLabel, pivotDistText } from '../../lib/patterns'
import { PICK_COUNT, PICK_MIN_SCORE, PICK_PIVOT_MAX, PICK_PIVOT_MIN, pickToday, type TodayPick } from '../../lib/todayPicks'

type State = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; date: string | null; picks: TodayPick[] }

const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

// 주도주 탭 맨 위 결론 카드 — 900여 행 목록 대신 '오늘 볼 10개'로 끝나게. 기준은 부제에 그대로 적는다.
// 목록 필터와 무관하게 전체 시장 기준. 불러오지 못하면 카드를 숨긴다(아래 목록은 따로 동작).
export default function TodayPicks() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.all([getCanslimAbove(PICK_MIN_SCORE), getPatternsNearPivot(Math.max(-PICK_PIVOT_MIN, PICK_PIVOT_MAX))])
      .then(([c, p]) => {
        if (!cancelled) setState({ kind: 'ready', date: c.date, picks: pickToday(c.items, p) })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind === 'failed') return null
  if (state.kind === 'loading') {
    return (
      <div aria-busy="true">
        <p role="status" className="sr-only">오늘 볼 종목을 고르고 있어요</p>
        {/* 실측 카드 높이(10행) — 모바일은 부제가 두 줄 */}
        <Skeleton className="h-[719px] rounded-card sm:h-[699px]" />
      </div>
    )
  }
  const { date, picks } = state
  if (date === null) return null // 분석 데이터 준비 전 — 아래 목록이 안내한다

  return (
    <Card>
      <h2 className="text-lg font-bold text-ink">{picks.length >= PICK_COUNT ? `오늘 볼 ${PICK_COUNT}개` : '오늘 볼 종목'}</h2>
      <p className="mt-0.5 text-sm text-ink-muted">
        {shortDate(date)} 종가 기준 · 주도주 {PICK_MIN_SCORE}점 이상, 피벗 {PICK_PIVOT_MIN}%~+{PICK_PIVOT_MAX}% 안에서 점수 높은 순
      </p>
      {picks.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">오늘은 조건에 맞는 종목이 없어요</p>
      ) : (
        <ol className="mt-2 divide-y divide-line">
          {picks.map((p, i) => {
            const today = p.pattern.daysSinceBreakout === 1 // 서버 '오늘 돌파' 리포트와 같은 기준
            return (
              <li key={p.ticker}>
                <Link to={`/stock/${p.ticker}`} className="flex min-h-11 items-center gap-3 py-2.5 transition hover:bg-fill/60">
                  <span className="w-5 shrink-0 text-center text-sm font-bold text-ink-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-bold text-ink">{p.name}</span>
                      {today && <span className="shrink-0 rounded-full bg-up-soft px-2 py-0.5 text-xs font-semibold text-up">오늘 돌파</span>}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {p.score}점 · {patternLabel(p.pattern.patternType)} · 피벗까지 {pivotDistText(p.pattern.pivotDistPct)}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-ink">{formatPrice(p.close)}</span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
