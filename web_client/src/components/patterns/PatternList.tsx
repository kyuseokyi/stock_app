import type { ReactNode } from 'react'
import StockRow from '../screener/StockRow'
import Tag from '../ui/Tag'
import { formatPrice } from '../../lib/format'
import { breakoutText, depthText, lengthText, patternLabel, pivotDistText, pivotText, stageLabel } from '../../lib/patterns'
import type { PatternItem } from '../../types/patterns'

interface Props {
  items: PatternItem[]
  selected: string | null
  onSelect: (ticker: string) => void
  /** 좁은 화면: 선택한 행 아래에 펼쳐 보일 상세(넓은 화면은 오른쪽 패널이라 없음) */
  renderInline?: (item: PatternItem) => ReactNode
}

// 패턴 목록 — 종목·패턴(분류)·단계(상태)·깊이/길이·돌파 / 오른쪽 피벗·피벗까지 거리·종가. 행 틀은 StockRow.
// 패턴 종류는 선택 칩과 헷갈리지 않게 중립 배지, '피벗까지 %'는 등락이 아닌 거리라 회색에 부호만.
export default function PatternList({ items, selected, onSelect, renderInline }: Props) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => {
        const active = it.ticker === selected
        const bo = breakoutText(it.breakoutDate, it.daysSinceBreakout, it.breakoutVolPct)
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
                <Tag>{patternLabel(it.patternType)}</Tag>
                <Tag tone="outline">{stageLabel(it.stage, it.label)}</Tag>
                <span className="text-xs text-ink-muted">깊이 {depthText(it.depth)} · {lengthText(it.length)}</span>
                {bo && <span className="basis-full text-xs text-up">{bo}</span>}
              </>
            }
            aside={[
              `피벗 ${pivotText(it.pivot)}`,
              <span className="text-ink-muted">{it.pivotDistPct === null ? '–' : `피벗까지 ${pivotDistText(it.pivotDistPct)}`}</span>,
              `종가 ${formatPrice(it.close)}`,
            ]}
            inline={renderInline && active ? renderInline(it) : undefined}
          />
        )
      })}
    </ul>
  )
}
