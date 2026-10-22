import { useEffect, useRef, useState } from 'react'
import { CrosshairMode, LineStyle, createChart } from 'lightweight-charts'
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
  ticker, high52w, priceLines, markers,
}: { ticker: string; high52w: number | null; priceLines?: ChartPriceLine[]; markers?: ChartMarker[] }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const extraRef = useRef({ priceLines, markers })
  extraRef.current = { priceLines, markers }
  // 배열은 렌더마다 새로 만들어지므로 내용으로 비교
  const extraKey = JSON.stringify([priceLines ?? null, markers ?? null])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

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
    getDailyCandles(ticker)
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
        const extra = extraRef.current
        for (const l of extra.priceLines ?? []) {
          candles.createPriceLine({
            price: l.price, color: l.color, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
            axisLabelVisible: true, title: l.title ?? '',
          })
        }
        if (extra.markers && extra.markers.length > 0) {
          const times = new Set(rows.map((c) => c.date))
          candles.setMarkers(
            extra.markers
              .filter((m) => times.has(m.date))
              .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
              .map((m) => ({ time: m.date, position: m.position, shape: m.shape, color: m.color, text: m.text })),
          )
        }
        chart.timeScale().fitContent()
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
      chart.remove()
    }
  }, [ticker, high52w, extraKey])

  return (
    <div className="relative h-64 touch-pan-y">
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
