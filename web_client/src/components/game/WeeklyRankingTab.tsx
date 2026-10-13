import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import { getWeeklyLeaderboard, getWeeklyMyRank, getWeeklyResults } from '../../api/game'
import { formatPct, formatWeekRange, formatWon, pnlClass } from '../../lib/format'
import { gameErrorMessage } from '../../lib/gameErrors'
import type { WeeklyBoard, WeeklyMyRank, WeeklyResultWeek } from '../../types/game'

interface WeeklyRankingTabProps {
  seasonId: number
  myUserId: number | null
}

type Data = { board: WeeklyBoard; me: WeeklyMyRank | null; last: WeeklyResultWeek | null }
type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: Data }

const MEDAL = ['🥇', '🥈', '🥉']

// 주간 탭 — 이번 주 기간·내 순위·지난주 Top 3·Top 100. 내 순위·지난주는 실패해도 목록은 표시.
export default function WeeklyRankingTab({ seasonId, myUserId }: WeeklyRankingTabProps) {
  const [state, setState] = useState<Load>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    Promise.all([
      getWeeklyLeaderboard(seasonId),
      myUserId !== null ? getWeeklyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
      getWeeklyResults(seasonId, 1).catch((): WeeklyResultWeek[] => []),
    ])
      .then(([board, me, results]) => {
        if (!cancelled) setState({ kind: 'ok', data: { board, me, last: results[0] ?? null } })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [seasonId, myUserId, reloadKey])

  if (state.kind === 'loading') return <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>
  if (state.kind === 'error')
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-ink-muted">{state.message}</p>
        <Button variant="secondary" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
          다시 시도
        </Button>
      </div>
    )

  const { board, me, last } = state.data
  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-muted">
        <p className="font-medium text-ink">{formatWeekRange(board.start_at, board.end_at)}</p>
        <p className="mt-1">1~3위 50만·30만·20만 원 · 그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만</p>
      </div>

      {me && me.rank !== null && me.weekly_roi !== null && (
        <div className="flex items-center justify-between rounded-field bg-brand-soft px-3 py-2 text-sm">
          <span className="text-ink">
            내 주간 순위 <b>{me.rank}위</b> / {me.total}명
          </span>
          <span className={`font-semibold tabular-nums ${pnlClass(me.weekly_roi)}`}>{formatPct(me.weekly_roi)}</span>
        </div>
      )}

      {last && last.entries.length > 0 && (
        <section className="rounded-field border border-line px-3 py-2">
          <h3 className="mb-1 text-xs font-bold text-ink">지난주 Top 3</h3>
          <ol className="space-y-0.5 text-sm">
            {last.entries.map((e) => (
              <li key={e.rank} className="flex items-center gap-2">
                <span className="w-6">{MEDAL[e.rank - 1] ?? e.rank}</span>
                <span className="flex-1 truncate text-ink">{e.nickname ?? '익명'}</span>
                <span className={`tabular-nums ${pnlClass(e.weekly_roi)}`}>{formatPct(e.weekly_roi)}</span>
                {e.reward_amount > 0 && <span className="text-xs text-ink-muted">{formatWon(e.reward_amount)}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {board.entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">이번 주 순위가 아직 없어요</p>
      ) : (
        <ol className="space-y-1">
          {board.entries.map((r) => {
            const mine = myUserId !== null && r.user_id === myUserId
            return (
              <li
                key={r.user_id}
                className={`flex items-center gap-3 rounded-field px-3 py-2 text-sm ${mine ? 'bg-brand-soft' : ''}`}
              >
                <span className="w-8 shrink-0 font-bold tabular-nums text-ink">{r.rank}</span>
                <span className="flex-1 truncate text-ink">
                  {r.nickname ?? '익명'}
                  {mine && <span className="ml-1 text-xs font-semibold text-brand">나</span>}
                </span>
                <span className={`w-16 text-right font-semibold tabular-nums ${pnlClass(r.weekly_roi)}`}>
                  {formatPct(r.weekly_roi)}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
