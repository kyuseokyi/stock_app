import type { SurgeStock } from '../../api/dailySurge'
import { fmtDiff, fmtPrice, fmtRate, fmtValue, fmtVolume, rateClass } from '../../lib/dailySurge'

// 급등·급락·거래대금 상위·교집합 종목 표 — 이름을 누르면 오른쪽에 종목 상세.
interface Props {
  items: SurgeStock[]
  selected: string | null
  onSelect: (s: SurgeStock) => void
}

export default function SurgeStockTable({ items, selected, onSelect }: Props) {
  if (items.length === 0) {
    return <p className="rounded-card bg-surface p-6 text-center text-sm text-ink-muted">조건에 맞는 종목이 없습니다.</p>
  }
  return (
    <div className="overflow-x-auto rounded-card bg-surface">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="bg-fill text-right text-xs text-ink-muted">
            <th scope="col" className="px-3 py-2 text-left font-medium">순위</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">종목 · 대표 테마</th>
            <th scope="col" className="px-3 py-2 font-medium">종가 / 전일대비</th>
            <th scope="col" className="px-3 py-2 font-medium">등락률</th>
            <th scope="col" className="px-3 py-2 font-medium">거래량 (전일 대비)</th>
            <th scope="col" className="px-3 py-2 font-medium">거래대금</th>
            <th scope="col" className="px-3 py-2 text-center font-medium">공시·메모</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s, i) => (
            <tr key={s.ticker} className={`border-t border-line ${selected === s.ticker ? 'bg-brand-soft' : ''}`}>
              <td className="px-3 py-2 text-ink-muted">{i + 1}</td>
              <td className="px-3 py-1">
                <button type="button" onClick={() => onSelect(s)} className="flex min-h-[44px] flex-col justify-center text-left">
                  <span className="font-bold text-ink">
                    {s.name} <span className="text-xs font-normal text-ink-muted">{s.ticker} · {s.market}</span>
                  </span>
                  <span className="text-xs text-ink-muted">
                    {s.primary_theme_name
                      ? `${s.is_theme_leader ? '대장 · ' : ''}${s.primary_theme_name}`
                      : '테마 묶음 없음'}
                  </span>
                </button>
              </td>
              <td className="px-3 py-2 text-right">
                <div className="font-medium text-ink">{fmtPrice(s.close)}</div>
                <div className={`text-xs ${rateClass(s.change_price)}`}>{fmtDiff(s.change_price)}</div>
              </td>
              <td className={`px-3 py-2 text-right font-bold ${rateClass(s.change_rate)}`}>{fmtRate(s.change_rate)}</td>
              <td className="px-3 py-2 text-right text-ink">
                {fmtVolume(s.volume)}
                <div className="text-xs text-ink-muted">{s.volume_ratio != null ? `${Math.round(s.volume_ratio).toLocaleString('ko-KR')}%` : '-'}</div>
              </td>
              <td className="px-3 py-2 text-right font-medium text-ink">{fmtValue(s.trading_value)}</td>
              <td className="px-3 py-2 text-center">
                <div className="flex flex-wrap justify-center gap-1">
                  {s.dart_items.length > 0 && (
                    <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">
                      {s.dart_items[0].when === 'same' ? '당일' : '전일'} {s.dart_keywords[0] ?? '공시'}
                    </span>
                  )}
                  {s.note && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-strong">메모</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
