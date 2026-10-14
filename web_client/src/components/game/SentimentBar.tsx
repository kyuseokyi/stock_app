import { sideLabel } from '../../lib/side'
import type { Sentiment } from '../../types/game'

interface SentimentBarProps {
  sentiment: Sentiment | null
  /** 갱신 주기(초) — /rules 값, 없으면 5 */
  intervalSec?: number
}

// 유저 베팅 심리(WS 주기 갱신). 미수신이면 숨김, 0/0 이면 안내 문구.
export default function SentimentBar({ sentiment, intervalSec = 5 }: SentimentBarProps) {
  if (!sentiment) return null
  const empty = sentiment.long_pct === 0 && sentiment.short_pct === 0
  const total = sentiment.total ?? 0

  return (
    <div className="rounded-card bg-surface p-4">
      <p className="mb-2 text-xs font-medium text-ink-muted">📊 유저 베팅 심리</p>
      {empty ? (
        <p className="text-sm text-ink-muted">아직 포지션이 없어요</p>
      ) : (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
            <div className="bg-up transition-all" style={{ width: `${sentiment.long_pct}%` }} />
            <div className="bg-down transition-all" style={{ width: `${sentiment.short_pct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-sm font-semibold">
            <span className="text-up">🔴 {sideLabel('LONG')} {sentiment.long_pct}%</span>
            <span className="text-down">🔵 {sideLabel('SHORT')} {sentiment.short_pct}%</span>
          </div>
          {total > 0 && (
            <p className="mt-1 text-xs text-ink-muted">
              보유 중 {total.toLocaleString('ko-KR')}명 기준 · {intervalSec}초마다 갱신
            </p>
          )}
        </>
      )}
    </div>
  )
}
