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

// 모바일 폭은 4개가 한 줄에 균등(flex-1), 데스크톱은 내용 폭. 누르는 영역 44px, 아이콘은 하단 탭바와 같은 선 아이콘(무채색).
const NAV_BUTTON =
  'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-field bg-fill px-2 text-sm font-medium text-ink transition hover:brightness-95 sm:flex-none sm:px-3'

const navIcon = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)
const ICON = {
  ranking: navIcon('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3'),
  quest: navIcon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01'),
  quiz: navIcon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01'),
  rules: navIcon('M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13'),
}

// 시즌·종목·D-day + Streak + 내 순위/수익률 + 자본금 + 랭킹·퀘스트·퀴즈·규칙 진입 버튼.
// 컴팩트(앱과 같은 배치): 1줄 종목·시즌 / 2줄 순위·자본금 / 3줄 진입 버튼 한 줄 — 모바일에서 차트가 첫 화면에 들어오게
export default function GameHeader({
  season, account, myRank, loggedIn, streak, showQuiz, onOpenRanking, onOpenQuest, onOpenQuiz, onOpenStreak, onOpenRules,
}: GameHeaderProps) {
  const dday = daysUntil(season.end_at)
  const rank = myRank?.rank ?? null
  const roi = myRank?.roi_pct ?? null
  const showStreak = loggedIn && streak !== null && streak.enabled && streak.current_streak >= 1

  return (
    <Card className="space-y-2 p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 truncate text-base font-bold text-ink sm:text-lg">
          {season.stock_name} <span className="text-xs font-medium text-ink-muted sm:text-sm">{season.ticker}</span>
        </h1>
        <span className="ml-auto shrink-0 text-xs font-semibold text-brand-strong">
          {season.season_number}기{dday !== null && ` · D-${dday}`}
        </span>
        {showStreak && (
          <button
            type="button"
            onClick={onOpenStreak}
            className="-my-2 inline-flex min-h-11 shrink-0 items-center"
            title={`${streak.current_streak}일 연속 · 최고 기록 ${streak.highest_streak}일 · 연속 출석 보상 보기`}
            aria-label={`연속 출석 ${streak.current_streak}일${streak.rewards.some((r) => r.claimable) ? ', 받을 보상 있음' : ''} — 보상 보기`}
          >
            {/* 🔥 는 DESIGN.md 의 유일한 이모지 예외(게임 놀이감) — 나머지는 선 아이콘 */}
            <span className="rounded-full bg-fill px-2.5 py-1 text-xs font-semibold text-ink transition hover:brightness-95">
              <span aria-hidden>🔥</span> {streak.current_streak}일
              {streak.rewards.some((r) => r.claimable) && <span className="ml-1 text-brand-strong">· 보상</span>}
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
        {!loggedIn ? (
          <p className="truncate text-ink-muted">로그인하고 시즌에 참여하세요</p>
        ) : rank !== null ? (
          <p className="font-semibold text-ink">
            {rank}위
            {roi !== null && <span className={`ml-1 ${pnlClass(roi)}`}>{formatPct(roi)}</span>}
          </p>
        ) : (
          <p className="truncate text-ink-muted">첫 거래 후 순위가 집계돼요</p>
        )}
        <p className="shrink-0 text-ink-muted">
          자본금
          <span className="ml-1.5 font-bold text-ink tabular-nums sm:text-base">
            {account ? formatKrw(account.total_asset) : '—'}
          </span>
        </p>
      </div>
      <div>
        <div className="flex gap-1.5 sm:justify-end sm:gap-2">
          <button type="button" onClick={onOpenRanking} className={NAV_BUTTON}>
            {ICON.ranking}랭킹
          </button>
          <button type="button" onClick={onOpenQuest} className={NAV_BUTTON}>
            {ICON.quest}퀘스트
          </button>
          {showQuiz && (
            <button type="button" onClick={onOpenQuiz} className={NAV_BUTTON}>
              {ICON.quiz}퀴즈
            </button>
          )}
          <button type="button" onClick={onOpenRules} className={NAV_BUTTON}>
            {ICON.rules}규칙
          </button>
        </div>
      </div>
    </Card>
  )
}
