import type { Sentiment } from '../../types/game'

// 유저 베팅 심리(WS 5초 주기). 미수신이면 숨김, 0/0 이면 안내 문구.
export default function SentimentBar({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return null
  const empty = sentiment.long_pct === 0 && sentiment.short_pct === 0

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
            <span className="text-up">🔴 Long {sentiment.long_pct}%</span>
            <span className="text-down">🔵 Short {sentiment.short_pct}%</span>
          </div>
        </>
      )}
    </div>
  )
}
