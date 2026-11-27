import type { SurgeStock } from '../../api/dailySurge'
import { fmtDiff, fmtPrice, fmtRate, fmtValue, fmtVolume, rateClass, themeLabel } from '../../lib/dailySurge'

// 급등·급락·거래대금 상위·교집합 종목 표 — 이름을 누르면 오른쪽에 종목 상세.
interface Props {
  items: SurgeStock[]
  selected: string | null
  onSelect: (s: SurgeStock) => void
}

function themeLine(s: SurgeStock): string {
  if (s.primary_theme_name) return `${s.is_theme_leader ? '대장 · ' : ''}${s.primary_theme_name} (동반 묶음)`
  return s.themes.length > 0 ? s.themes.slice(0, 3).map(themeLabel).join(' · ') : '소속 테마 없음'
}

function volumeRatio(s: SurgeStock): string {
  return s.volume_ratio != null ? `${Math.round(s.volume_ratio).toLocaleString('ko-KR')}%` : '-'
}

function Badges({ s }: { s: SurgeStock }) {
  return (
    <>
      {s.dart_items.length > 0 && (
        <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger">
          {s.dart_items[0].when === 'same' ? '당일' : '전일'} {s.dart_keywords[0] ?? '공시'}
        </span>
      )}
      {s.note && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-strong">메모</span>}
    </>
  )
}

// 좁은 화면(768px 미만)용 카드 목록 — 7열 표는 최소 760px 이라 휴대폰에서 가로 스크롤이 생긴다.
function MobileList({ items, selected, onSelect }: Props) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-card bg-surface md:hidden">
      {items.map((s, i) => (
        <li key={s.ticker} className="border-t border-line first:border-t-0">
          <button type="button" onClick={() => onSelect(s)} aria-pressed={selected === s.ticker}
            className={`flex w-full flex-col gap-1 px-3 py-2.5 text-left ${selected === s.ticker ? 'bg-brand-soft' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-xs text-ink-muted">{s.rank ?? i + 1}</span>
                <span className="min-w-0">
                  <span className="font-bold text-ink">{s.name}</span>{' '}
                  <span className="whitespace-nowrap text-xs text-ink-muted">{s.ticker} · {s.market}</span>
                </span>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <div className={`font-bold ${rateClass(s.change_rate)}`}>{fmtRate(s.change_rate)}</div>
                <div className="text-xs text-ink">{fmtPrice(s.close)} <span className={rateClass(s.change_price)}>{fmtDiff(s.change_price)}</span></div>
              </div>
            </div>
            <span className="truncate text-xs text-ink-muted">{themeLine(s)}{s.sector_name ? ` · 업종 ${s.sector_name}` : ''}</span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted tabular-nums">
              <span>대금 <strong className="font-medium text-ink">{fmtValue(s.trading_value)}</strong></span>
              <span>거래량 {fmtVolume(s.volume)} ({volumeRatio(s)})</span>
              <Badges s={s} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function SurgeStockTable({ items, selected, onSelect }: Props) {
  if (items.length === 0) {
    return <p className="rounded-card bg-surface p-6 text-center text-sm text-ink-muted">조건에 맞는 종목이 없습니다.</p>
  }
  return (
    <>
    <MobileList items={items} selected={selected} onSelect={onSelect} />
    <div className="hidden overflow-x-auto rounded-card bg-surface md:block">
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
              <td className="px-3 py-2 text-ink-muted">{s.rank ?? i + 1}</td>
              <td className="px-3 py-1">
                <button type="button" onClick={() => onSelect(s)} className="flex min-h-[44px] flex-col justify-center text-left">
                  <span className="font-bold text-ink">
                    {s.name} <span className="text-xs font-normal text-ink-muted">{s.ticker} · {s.market}</span>
                  </span>
                  <span className="text-xs text-ink-muted">{themeLine(s)}</span>
                  {s.sector_name && <span className="text-xs text-ink-muted">업종 {s.sector_name}</span>}
                </button>
              </td>
              <td className="px-3 py-2 text-right">
                <div className="font-medium text-ink">{fmtPrice(s.close)}</div>
                <div className={`text-xs ${rateClass(s.change_price)}`}>{fmtDiff(s.change_price)}</div>
              </td>
              <td className={`px-3 py-2 text-right font-bold ${rateClass(s.change_rate)}`}>{fmtRate(s.change_rate)}</td>
              <td className="px-3 py-2 text-right text-ink">
                {fmtVolume(s.volume)}
                <div className="text-xs text-ink-muted">{volumeRatio(s)}</div>
              </td>
              <td className="px-3 py-2 text-right font-medium text-ink">{fmtValue(s.trading_value)}</td>
              <td className="px-3 py-2 text-center">
                <div className="flex flex-wrap justify-center gap-1">
                  <Badges s={s} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}
