import Card from '../ui/Card'
import { daysUntil, formatKrw, formatPct, pnlClass } from '../../lib/format'
import type { Account, MyRank, Season, Streak } from '../../types/game'

interface GameHeaderProps {
  season: Season
  account: Account | null
  myRank: MyRank | null
  loggedIn: boolean
  streak: Streak | null
  /** 퀴즈 진입 버튼 노출(서버가 퀴즈 기능을 끈 경우 false) */
  showQuiz: boolean
  onOpenRanking: () => void
  onOpenQuest: () => void
  onOpenQuiz: () => void
  /** Streak 칩 클릭 → 연속 출석 보상 모달 */
  onOpenStreak: () => void
  /** 📖 규칙 모달(비로그인도 열람) */
  onOpenRules: () => void
}

const NAV_BUTTON = 'rounded-field bg-fill px-3 py-1.5 text-sm text-ink transition hover:brightness-95'

// 시즌·종목·D-day + Streak + 내 순위/수익률 + 자본금 + 랭킹·퀘스트·퀴즈·규칙 진입 버튼.
export default function GameHeader({
  season, account, myRank, loggedIn, streak, showQuiz, onOpenRanking, onOpenQuest, onOpenQuiz, onOpenStreak, onOpenRules,
}: GameHeaderProps) {
  const dday = daysUntil(season.end_at)
  const rank = myRank?.rank ?? null
  const roi = myRank?.roi_pct ?? null
  const showStreak = loggedIn && streak !== null && streak.enabled && streak.current_streak >= 1

  return (
    <Card className="sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-brand">
            <span>
              시즌 {season.season_number}기{dday !== null && ` · 종료 D-${dday}`}
            </span>
            {showStreak && (
              <button
                type="button"
                onClick={onOpenStreak}
                className="rounded-full bg-fill px-2 py-0.5 text-up transition hover:brightness-95"
                title={`최고 기록 ${streak.highest_streak}일 · 연속 출석 보상 보기`}
              >
                🔥 {streak.current_streak}일 연속
                {streak.rewards.some((r) => r.claimable) && <span className="ml-1">🎁</span>}
              </button>
            )}
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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpenRanking} className={NAV_BUTTON}>
            🏆 랭킹
          </button>
          <button type="button" onClick={onOpenQuest} className={NAV_BUTTON}>
            🎯 퀘스트
          </button>
          {showQuiz && (
            <button type="button" onClick={onOpenQuiz} className={NAV_BUTTON}>
              🧩 퀴즈
            </button>
          )}
          <button type="button" onClick={onOpenRules} className={NAV_BUTTON}>
            📖 규칙
          </button>
        </div>
      </div>
    </Card>
  )
}
