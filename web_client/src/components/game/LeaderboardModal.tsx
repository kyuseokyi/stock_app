import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import { chipClass } from '../ui/Chip'
import Modal from '../ui/Modal'
import { getHallOfFame, getLeaderboard } from '../../api/game'
import { formatPct, pnlClass } from '../../lib/format'
import { gameErrorMessage } from '../../lib/gameErrors'
import type { HallOfFameRow, LeaderboardRow } from '../../types/game'

type Tab = 'season' | 'hof'
type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T }

interface LeaderboardModalProps {
  seasonId: number
  /** 로그인 유저 id(비로그인 null) — 내 행 강조용 */
  myUserId: number | null
  onClose: () => void
}

/** 승률은 0~100 부호 없는 퍼센트(formatPct 는 + 부호를 붙이므로 쓰지 않는다) */
const winRate = (n: number): string => `${n.toFixed(1)}%`

/** 명예의 전당 행(시즌 desc · 순위 asc 정렬 유지)을 시즌별로 묶는다 */
function groupBySeason(rows: HallOfFameRow[]): { seasonId: number; seasonNumber: number; rows: HallOfFameRow[] }[] {
  const groups: { seasonId: number; seasonNumber: number; rows: HallOfFameRow[] }[] = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last.seasonId === r.season_id) last.rows.push(r)
    else groups.push({ seasonId: r.season_id, seasonNumber: r.season_number, rows: [r] })
  }
  return groups
}

// 랭킹 모달 — 시즌 Top 100 / 명예의 전당(MBTI). 공개 API 라 비로그인도 열람. 열릴 때·탭 전환 시 활성 탭만 로드.
export default function LeaderboardModal({ seasonId, myUserId, onClose }: LeaderboardModalProps) {
  const [tab, setTab] = useState<Tab>('season')
  const [board, setBoard] = useState<Load<LeaderboardRow[]>>({ kind: 'loading' })
  const [hof, setHof] = useState<Load<HallOfFameRow[]>>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (tab === 'season') {
      setBoard({ kind: 'loading' })
      getLeaderboard(seasonId)
        .then((data) => {
          if (!cancelled) setBoard({ kind: 'ok', data })
        })
        .catch((err: unknown) => {
          if (!cancelled) setBoard({ kind: 'error', message: gameErrorMessage(err) })
        })
    } else {
      setHof({ kind: 'loading' })
      getHallOfFame()
        .then((data) => {
          if (!cancelled) setHof({ kind: 'ok', data })
        })
        .catch((err: unknown) => {
          if (!cancelled) setHof({ kind: 'error', message: gameErrorMessage(err) })
        })
    }
    return () => {
      cancelled = true
    }
  }, [tab, seasonId, reloadKey])

  const current = tab === 'season' ? board : hof

  return (
    <Modal title="🏆 랭킹" onClose={onClose}>
      <div className="mb-4 flex gap-2" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'season'} onClick={() => setTab('season')} className={chipClass(tab === 'season')}>
          시즌 랭킹
        </button>
        <button type="button" role="tab" aria-selected={tab === 'hof'} onClick={() => setTab('hof')} className={chipClass(tab === 'hof')}>
          명예의 전당
        </button>
      </div>

      {current.kind === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {current.kind === 'error' && (
        <div className="py-10 text-center">
          <p className="text-sm text-ink-muted">{current.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            다시 시도
          </Button>
        </div>
      )}

      {tab === 'season' && board.kind === 'ok' && (
        board.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">아직 순위가 없어요</p>
        ) : (
          <ol className="space-y-1">
            {board.data.map((r) => {
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
                  <span className={`w-16 text-right font-semibold tabular-nums ${pnlClass(r.roi_pct)}`}>
                    {formatPct(r.roi_pct)}
                  </span>
                  <span className="w-20 text-right text-xs text-ink-muted tabular-nums">승률 {winRate(r.win_rate)}</span>
                </li>
              )
            })}
          </ol>
        )
      )}

      {tab === 'hof' && hof.kind === 'ok' && (
        hof.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">아직 명예의 전당이 비어 있어요</p>
        ) : (
          <div className="space-y-5">
            {groupBySeason(hof.data).map((g) => (
              <section key={g.seasonId}>
                <h3 className="mb-2 text-sm font-bold text-ink">시즌 {g.seasonNumber}</h3>
                <ol className="space-y-1">
                  {g.rows.map((r) => (
                    <li key={r.rank} className="flex items-center gap-3 rounded-field px-3 py-2 text-sm">
                      <span className="w-8 shrink-0 font-bold tabular-nums text-ink">{r.rank}</span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate text-ink">{r.nickname}</span>
                        {r.trading_mbti && (
                          <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                            {r.trading_mbti}
                          </span>
                        )}
                      </span>
                      <span className={`w-16 text-right font-semibold tabular-nums ${pnlClass(r.final_roi)}`}>
                        {formatPct(r.final_roi)}
                      </span>
                      <span className="w-20 text-right text-xs text-ink-muted tabular-nums">승률 {winRate(r.win_rate)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )
      )}
    </Modal>
  )
}
