import { useMemo } from 'react'
import { breakoutText, depthText, lengthText, patternLabel, pivotText, stageLabel } from '../../lib/patterns'
import type { PatternBase } from '../../types/patterns'

// 패턴 상세 조각 — 스크리너 패턴 상세(PatternDetail)와 종목 상세 화면(StockDetailPage)이 같이 쓴다.

/** 현재 베이스 요약 — 패턴·피벗·깊이/길이·돌파 여부 */
export function CurrentBaseSummary({ base }: { base: PatternBase }) {
  const bo = breakoutText(base.breakoutDate, base.daysSinceBreakout, base.breakoutVolPct)
  return (
    <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {([
        ['현재 베이스', `${patternLabel(base.patternType)} · ${stageLabel(base.stage, base.label)}`],
        ['피벗', pivotText(base.pivot)],
        ['깊이 / 길이', `${depthText(base.depth)} / ${lengthText(base.length)}`],
        ['상태', base.isActive ? '돌파 전' : '돌파 후'],
        ['돌파', bo ?? '–'],
        ['직전 상승폭', base.priorUptrendPct === null ? '–' : `${base.priorUptrendPct.toFixed(0)}%`],
      ] as [string, string][]).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-line/60 py-1.5 text-sm">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="text-right font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 베이스 이력 표(오래된 순) — 비어 있으면 숨김 */
export function BaseHistoryTable({ name, bases }: { name: string; bases: PatternBase[] }) {
  const history = useMemo(
    () => [...bases].sort((a, b) => (a.rimDate ?? a.lowDate ?? '').localeCompare(b.rimDate ?? b.lowDate ?? '')),
    [bases],
  )
  if (history.length === 0) return null
  return (
    <div>
      <h3 className="mb-1 text-sm font-bold text-ink">베이스 이력 (오래된 순)</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <caption className="sr-only">{name} 베이스 이력 (오래된 순)</caption>
          <thead className="text-ink-muted">
            <tr>
              <th className="py-1 pr-2 font-medium">패턴</th>
              <th className="py-1 pr-2 font-medium">단계</th>
              <th className="py-1 pr-2 text-right font-medium">깊이</th>
              <th className="py-1 pr-2 text-right font-medium">길이</th>
              <th className="py-1 pr-2 text-right font-medium">피벗</th>
              <th className="py-1 text-right font-medium">돌파일</th>
            </tr>
          </thead>
          <tbody>
            {history.map((b, i) => (
              <tr key={b.rimDate ? `${b.patternType}-${b.rimDate}` : `${b.patternType}-i${i}`} className={`border-t border-line/60 ${b.isCurrent ? 'bg-brand-soft/50 font-medium' : ''}`}>
                <td className="py-1.5 pr-2 text-ink">
                  {patternLabel(b.patternType)}
                  {b.isCurrent && <span className="ml-1 rounded bg-brand-soft px-1 text-[10px] text-brand">현재</span>}
                </td>
                <td className="py-1.5 pr-2 text-ink">{stageLabel(b.stage, b.label)}</td>
                <td className="py-1.5 pr-2 text-right text-ink">{depthText(b.depth)}</td>
                <td className="py-1.5 pr-2 text-right text-ink">{lengthText(b.length)}</td>
                <td className="py-1.5 pr-2 text-right text-ink">{pivotText(b.pivot)}</td>
                <td className="py-1.5 text-right text-ink">{b.breakoutDate ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
