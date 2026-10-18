import Card from '../ui/Card'
import { marketToneClass } from '../../lib/canslim'
import type { CanslimMarket } from '../../types/screener'

// 시장 방향(CANSLIM 의 M) — KOSPI·KOSDAQ 상태 + 기준일·투자 권유 아님 안내.
export default function MarketStrip({ markets, date }: { markets: CanslimMarket[]; date: string | null }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">시장 방향</span>
        {markets.length === 0 && <span className="text-sm text-ink-muted">지수 데이터를 모으고 있어요</span>}
        {markets.map((m) => (
          <span key={m.market} className={`rounded-full px-3 py-1 text-sm font-medium ${marketToneClass(m.status)}`}>
            {m.market} {m.status}
            <span className="ml-1 text-xs opacity-80">· 분산일 {m.distributionDays}일</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {date ? `${date} 종가 기준` : '분석 데이터를 준비하고 있어요'} · 매일 장 마감 후 갱신 · 투자 권유가 아닙니다
      </p>
    </Card>
  )
}
