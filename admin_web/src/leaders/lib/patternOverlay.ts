// web_client/src/lib/patternOverlay.ts 복사본 — 원본과 같이 고칠 것 (관리자 추가: patternShapes·SHAPE_COLORS)
import type { ChartMarker, ChartPriceLine, ChartShape } from '../components/screener/StockDailyChart'
import { pointMarker } from './patterns'
import { THEME } from './themeColors'
import type { PatternBase, PatternBases } from '../types/patterns'

// 패턴을 일봉 차트에 얹는 계산 — 스크리너 패턴 상세(PatternDetail)와 종목 상세 화면(StockDetailPage)이 같이 쓴다.

const DAY_MS = 86_400_000
export const MIN_LOOKBACK_DAYS = 280 // api/stock.ts 기본값과 같다
const MAX_LOOKBACK_DAYS = 600 // 약 400거래일

/** 피벗 대비 %를 '+5%'·'−8%' 로 */
export function zonePct(price: number, pivot: number): string {
  const v = Math.round((price / pivot - 1) * 100)
  return `${v < 0 ? '−' : '+'}${Math.abs(v)}%`
}

/** 가장 오래된 꼭짓점까지 덮는 일봉 조회 기간(달력일) — 기본~상한 사이 */
export function lookbackFor(dates: string[], now: Date = new Date()): number {
  const oldest = dates.reduce<number | null>((acc, d) => {
    const t = Date.parse(d)
    return Number.isNaN(t) ? acc : acc === null ? t : Math.min(acc, t)
  }, null)
  if (oldest === null) return MIN_LOOKBACK_DAYS
  const days = Math.ceil((now.getTime() - oldest) / DAY_MS) + 30 // 꼭짓점 앞 여유 30일
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(MIN_LOOKBACK_DAYS, days))
}

/** 현재 베이스의 꼭짓점 날짜 */
export function baseDates(base: PatternBase | null): string[] {
  return (base?.points ?? []).flatMap((p) => (p.date ? [p.date] : []))
}

/** 피벗 실선 + 매수 상단·손절 점선 + 꼭짓점·돌파 마커 */
export function patternOverlay(
  zones: PatternBases['zones'],
  current: PatternBase | null,
  pivot: number,
): { priceLines: ChartPriceLine[]; markers: ChartMarker[] } {
  const priceLines: ChartPriceLine[] = [{ price: pivot, color: THEME.up, title: '피벗' }]
  const markers: ChartMarker[] = []
  if (zones) {
    priceLines.push({ price: zones.buyHigh, color: THEME.inkMuted, title: `매수 상단 ${zonePct(zones.buyHigh, pivot)}`, dashed: true })
    priceLines.push({ price: zones.stopLow, color: THEME.down, title: `손절 ${zonePct(zones.stopLow, pivot)}`, dashed: true })
  }
  if (current) {
    for (const p of current.points) {
      const m = pointMarker(p, p.role === 'pivot' ? THEME.up : THEME.inkMuted, current.patternType)
      if (m) markers.push(m)
    }
    if (current.breakoutDate) {
      markers.push({ date: current.breakoutDate, position: 'belowBar', shape: 'arrowUp', color: THEME.up, text: '돌파' })
    }
  }
  return { priceLines, markers }
}

/** 차트 아래 선 설명 */
export function overlayCaption(zones: PatternBases['zones'], pivot: number): string {
  return zones
    ? `실선 피벗 · 점선 매수 상단(${zonePct(zones.buyHigh, pivot)})·손절(${zonePct(zones.stopLow, pivot)})`
    : '실선 피벗 (매매 구간은 돌파 직후에만 표시돼요)'
}

/** 패턴 모양 선 색 — 현재 베이스는 상승색, 지난 베이스는 옅은 회색 */
export const SHAPE_COLORS = { current: THEME.up, past: 'rgba(106, 102, 129, 0.45)' }

/** 베이스마다 꼭짓점(가격 있는 것)을 이은 모양 선 — 현재 베이스는 2px·상승색, 지난 베이스는 1px·회색. 지난 것을 먼저(현재가 위에 그려지게) */
export function patternShapes(bases: PatternBase[]): ChartShape[] {
  const toShape = (b: PatternBase, i: number): ChartShape => ({
    key: `${b.patternType}:${b.rimDate ?? i}`,
    color: b.isCurrent ? SHAPE_COLORS.current : SHAPE_COLORS.past,
    width: b.isCurrent ? 2 : 1,
    points: b.points.flatMap((p) => (p.date && p.price !== null ? [{ date: p.date, price: p.price }] : [])),
  })
  return [...bases.filter((b) => !b.isCurrent), ...bases.filter((b) => b.isCurrent)].map(toShape)
}

/** 모든 베이스의 꼭짓점 날짜 — 일봉 조회 기간을 지난 베이스까지 덮게 */
export function allBaseDates(bases: PatternBase[]): string[] {
  return bases.flatMap((b) => baseDates(b))
}
