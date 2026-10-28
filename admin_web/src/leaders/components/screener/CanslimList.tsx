// web_client/src/components/screener/CanslimList.tsx 복사본 — 원본과 같이 고칠 것
import type { ReactNode } from 'react'
import LetterBadges from './LetterBadges'
import StockRow from './StockRow'
import { formatPct, formatPrice } from '../../lib/format'
import type { CanslimItem } from '../../types/screener'

interface Props {
  items: CanslimItem[]
  selected: string | null
  onSelect: (ticker: string) => void
  /** 좁은 화면: 선택한 행 아래에 펼쳐 보일 상세(넓은 화면은 오른쪽 패널이라 null) */
  renderInline?: (ticker: string) => ReactNode
}

// CANSLIM 목록 — 점수 상자 + 종목·글자 배지·업종·RS / 오른쪽 종가·고점 대비. 행 틀은 StockRow(종목 찾기 3탭 공용).
export default function CanslimList({ items, selected, onSelect, renderInline }: Props) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => {
        const active = it.ticker === selected
        return (
          <StockRow
            key={it.ticker}
            name={it.name}
            ticker={it.ticker}
            active={active}
            onSelect={() => onSelect(it.ticker)}
            expandable={!!renderInline}
            leading={
              <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-btn bg-fill">
                <span className="text-base font-bold leading-none text-ink">{it.score}</span>
                <span className="text-xs text-ink-muted">점</span>
              </div>
            }
            meta={
              <>
                <LetterBadges letters={it.letters} compact />
                <span className="text-xs text-ink-muted">
                  {it.sectorName ?? it.market}
                  {it.rs !== null && ` · RS ${it.rs}`}
                </span>
              </>
            }
            aside={[formatPrice(it.close), undefined, it.pctFromHigh !== null ? `고점 ${formatPct(it.pctFromHigh)}` : undefined]}
            inline={renderInline && active ? renderInline(it.ticker) : undefined}
          />
        )
      })}
    </ul>
  )
}
