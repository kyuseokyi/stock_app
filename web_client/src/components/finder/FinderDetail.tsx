import { Link } from 'react-router-dom'
import StockDailyChart from '../screener/StockDailyChart'
import { bbPositionLabel, gcLabel, maOrderLabel, sigmaLabel } from '../../lib/finder'
import { formatAmount, formatPct, formatPrice, pnlClass } from '../../lib/format'
import type { FinderItem } from '../../types/finder'

const fixed = (n: number | null, digits: number, suffix: string) => (n === null ? '–' : `${n.toFixed(digits)}${suffix}`)

// 조건검색 상세 — 일봉 차트(50일선) + 지표 표 + 주도주 분석 링크. 목록 값으로 그려 추가 조회가 없다.
export default function FinderDetail({ item, bbSigma, date }: { item: FinderItem; bbSigma: number; date: string | null }) {
  const sigma = sigmaLabel(bbSigma)
  const rows: [string, string][] = [
    ['거래대금', formatAmount(item.value)],
    ['시가총액', item.mcap === null ? '–' : formatAmount(item.mcap)],
    ['거래량(20일 평균 대비)', fixed(item.volRatio20, 1, '배')],
    ['RSI(14)', fixed(item.rsi14, 1, '')],
    ['이동평균 배열', maOrderLabel(item.maOrder) ?? '혼합'],
    [`볼린저(${sigma}) 위치`, bbPositionLabel(item.bbPosition)],
    [`볼린저(${sigma}) 밴드폭`, fixed(item.bbWidthPct, 1, '%')],
    ['위쪽 매물(최근 120일)', fixed(item.vpAbovePct, 1, '%')],
    ['골든크로스(20·60일선)', gcLabel(item.gcDays) ?? '없음'],
    ['52주 신고가', item.isNewHigh ? '오늘 경신' : '아님'],
    ['PER', fixed(item.per, 1, '배')],
    ['PBR', fixed(item.pbr, 2, '배')],
    ['ROE', fixed(item.roe, 1, '%')],
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <h2 className="text-lg font-bold text-ink">{item.name}</h2>
            <span className="text-xs text-ink-muted">{item.ticker} · {item.sectorName ?? item.market}</span>
          </div>
          <p className="text-sm text-ink-muted">{formatPrice(item.close)}원 · {date ?? '–'} 종가</p>
        </div>
        <div className={`text-lg font-bold ${pnlClass(item.chg1d)}`}>{item.chg1d === null ? '–' : formatPct(item.chg1d)}</div>
      </div>

      <StockDailyChart ticker={item.ticker} high52w={null} />

      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-line/60 py-1.5 text-sm">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <Link to={`/stock/${encodeURIComponent(item.ticker)}`} className="inline-block text-sm font-medium text-brand-strong">
        종목 상세 보기 →
      </Link>
      <p className="text-xs text-ink-muted">재무는 최신 연간 결산 기준이에요.</p>
    </div>
  )
}
