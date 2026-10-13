import Card from '../ui/Card'
import { daysUntil, formatKrw, formatPct, pnlClass } from '../../lib/format'
import type { Account, MyRank, Season } from '../../types/game'

interface GameHeaderProps {
  season: Season
  account: Account | null
  myRank: MyRank | null
  loggedIn: boolean
}

// 시즌·종목·D-day + 내 순위/수익률 + 자본금. 랭킹·퀘스트 버튼은 6b 에서 연결(현재 비활성).
export default function GameHeader({ season, account, myRank, loggedIn }: GameHeaderProps) {
  const dday = daysUntil(season.end_at)
  const rank = myRank?.rank ?? null
  const roi = myRank?.roi_pct ?? null

  return (
    <Card className="sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-brand">
            시즌 {season.season_number}기{dday !== null && ` · 종료 D-${dday}`}
          </p>
          <h1 className="mt-0.5 text-lg font-bold text-ink">
            {season.stock_name} <span className="text-sm font-medium text-ink-muted">({season.ticker})</span>
          </h1>
        </div>
        <div className="text-right text-sm">
          {!loggedIn ? (
            <p className="text-ink-muted">로그인하고 시즌에 참여하세요</p>
          ) : rank !== null ? (
            <p className="font-semibold text-ink">
              내 순위 {rank}위
              {roi !== null && <span className={`ml-1 ${pnlClass(roi)}`}>{formatPct(roi)}</span>}
            </p>
          ) : (
            <p className="text-ink-muted">첫 거래 후 순위가 집계돼요</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          자본금
          <span className="ml-1.5 text-base font-bold text-ink tabular-nums">
            {account ? formatKrw(account.total_asset) : '—'}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            title="곧 열려요"
            className="rounded-field bg-white px-3 py-1.5 text-sm text-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            🏆 랭킹
          </button>
          <button
            type="button"
            disabled
            title="곧 열려요"
            className="rounded-field bg-white px-3 py-1.5 text-sm text-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            🎯 퀘스트
          </button>
        </div>
      </div>
    </Card>
  )
}
