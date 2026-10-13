import { useEffect, useRef, useState } from 'react'
import {
  CrosshairMode, LineStyle, createChart, type IPriceLine, type ISeriesApi,
} from 'lightweight-charts'
import { getDailyCandles } from '../../api/stock'
import { mergeTick } from '../../lib/candles'
import { kstDateString } from '../../lib/format'
import type { Coach, DailyCandle, Position } from '../../types/game'

// 일봉(stock_api) + 오늘 캔들 실시간 병합(WS tick) + 지지/저항/진입가 라인.
// 색: 상승=빨강/하락=파랑(국내 관례, Tailwind up/down 토큰과 동일).
const UP = '#f04452'
const DOWN = '#3182f6'
const SUPPORT = '#8b5cf6'
const RESIST = '#f59e0b'

interface TradingChartProps {
  ticker: string
  lastPrice: number | null
  coach: Coach | null
  position: Position | null
}

const toBar = (c: DailyCandle) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close })

export default function TradingChart({ ticker, lastPrice, coach, position }: TradingChartProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lastCandleRef = useRef<DailyCandle | null>(null)
  const linesRef = useRef<IPriceLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // 1) 차트 생성 + 일봉 로드(종목 바뀌면 재생성)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b95a1' },
      grid: { vertLines: { color: '#f2f4f6' }, horzLines: { color: '#f2f4f6' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#e5e8eb' },
      timeScale: { borderColor: '#e5e8eb' },
      localization: { priceFormatter: (p: number) => Math.round(p).toLocaleString('ko-KR') },
    })
    const series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    })
    seriesRef.current = series
    setLoaded(false)
    setFailed(false)

    let cancelled = false
    getDailyCandles(ticker)
      .then((candles) => {
        if (cancelled) return
        series.setData(candles.map(toBar))
        lastCandleRef.current = candles[candles.length - 1] ?? null
        chart.timeScale().fitContent()
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      seriesRef.current = null
      linesRef.current = []
      lastCandleRef.current = null
      chart.remove()
    }
  }, [ticker])

  // 2) 틱 → 오늘 캔들 병합
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !loaded || lastPrice === null) return
    const next = mergeTick(lastCandleRef.current, kstDateString(), lastPrice)
    lastCandleRef.current = next
    series.update(toBar(next))
  }, [lastPrice, loaded])

  // 3) 가격선(지지/저항/진입가) — 값이 바뀔 때만 재생성(손익 틱마다 재생성하지 않도록 원시값 의존)
  const support = coach?.support_price ?? null
  const resistance = coach?.resistance_price ?? null
  const entry = position?.entry_price ?? null
  const side = position?.side ?? null
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !loaded) return
    for (const l of linesRef.current) series.removePriceLine(l)
    const lines: IPriceLine[] = []
    if (support !== null) {
      lines.push(series.createPriceLine({
        price: support, color: SUPPORT, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '지지',
      }))
    }
    if (resistance !== null) {
      lines.push(series.createPriceLine({
        price: resistance, color: RESIST, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '저항',
      }))
    }
    if (entry !== null && side !== null) {
      lines.push(series.createPriceLine({
        price: entry, color: side === 'LONG' ? UP : DOWN, lineWidth: 2, lineStyle: LineStyle.Solid,
        axisLabelVisible: true, title: '진입',
      }))
    }
    linesRef.current = lines
  }, [support, resistance, entry, side, loaded])

  return (
    <div className="relative h-[260px] overflow-hidden rounded-card border border-line bg-white sm:h-[320px]">
      <div ref={boxRef} className="h-full w-full" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-ink-muted">
          차트 데이터를 불러오지 못했어요
        </div>
      )}
    </div>
  )
}
