import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import { getEduLeaderboard } from '../../api/eduGame'
import { eduErrorMessage } from '../../lib/eduGame'
import { formatPct, formatWon, pnlClass } from '../../lib/format'
import type { EduLeaderboard as Board, EduLeaderRow } from '../../types/eduGame'

// 교육 시즌 수익률 순위(Top 50 중 10개 먼저, 더 보기) + 내 순위. 공개 API — 비로그인도 본다.
const FIRST = 10

function LeaderRow({ row, mine = false }: { row: EduLeaderRow; mine?: boolean }) {
  return (
    <li className={`flex items-center gap-3 px-3 py-2 text-sm ${mine ? 'rounded-card bg-brand-soft' : ''}`}>
      <span className="w-7 shrink-0 text-center font-bold text-ink">{row.rank}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{row.nickname ?? '익명'}{mine && ' (나)'}</span>
      <span className="hidden text-xs text-ink-muted sm:inline">{row.participation_days}일 참가</span>
      <span className="w-24 shrink-0 text-right text-xs text-ink-muted">{formatWon(row.total_asset)}</span>
      <span className={`w-14 shrink-0 text-right font-semibold ${pnlClass(row.current_roi)}`}>{formatPct(row.current_roi)}</span>
    </li>
  )
}

export default function EduLeaderboard({ refreshKey }: { refreshKey: number }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    let alive = true
    getEduLeaderboard()
      .then((b) => {
        if (!alive) return
        setBoard(b)
        setError(null)
      })
      .catch((e: unknown) => {
        if (alive) setError(eduErrorMessage(e, '순위를 불러오지 못했어요.'))
      })
    return () => {
      alive = false
    }
  }, [refreshKey])

  const rows = board ? (all ? board.top : board.top.slice(0, FIRST)) : []
  const mineInTop = board?.my_rank ? rows.some((r) => r.rank === board.my_rank!.rank) : false
  return (
    <Card>
      <h2 className="text-base font-bold text-ink">🏆 시즌 수익률 순위</h2>
      {error ? (
        <p className="mt-2 text-sm text-ink-muted">{error}</p>
      ) : board === null ? (
        <p className="mt-2 text-sm text-ink-muted">불러오는 중…</p>
      ) : board.top.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">아직 순위에 오른 참가자가 없어요. 첫 결정을 내려 보세요!</p>
      ) : (
        <>
          <ol className="mt-2 divide-y divide-line">
            {rows.map((r) => <LeaderRow key={r.rank} row={r} mine={board.my_rank?.rank === r.rank} />)}
          </ol>
          {board.my_rank && !mineInTop && (
            <ol className="mt-2 border-t border-line pt-2"><LeaderRow row={board.my_rank} mine /></ol>
          )}
          {board.top.length > FIRST && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 w-full text-center text-sm font-semibold text-brand-strong">
              {all ? '접기' : `전체 ${board.top.length}위까지 보기`}
            </button>
          )}
        </>
      )}
    </Card>
  )
}
