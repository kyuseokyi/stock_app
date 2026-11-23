import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import { getEduHistory } from '../../api/eduGame'
import { actionSummary, eduErrorMessage } from '../../lib/eduGame'
import { formatPrice, formatSignedKrw, pnlClass } from '../../lib/format'
import type { EduAction } from '../../types/eduGame'

// 이번 시즌 내 참가 기록(최신순) — 로그인 전용. 최근 10개 먼저, 더 보기.
const FIRST = 10

export default function EduHistoryList({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<EduAction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    let alive = true
    getEduHistory()
      .then((h) => {
        if (!alive) return
        setRows(h.actions)
        setError(null)
      })
      .catch((e: unknown) => {
        if (alive) setError(eduErrorMessage(e, '참가 기록을 불러오지 못했어요.'))
      })
    return () => {
      alive = false
    }
  }, [refreshKey])

  const shown = rows ? (all ? rows : rows.slice(0, FIRST)) : []
  return (
    <Card>
      <h2 className="text-base font-bold text-ink">📒 내 참가 기록</h2>
      {error ? (
        <p className="mt-2 text-sm text-ink-muted">{error}</p>
      ) : rows === null ? (
        <p className="mt-2 text-sm text-ink-muted">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">이번 시즌 참가 기록이 아직 없어요.</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-line">
            {shown.map((a) => (
              <li key={`${a.day_index}-${a.action_type}`} className="py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink">Day {a.day_index}</span>
                  <span className="text-xs text-ink-muted">{a.action_date} · 체결 {formatPrice(a.execution_price)}원</span>
                </div>
                <p className="mt-0.5 text-ink">{actionSummary(a)}</p>
                {(a.realized_pnl !== null || a.settlement_note) && (
                  <p className="mt-0.5 text-xs">
                    {a.realized_pnl !== null && <span className={`font-semibold ${pnlClass(a.realized_pnl)}`}>{formatSignedKrw(a.realized_pnl)} </span>}
                    {a.settlement_note && <span className="text-ink-muted">{a.settlement_note}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {rows.length > FIRST && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 w-full text-center text-sm font-semibold text-brand-strong">
              {all ? '접기' : `전체 ${rows.length}개 보기`}
            </button>
          )}
        </>
      )}
    </Card>
  )
}
