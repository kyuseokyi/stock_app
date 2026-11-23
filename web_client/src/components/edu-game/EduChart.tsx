import { useEffect, useRef, useState } from 'react'
import {
  CrosshairMode, LineStyle, createChart, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type LineData, type Time,
} from 'lightweight-charts'
import { BandFill } from '../../lib/bandFill'
import { widenRange } from '../../lib/autoscale'
import { MA_PERIODS, bollinger, sma, type MaPeriod } from '../../lib/indicators'
import { THEME } from '../../lib/themeColors'
import { chipClass } from '../ui/Chip'
import type { EduCandle, EduPosition, EduToday } from '../../types/eduGame'

// 교육용 합성 일봉 차트 — 실시간 TradingChart(시세·WS 결합)는 그대로 두고 같은 라이브러리·부품(lightweight-charts,
// indicators, BandFill, autoscale, THEME, 칩)만 재사용한다. 명세 5.2 / game_lightweight_sr_action_spec 1-1·1-2.
// 지지·저항·POC 는 서버가 계산한 값(today.*_price, 최근 60봉 24칸)을 그대로 그린다 — 화면에서 다시 계산하지 않는다.
const UP = THEME.up
const DOWN = THEME.down
const MA_COLORS: Record<MaPeriod, string> = { 5: '#14b8a6', 20: '#f97316', 60: '#a16207' }
const BB_COLOR = 'rgba(99, 102, 241, 0.7)'
const BB_FILL = 'rgba(99, 102, 241, 0.07)'
const SR_LINE = '#94a3b8' // 지지·저항 — 색 구분 없는 단일 중립색, 차트 전체 폭 수평선
const POC_LINE = '#d97706' // 최대 매물대(POC) — 앰버
const STOP_LOSS = THEME.inkMuted
const TAKE_PROFIT = '#16a34a'
const VOLUME_UP = 'rgba(182, 38, 93, 0.25)'
const VOLUME_DOWN = 'rgba(60, 93, 193, 0.25)'
const VISIBLE_BARS = 80 // 첫 화면 캔들 수(앞쪽은 60일선 워밍업 — 왼쪽으로 끌면 보임)

interface Props {
  candles: EduCandle[]
  today: EduToday | null
  position: EduPosition | null
}

interface IndicatorSeries {
  ma: Record<MaPeriod, ISeriesApi<'Line'>>
  bb: ISeriesApi<'Line'>[]
  band: BandFill
}

function addIndicators(chart: IChartApi): IndicatorSeries {
  const base = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
  const ma = Object.fromEntries(MA_PERIODS.map((p) => [p, chart.addLineSeries({ ...base, color: MA_COLORS[p] })])) as Record<MaPeriod, ISeriesApi<'Line'>>
  const upper = chart.addLineSeries({ ...base, color: BB_COLOR })
  const middle = chart.addLineSeries({ ...base, color: BB_COLOR, lineStyle: LineStyle.Dashed })
  const lower = chart.addLineSeries({ ...base, color: BB_COLOR })
  const band = new BandFill(BB_FILL)
  upper.attachPrimitive(band)
  return { ma, bb: [upper, middle, lower], band }
}

