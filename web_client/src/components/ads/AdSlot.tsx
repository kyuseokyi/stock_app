import { Link } from 'react-router-dom'
import type { AdConfig, WebAdSlotKey } from '../../api/ads'
import { houseAdFor, type HouseAd } from '../../lib/ads'
import Tag from '../ui/Tag'

// 광고 자리 — 지금은 자체 하우스 배너만(명세 §2). 글 카드와 같은 흰 카드에 오른쪽 위 '광고' 배지(§0-3).
// 그릴 것이 없으면(스위치 꺼짐·설정 못 받음·문구 없음) null — 자리도 차지하지 않는다.
// 금지 구역(§0-1): 종목 상세·스크리너 차트 스플릿뷰·게임 화면에는 두지 않는다.

export function HouseAdCard({ ad, className = '' }: { ad: HouseAd; className?: string }) {
  return (
    <Link
      to={ad.targetPath}
      aria-label={`광고: ${ad.title}`}
      className={`flex flex-col justify-center rounded-card bg-surface p-4 transition hover:bg-line ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-balance font-semibold text-ink">{ad.title}</p>
        <Tag tone="outline">광고</Tag>
      </div>
      {ad.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{ad.description}</p>}
      <p className="mt-2 text-sm font-medium text-brand-strong">바로 가기 ›</p>
    </Link>
  )
}

export default function AdSlot({ config, slotKey, className }: {
  config: AdConfig | null
  slotKey: WebAdSlotKey
  /** 자리별 고정 높이 등 — 목록 인피드는 글 카드와 같은 min-h-[124px] */
  className?: string
}) {
  const ad = houseAdFor(config, slotKey)
  return ad ? <HouseAdCard ad={ad} className={className} /> : null
}
