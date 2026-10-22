import { useEffect, useRef, useState } from 'react'
import { CrosshairMode, LineStyle, createChart, type IPriceLine, type ISeriesApi } from 'lightweight-charts'
import { getDailyCandles } from '../../api/stock'
import { sma } from '../../lib/indicators'
import { THEME } from '../../lib/themeColors'

const MA50_COLOR = '#f97316'

export interface ChartPriceLine { price: number; color: string; title?: string; dashed?: boolean }
export interface ChartMarker {
  date: string
  position: 'aboveBar' | 'belowBar'
  shape: 'circle' | 'arrowUp' | 'arrowDown' | 'square'
  color: string
  text?: string
}

// 스크리너 상세용 일봉 차트 — 캔들 + 50일선 + 52주 최고가 점선. 게임 TradingChart(코치·포지션·분봉)와 분리.
// priceLines·markers 는 선택 — 패턴 상세가 피벗·매수/손절 선과 베이스 꼭짓점을 얹을 때 쓴다(없으면 기존과 동일).
export default function StockDailyChart({
  ticker, high52w, priceLines, markers, lookbackDays, onMarkersDropped, heightClass = 'h-64',
}: {
  ticker: string
  high52w: number | null
  priceLines?: ChartPriceLine[]
  markers?: ChartMarker[]
  /** 일봉 조회 기간(달력일) — 생략하면 기본(약 280일) */
  lookbackDays?: number
  /** 받은 일봉 기간 밖이라 그리지 못한 마커 수 알림 */
  onMarkersDropped?: (n: number) => void
  /** 차트 높이 Tailwind 클래스 — 생략하면 h-64(스크리너 상세 패널) */
  heightClass?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const timesRef = useRef<Set<string>>(new Set())
  const linesRef = useRef<IPriceLine[]>([])
  const extraRef = useRef({ priceLines, markers, onMarkersDropped })
  extraRef.current = { priceLines, markers, onMarkersDropped }
  // 배열은 렌더마다 새로 만들어지므로 내용으로 비교
  const extraKey = JSON.stringify([priceLines ?? null, markers ?? null])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  // 차트 생성·일봉 조회 — 선/마커가 바뀌어도 다시 만들거나 다시 요청하지 않는다
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: THEME.inkMuted },
      grid: { vertLines: { color: THEME.canvas }, horzLines: { color: THEME.canvas } },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      rightPriceScale: { borderColor: THEME.line },
      timeScale: { borderColor: THEME.line },
      localization: { priceFormatter: (p: number) => Math.round(p).toLocaleString('ko-KR') },
    })
    const candles = chart.addCandlestickSeries({
      upColor: THEME.up, downColor: THEME.down, borderUpColor: THEME.up, borderDownColor: THEME.down,
      wickUpColor: THEME.up, wickDownColor: THEME.down,
    })
    const ma50 = chart.addLineSeries({ color: MA50_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    let cancelled = false
    setState('loading')
    getDailyCandles(ticker, undefined, lookbackDays)
      .then((rows) => {
        if (cancelled) return
        candles.setData(rows.map((c) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close })))
        const avg = sma(rows.map((c) => c.close), 50)
        ma50.setData(rows.flatMap((c, i) => (avg[i] === null ? [] : [{ time: c.date, value: avg[i] as number }])))
        if (high52w !== null) {
          candles.createPriceLine({
            price: high52w, color: THEME.inkMuted, lineWidth: 1, lineStyle: LineStyle.Dashed,
            axisLabelVisible: true, title: '52주 고점',
          })
        }
        timesRef.current = new Set(rows.map((c) => c.date))
        seriesRef.current = candles
        chart.timeScale().fitContent()
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
      seriesRef.current = null
      linesRef.current = []
      chart.remove()
    }
  }, [ticker, high52w, lookbackDays])

  // 피벗·매수/손절 선과 마커 — 일봉이 도착했을 때(state=ready)와 값이 바뀔 때마다 이전 선을 지우고 다시 얹는다
  useEffect(() => {
    const series = seriesRef.current
    if (state !== 'ready' || !series) return
    for (const h of linesRef.current) series.removePriceLine(h)
    linesRef.current = []
    const extra = extraRef.current
    for (const l of extra.priceLines ?? []) {
      linesRef.current.push(series.createPriceLine({
        price: l.price, color: l.color, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true, title: l.title ?? '',
      }))
    }
    const all = extra.markers ?? []
    const shown = all.filter((m) => timesRef.current.has(m.date))
    series.setMarkers(
      shown
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((m) => ({ time: m.date, position: m.position, shape: m.shape, color: m.color, text: m.text })),
    )
    extra.onMarkersDropped?.(all.length - shown.length)
  }, [extraKey, state])

  return (
    <div className={`relative ${heightClass} touch-pan-y`}>
      <div ref={boxRef} className="h-full w-full" />
      {state !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
          {state === 'loading' ? '차트를 불러오는 중…' : '차트를 불러오지 못했어요'}
        </div>
      )}
      <div className="pointer-events-none absolute left-2 top-1 flex gap-3 text-[11px] text-ink-muted">
        <span><span className="mr-1 inline-block h-0.5 w-3 align-middle" style={{ background: MA50_COLOR }} />50일선</span>
        <span>┄ 52주 고점</span>
      </div>
    </div>
  )
}
