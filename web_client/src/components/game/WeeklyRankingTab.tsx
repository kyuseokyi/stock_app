import Button from '../ui/Button'
import { usePeriodRanking, type RankingPeriod } from '../../hooks/usePeriodRanking'
import { useRewardConfig } from '../../hooks/useRewardConfig'
import { formatPct, formatRewardTiers, formatWeekRange, formatWon, pnlClass } from '../../lib/format'

interface WeeklyRankingTabProps {
  seasonId: number
  myUserId: number | null
  /** 'month' 이면 월간 탭(분기 시즌 전용). 기본 주간 */
  period?: RankingPeriod
}

const MEDAL = ['🥇', '🥈', '🥉']

const LABEL = {
  week: { my: '내 주간 순위', last: '지난주 Top 3', empty: '이번 주 순위가 아직 없어요', rule: '그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만' },
  month: { my: '내 월간 순위', last: '지난달 Top 3', empty: '이번 달 순위가 아직 없어요', rule: '그 달 신규 주문 1회 이상 · 시즌 마지막 달은 기록만' },
} as const

// 주간/월간 탭 — 이번 기간·내 순위·지난 기간 Top 3·Top 100. 내 순위·지난 기간은 실패해도 목록은 표시.
export default function WeeklyRankingTab({ seasonId, myUserId, period = 'week' }: WeeklyRankingTabProps) {
  const { state, reload } = usePeriodRanking(period, seasonId, myUserId)
  const rewards = useRewardConfig()
  const label = LABEL[period]
  const tiers = period === 'month' ? rewards.monthly : rewards.weekly

  if (state.kind === 'loading') return <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>
  if (state.kind === 'error')
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-ink-muted">{state.message}</p>
        <Button variant="secondary" className="mt-3" onClick={reload}>
          다시 시도
        </Button>
      </div>
    )

  const { board, me, last } = state.data
  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-muted">
        {board.start_at && board.end_at && (
          <p className="font-medium text-ink">{formatWeekRange(board.start_at, board.end_at)}</p>
        )}
        <p className="mt-1">1~3위 {formatRewardTiers(tiers)} · {label.rule}</p>
      </div>

      {me && me.rank !== null && me.roi !== null && (
        <div className="flex items-center justify-between rounded-field bg-brand-soft px-3 py-2 text-sm">
          <span className="text-ink">
            {label.my} <b>{me.rank}위</b> / {me.total}명
          </span>
          <span className={`font-semibold tabular-nums ${pnlClass(me.roi)}`}>{formatPct(me.roi)}</span>
        </div>
      )}

      {last && last.entries.length > 0 && (
        <section className="rounded-field border border-line px-3 py-2">
          <h3 className="mb-1 text-xs font-bold text-ink">{label.last}</h3>
          <ol className="space-y-0.5 text-sm">
            {last.entries.map((e) => (
              <li key={e.rank} className="flex items-center gap-2">
                <span className="w-6">{MEDAL[e.rank - 1] ?? e.rank}</span>
                <span className="flex-1 truncate text-ink">{e.nickname ?? '익명'}</span>
                <span className={`tabular-nums ${pnlClass(e.roi)}`}>{formatPct(e.roi)}</span>
                {e.reward_amount > 0 && <span className="text-xs text-ink-muted">{formatWon(e.reward_amount)}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {board.entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">{label.empty}</p>
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
                <span className={`w-16 text-right font-semibold tabular-nums ${pnlClass(r.roi)}`}>
                  {formatPct(r.roi)}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
