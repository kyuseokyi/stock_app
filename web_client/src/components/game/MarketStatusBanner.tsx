import Card from '../ui/Card'
import type { MarketStatus } from '../../types/game'

const ICON: Record<MarketStatus['state'], string> = {
  NORMAL: '',
  HALTED: '⛔',
  CIRCUIT_BREAKER: '🚨',
  MARKET_PAUSED: '🚨',
  VI: '⚡',
  SIDECAR: 'ℹ️',
}

const TITLE: Record<MarketStatus['state'], string> = {
  NORMAL: '',
  HALTED: '거래 정지',
  CIRCUIT_BREAKER: '서킷브레이커 발동',
  MARKET_PAUSED: '시장 거래 일시 정지',
  VI: '변동성 완화장치(VI) 발동',
  SIDECAR: '사이드카 발동',
}

// 장운영 상태 배너 — VI·거래정지·서킷브레이크는 주문이 막혀 있음을, 사이드카는 안내만. 평상시엔 숨김.
// 문구는 서버(market_status)가 만든 것을 그대로 쓴다(주문 거부 문구와 같은 말).
export default function MarketStatusBanner({ status }: { status: MarketStatus | null }) {
  if (!status || status.state === 'NORMAL') return null
  return (
    <Card className={status.blocking ? 'bg-up-soft' : 'bg-sky-soft'}>
      <div role="status" aria-live="polite" className="flex items-start gap-2">
        <span aria-hidden>{ICON[status.state]}</span>
        <p className="flex-1 text-sm text-ink">
          <span className="font-semibold">{TITLE[status.state]}</span>
          {status.blocking && <span className="ml-1.5 text-xs text-up">· 지금은 주문·청산이 안 돼요</span>}
          <span className="mt-0.5 block">{status.message}</span>
        </p>
      </div>
    </Card>
  )
}
