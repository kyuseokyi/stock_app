// web_client/src/components/screener/MarketStrip.tsx 복사본 — 원본과 같이 고칠 것
import Card from '../ui/Card'
import { Skeleton } from '../ui/Skeleton'
import { marketToneClass } from '../../lib/canslim'
import type { CanslimMarket } from '../../types/screener'

// 시장 방향(CANSLIM 의 M) — KOSPI·KOSDAQ 상태 + 기준일·투자 권유 아님 안내.
// loading 중에는 실제 칩과 같은 크기의 뼈대 2개로 자리를 잡아 데이터 도착 때 아래가 밀리지 않게 한다.
export default function MarketStrip({ markets, date, loading = false }: { markets: CanslimMarket[]; date: string | null; loading?: boolean }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">시장 방향</span>
        {loading && markets.length === 0 && [0, 1].map((i) => <Skeleton key={i} className="h-7 w-44 rounded-full" />)}
        {!loading && markets.length === 0 && <span className="text-sm text-ink-muted">지수 데이터를 모으고 있어요</span>}
        {markets.map((m) => (
          <span key={m.market} className={`rounded-full px-3 py-1 text-sm font-medium ${marketToneClass(m.status)}`}>
            {m.market} {m.status}
            <span className="ml-1 text-xs font-normal">· 분산일 {m.distributionDays}일</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {date ? `${date} 종가 기준` : '분석 데이터를 준비하고 있어요'} · 매일 20:30 갱신 · 투자 권유가 아니에요
      </p>
    </Card>
  )
}
