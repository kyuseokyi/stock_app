import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import StockDailyChart, { type ChartMarker, type ChartPriceLine } from '../screener/StockDailyChart'
import { getPatternBases } from '../../api/patterns'
import { formatPrice } from '../../lib/format'
import {
  breakoutText, depthText, lengthText, patternLabel, pivotText, pointMarker, stageLabel,
} from '../../lib/patterns'
import { THEME } from '../../lib/themeColors'
import type { PatternBases, PatternItem } from '../../types/patterns'

const BREAKOUT_COLOR = THEME.up
const DAY_MS = 86_400_000
const MIN_LOOKBACK_DAYS = 280 // api/stock.ts 기본값과 같다
const MAX_LOOKBACK_DAYS = 600 // 약 400거래일

/** 피벗 대비 %를 '+5%'·'−8%' 로 */
function zonePct(price: number, pivot: number): string {
  const v = Math.round((price / pivot - 1) * 100)
  return `${v < 0 ? '−' : '+'}${Math.abs(v)}%`
}

/** 가장 오래된 꼭짓점까지 덮는 일봉 조회 기간(달력일) — 기본~상한 사이 */
function lookbackFor(dates: string[], now: Date = new Date()): number {
  const oldest = dates.reduce<number | null>((acc, d) => {
    const t = Date.parse(d)
    return Number.isNaN(t) ? acc : acc === null ? t : Math.min(acc, t)
  }, null)
  if (oldest === null) return MIN_LOOKBACK_DAYS
  const days = Math.ceil((now.getTime() - oldest) / DAY_MS) + 30 // 꼭짓점 앞 여유 30일
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(MIN_LOOKBACK_DAYS, days))
}

// 패턴 상세 — 일봉 차트(피벗·매수 상단·손절 선 + 베이스 꼭짓점 마커) + 현재 베이스 요약 + 베이스 이력 표.
export default function PatternDetail({ item }: { item: PatternItem }) {
  const [data, setData] = useState<PatternBases | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [reload, setReload] = useState(0)
  const [dropped, setDropped] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setData(null)
    getPatternBases(item.ticker)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [item.ticker, reload])

  const history = useMemo(
    () => [...(data?.bases ?? [])].sort((a, b) => (a.rimDate ?? a.lowDate ?? '').localeCompare(b.rimDate ?? b.lowDate ?? '')),
    [data],
  )
  const current = data?.bases.find((b) => b.isCurrent) ?? null

  const lookbackDays = useMemo(
    () => lookbackFor((current?.points ?? []).flatMap((p) => (p.date ? [p.date] : []))),
    [current],
  )
  const pivot = current?.pivot ?? item.pivot

  const { priceLines, markers } = useMemo(() => {
    const lines: ChartPriceLine[] = []
    const marks: ChartMarker[] = []
    lines.push({ price: pivot, color: THEME.up, title: '피벗' })
    if (data?.zones) {
      lines.push({ price: data.zones.buyHigh, color: THEME.inkMuted, title: `매수 상단 ${zonePct(data.zones.buyHigh, pivot)}`, dashed: true })
      lines.push({ price: data.zones.stopLow, color: THEME.down, title: `손절 ${zonePct(data.zones.stopLow, pivot)}`, dashed: true })
    }
    if (current) {
      for (const p of current.points) {
        const m = pointMarker(p, p.role === 'pivot' ? THEME.up : THEME.inkMuted)
        if (m) marks.push(m)
      }
      if (current.breakoutDate) {
        marks.push({ date: current.breakoutDate, position: 'belowBar', shape: 'arrowUp', color: BREAKOUT_COLOR, text: '돌파' })
      }
    }
    return { priceLines: lines, markers: marks }
  }, [data, current, pivot])

  const bo = current ? breakoutText(current.breakoutDate, current.daysSinceBreakout, current.breakoutVolPct) : null

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-lg font-bold text-ink">{item.name}</h2>
          <span className="text-xs text-ink-muted">{item.ticker} · {item.sectorName ?? item.market}</span>
        </div>
        <p className="text-sm text-ink-muted">
          {formatPrice(item.close)}원 · {patternLabel(item.patternType)} · {stageLabel(item.stage, item.label)}
        </p>
      </div>

      {/* 꼭짓점 기간을 알아야 일봉을 한 번만 요청하므로 베이스 조회가 끝난 뒤에 그린다 */}
      {state === 'loading' ? (
        <div className="flex h-64 items-center justify-center text-sm text-ink-muted">차트를 불러오는 중…</div>
      ) : (
        <StockDailyChart
          ticker={item.ticker}
          high52w={null}
          priceLines={priceLines}
          markers={markers}
          lookbackDays={lookbackDays}
          onMarkersDropped={setDropped}
        />
      )}
      <p className="text-xs text-ink-muted">
        {data?.zones
          ? `실선 피벗 · 점선 매수 상단(${zonePct(data.zones.buyHigh, pivot)})·손절(${zonePct(data.zones.stopLow, pivot)})`
          : '실선 피벗 (매매 구간은 돌파 직후에만 표시돼요)'}
      </p>
      {dropped > 0 && <p className="text-xs text-ink-muted">차트 기간 밖 꼭짓점 {dropped}개는 표시하지 않았어요</p>}

      {state === 'loading' && <p className="py-4 text-center text-sm text-ink-muted">베이스 이력을 불러오는 중…</p>}
      {state === 'failed' && (
        <div className="py-2 text-center">
          <p className="text-sm text-ink-muted">베이스 이력을 불러오지 못했어요</p>
          <button
            type="button"
            onClick={() => setReload((k) => k + 1)}
            className="mt-2 rounded-btn bg-fill px-4 py-2 text-sm font-medium text-ink"
          >
            다시 시도
          </button>
        </div>
      )}

      {state === 'ready' && current && (
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {([
            ['현재 베이스', `${patternLabel(current.patternType)} · ${stageLabel(current.stage, current.label)}`],
            ['피벗', pivotText(current.pivot)],
            ['깊이 / 길이', `${depthText(current.depth)} / ${lengthText(current.length)}`],
            ['상태', current.isActive ? '돌파 전' : '돌파 후'],
            ['돌파', bo ?? '–'],
            ['직전 상승폭', current.priorUptrendPct === null ? '–' : `${current.priorUptrendPct.toFixed(0)}%`],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-line/60 py-1.5 text-sm">
              <dt className="text-ink-muted">{k}</dt>
              <dd className="text-right font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {state === 'ready' && history.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-bold text-ink">베이스 이력 (오래된 순)</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <caption className="sr-only">{item.name} 베이스 이력 (오래된 순)</caption>
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
      )}

      <Link to={`/screener/leaders?ticker=${encodeURIComponent(item.ticker)}`} className="inline-block text-sm font-medium text-brand">
        주도주 분석(CANSLIM) 보기 →
      </Link>
    </div>
  )
}
