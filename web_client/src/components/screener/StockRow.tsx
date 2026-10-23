import type { ReactNode } from 'react'

interface StockRowProps {
  name: string
  ticker: string
  active: boolean
  onSelect: () => void
  /** 좁은 화면에서 행 아래로 펼치는 목록이면 true(aria-expanded), 넓은 화면 오른쪽 패널이면 false(aria-current) */
  expandable: boolean
  /** 이름 왼쪽(주도주 점수 상자 등) */
  leading?: ReactNode
  /** 이름 아래 배지·보조 정보 줄 */
  meta: ReactNode
  /** 오른쪽 숫자 — 1줄 주 값(가격), 2·3줄 보조 */
  aside: [ReactNode, ReactNode?, ReactNode?]
  /** 펼친 상세(좁은 화면) */
  inline?: ReactNode
}

// 종목 찾기(주도주·조건검색·패턴) 공용 행 — 세 탭이 같은 틀·같은 숫자 위치를 쓰게 한다.
export default function StockRow({ name, ticker, active, onSelect, expandable, leading, meta, aside, inline }: StockRowProps) {
  const [main, sub, extra] = aside
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={expandable ? active : undefined}
        aria-current={!expandable && active ? 'true' : undefined}
        className={`flex w-full items-center gap-3 px-1 py-3 text-left transition ${active ? 'bg-brand-soft/60' : 'hover:bg-fill/60'}`}
      >
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate font-bold text-ink">{name}</span>
            <span className="shrink-0 text-xs text-ink-muted">{ticker}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">{meta}</div>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <div className="text-sm font-medium text-ink">{main}</div>
          {sub != null && <div className="text-xs font-medium">{sub}</div>}
          {extra != null && <div className="text-xs text-ink-muted">{extra}</div>}
        </div>
      </button>
      {inline && <div className="pb-4">{inline}</div>}
    </li>
  )
}
