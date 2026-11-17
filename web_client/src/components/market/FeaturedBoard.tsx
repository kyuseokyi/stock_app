import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TabChips } from './SectionHead'
import {
  currentFeaturedTab,
  featuredCaption,
  featuredEmptyText,
  featuredMoreText,
  featuredTabText,
  featuredTabs,
  viMeta,
  type FeaturedTab,
} from '../../lib/featured'
import { formatPct, formatPrice, kstDateString, pnlClass } from '../../lib/format'
import type { Featured, FeaturedStock, ViStock } from '../../types/marketRest'

// 오늘 특징주 — 탭(신고가 / 신저가 / VI 발동) + 상위 목록. 종목을 누르면 종목 상세.
// VI 탭은 데이터가 있을 때만(키움 미연결·수집 전이면 숨김), 사라지면 신고가로 되돌린다.
export default function FeaturedBoard({ featured, initialTab = 'highs' }: { featured: Featured; initialTab?: FeaturedTab }) {
  const [tab, setTab] = useState<FeaturedTab>(initialTab)
  const current = currentFeaturedTab(tab, featured)
  const options = featuredTabs(featured).map((t): [FeaturedTab, string] => [t, featuredTabText(t, featured)])
  const caption = featuredCaption(current, featured, kstDateString())
  const total = current === 'vi' ? (featured.vi?.count ?? 0) : featured[current].count
  const shown = current === 'vi' ? (featured.vi?.items.length ?? 0) : featured[current].items.length
  const more = featuredMoreText(total, shown)
  return (
    <div>
      <TabChips label="특징주 구분" value={current} options={options} onChange={setTab} />
      {caption && <p className="mb-1 text-xs text-ink-muted">{caption}</p>}
      {shown === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">{featuredEmptyText(current, featured)}</p>
      ) : current === 'vi' ? (
        <ol>{featured.vi?.items.map((x) => <ViRow key={x.ticker} item={x} />)}</ol>
      ) : (
        <ol>{featured[current].items.map((x, i) => <StockRow key={x.ticker} rank={i + 1} item={x} />)}</ol>
      )}
      {more && <p className="mt-1 text-right text-xs text-ink-muted">{more}</p>}
    </div>
  )
}

function StockRow({ rank, item }: { rank: number; item: FeaturedStock }) {
  return (
    <li>
      <Link to={`/stock/${encodeURIComponent(item.ticker)}`} className="flex min-h-10 items-center gap-2 rounded-btn px-1 py-1.5 hover:bg-fill/60">
        <span className="w-5 shrink-0 text-center text-sm font-bold text-ink-muted">{rank}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.name}</span>
        <span className="shrink-0 text-right tabular-nums">
          {item.close != null && <span className="mr-2 text-sm text-ink">{formatPrice(item.close)}</span>}
          <span className={`text-sm font-bold ${pnlClass(item.changeRate)}`}>{item.changeRate == null ? '—' : formatPct(item.changeRate)}</span>
        </span>
      </Link>
    </li>
  )
}

function ViRow({ item }: { item: ViStock }) {
  const meta = viMeta(item)
  return (
    <li>
      <Link to={`/stock/${encodeURIComponent(item.ticker)}`} className="flex min-h-10 items-center gap-2 rounded-btn px-1 py-1.5 hover:bg-fill/60">
        <span className="w-16 shrink-0 text-xs tabular-nums text-ink-muted">{item.time.slice(0, 5) || '—'}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{item.name}</span>
          {meta && <span className="block truncate text-xs text-ink-muted">{meta}</span>}
        </span>
        <span className="shrink-0 text-right tabular-nums">
          {item.price != null && <span className="block text-sm text-ink">{formatPrice(item.price)}</span>}
          {item.rate != null && <span className={`block text-xs font-bold ${pnlClass(item.rate)}`}>괴리 {formatPct(item.rate)}</span>}
        </span>
      </Link>
    </li>
  )
}