export default function EduChart({ candles, today, position }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const indRef = useRef<IndicatorSeries | null>(null)
  const linesRef = useRef<IPriceLine[]>([])
  const fitRef = useRef<number[]>([])
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const rangeSetRef = useRef(false)
  const [ready, setReady] = useState(0) // 차트·데이터 반영 횟수 — 가격선·토글 효과가 다시 돈다
  const [showMa, setShowMa] = useState(true)
  const [showBb, setShowBb] = useState(false)
  const [showPoc, setShowPoc] = useState(true)
  const [showSr, setShowSr] = useState(true)

  // 1) 차트 생성(한 번)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: THEME.inkMuted },
      grid: { vertLines: { color: THEME.canvas }, horzLines: { color: THEME.canvas } },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      rightPriceScale: { borderColor: THEME.line, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: THEME.line },
      localization: { priceFormatter: (p: number) => Math.round(p).toLocaleString('ko-KR') },
    })
    const volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    const series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => widenRange(original(), fitRef.current),
    })
    seriesRef.current = series
    indRef.current = addIndicators(chart)
    volRef.current = volume
    chartRef.current = chart
    return () => {
      seriesRef.current = null
      indRef.current = null
      volRef.current = null
      chartRef.current = null
      linesRef.current = []
      rangeSetRef.current = false // 차트를 다시 만들면 첫 화면 구간도 다시 잡는다
      chart.remove()
    }
  }, [])

  // 2) 캔들·지표 데이터(상태를 새로 받을 때마다)
  useEffect(() => {
    const series = seriesRef.current
    const ind = indRef.current
    const chart = chartRef.current
    if (!series || !ind || !chart) return
    const time = (c: EduCandle) => c.date as Time
    series.setData(candles.map((c) => ({ time: time(c), open: c.open, high: c.high, low: c.low, close: c.close })))
    volRef.current?.setData(candles.map((c) => ({ time: time(c), value: c.volume, color: c.close >= c.open ? VOLUME_UP : VOLUME_DOWN })))
    const closes = candles.map((c) => c.close)
    const line = (values: (number | null)[]): LineData[] =>
      values.flatMap((v, i) => (v === null ? [] : [{ time: time(candles[i]), value: v }]))
    for (const p of MA_PERIODS) ind.ma[p].setData(line(sma(closes, p)))
    const bands = bollinger(closes)
    ind.bb[0].setData(line(bands.map((b) => b?.upper ?? null)))
    ind.bb[1].setData(line(bands.map((b) => b?.middle ?? null)))
    ind.bb[2].setData(line(bands.map((b) => b?.lower ?? null)))
    ind.band.setPoints(bands.flatMap((b, i) => (b === null ? [] : [{ time: time(candles[i]), upper: b.upper, lower: b.lower }])))
    if (!rangeSetRef.current && candles.length > 0) {
      rangeSetRef.current = true // 새로 받아도 사용자가 보던 위치는 유지
      if (candles.length > VISIBLE_BARS) chart.timeScale().setVisibleLogicalRange({ from: candles.length - VISIBLE_BARS, to: candles.length + 1 })
      else chart.timeScale().fitContent()
    }
    setReady((v) => v + 1)
  }, [candles])

  // 3) 지표 켜기/끄기
  useEffect(() => {
    const ind = indRef.current
    if (!ind) return
    for (const p of MA_PERIODS) ind.ma[p].applyOptions({ visible: showMa })
    for (const s of ind.bb) s.applyOptions({ visible: showBb })
    ind.band.setVisible(showBb)
  }, [showMa, showBb, ready])

  // 4) 가격선 — 지지·저항(단일색 전체 폭)·POC(앰버 점선)·진입·손절·익절
  const support = today?.support_price ?? null
  const resistance = today?.resistance_price ?? null
  const poc = today?.poc_price ?? null
  const entry = position?.entry_price ?? null
  const side = position?.side ?? null
  const stopLoss = position?.stop_loss_price ?? null
  const takeProfit = position?.take_profit_price ?? null
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    for (const l of linesRef.current) series.removePriceLine(l)
    const lines: IPriceLine[] = []
    const add = (price: number | null, color: string, width: 1 | 2, style: LineStyle, title: string) => {
      if (price === null) return
      lines.push(series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }))
    }
    if (showSr) {
      add(support, SR_LINE, 2, LineStyle.Solid, '지지')
      add(resistance, SR_LINE, 2, LineStyle.Solid, '저항')
    }
    if (showPoc) add(poc, POC_LINE, 2, LineStyle.Dashed, 'POC')
    if (side !== null) add(entry, side === 'LONG' ? UP : DOWN, 2, LineStyle.Solid, '진입')
    add(stopLoss, STOP_LOSS, 1, LineStyle.Dashed, '손절')
    add(takeProfit, TAKE_PROFIT, 1, LineStyle.Dashed, '익절')
    linesRef.current = lines
    // 자동 범위에는 지지·저항·POC·진입만(손절·익절은 멀 수 있어 캔들이 눌리지 않게 제외)
    fitRef.current = [showSr ? support : null, showSr ? resistance : null, showPoc ? poc : null, entry].filter((p): p is number => p !== null)
  }, [support, resistance, poc, entry, side, stopLoss, takeProfit, showSr, showPoc, ready])

  const chips: { label: string; on: boolean; toggle: () => void }[] = [
    { label: '이동평균', on: showMa, toggle: () => setShowMa((v) => !v) },
    { label: '볼린저', on: showBb, toggle: () => setShowBb((v) => !v) },
    { label: '매물대 POC', on: showPoc, toggle: () => setShowPoc((v) => !v) },
    { label: '지지·저항', on: showSr, toggle: () => setShowSr((v) => !v) },
  ]

  return (
    <div>
      <div role="group" aria-label="보조지표" className="mb-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={c.on}
            onClick={c.toggle}
            className={`${chipClass(c.on)} shrink-0 max-sm:px-2.5 max-sm:text-[13px]`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="relative h-[280px] overflow-hidden rounded-card border border-line bg-surface sm:h-[340px]">
        <div ref={boxRef} className="h-full w-full touch-pan-y" />
        {showMa && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex gap-2 rounded-field bg-surface/80 px-1.5 text-xs font-bold text-ink">
            {MA_PERIODS.map((p) => (
              <span key={p} className="inline-flex items-center gap-1">
                <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: MA_COLORS[p] }} />
                {p}
              </span>
            ))}
          </div>
        )}
        {candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">차트 데이터가 아직 없어요</div>
        )}
      </div>
    </div>
  )
}
