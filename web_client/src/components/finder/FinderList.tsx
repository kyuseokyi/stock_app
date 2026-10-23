import type { ReactNode } from 'react'
import StockRow from '../screener/StockRow'
import Tag from '../ui/Tag'
import { gcLabel, maOrderLabel } from '../../lib/finder'
import { formatAmount, formatPct, formatPrice, pnlClass } from '../../lib/format'
import type { FinderItem } from '../../types/finder'

// 지표 배지 — 신고가는 상승 사건(핑크), RSI 70 이상은 과열 주의(danger), 나머지(골든크로스·배열·RSI 수치)는 분류(중립).
// 정배열·과매도 같은 '상태'를 상승·하락 색으로 칠하지 않는다(핑크=상승, 블루=하락에만).
function Badges({ it }: { it: FinderItem }) {
  const gc = gcLabel(it.gcDays)
  const order = maOrderLabel(it.maOrder)
  return (
    <>
      {it.isNewHigh && <Tag tone="up">신고가</Tag>}
      {gc && <Tag>{gc}</Tag>}
      {it.rsi14 !== null && (
        <Tag tone={it.rsi14 >= 70 ? 'danger' : 'neutral'}>
          RSI {Math.round(it.rsi14)}
          {it.rsi14 >= 70 ? ' 과열' : it.rsi14 <= 30 ? ' 과매도' : ''}
        </Tag>
      )}
      {order && <Tag>{order}</Tag>}
    </>
  )
}

interface Props {
  items: FinderItem[]
  selected: string | null
  onSelect: (ticker: string) => void
  /** 좁은 화면: 선택한 행 아래에 펼쳐 보일 상세(넓은 화면은 오른쪽 패널이라 없음) */
  renderInline?: (item: FinderItem) => ReactNode
}

// 조건검색 목록 — 종목·배지·시장/업종 / 오른쪽 종가·등락률(상승 핑크·하락 블루·0 회색)·거래대금. 행 틀은 StockRow.
export default function FinderList({ items, selected, onSelect, renderInline }: Props) {
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
            meta={
              <>
                <Badges it={it} />
                <span className="text-xs text-ink-muted">{it.sectorName ?? it.market}</span>
              </>
            }
            aside={[
              formatPrice(it.close),
              <span className={pnlClass(it.chg1d)}>{it.chg1d === null ? '–' : formatPct(it.chg1d)}</span>,
              formatAmount(it.value),
            ]}
            inline={renderInline && active ? renderInline(it) : undefined}
          />
        )
      })}
    </ul>
  )
}
