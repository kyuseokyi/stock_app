import { useEffect, useRef, useState } from 'react'
import {
  CrosshairMode, LineStyle, TickMarkType, createChart, type IPriceLine, type ISeriesApi, type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { getGameCandles } from '../../api/game'
import { getDailyCandles } from '../../api/stock'
import { useGameRules } from '../../hooks/useGameRules'
import { bucketStartSec, mergeTick, mergeTickIntraday } from '../../lib/candles'
import { kstDateString } from '../../lib/format'
import { THEME } from '../../lib/themeColors'
import { chipClass } from '../ui/Chip'
import {
  CHART_INTERVALS, type ChartInterval, type Coach, type DailyCandle, type IntradayCandle, type Position,
} from '../../types/game'

// 일봉(stock_api)·분봉(/api/game/candles) + 현재 캔들 실시간 병합(WS tick) + 지지/저항/진입가/손절/익절 라인.
// 색: 상승=핑크레드/하락=블루(국내 관례, Tailwind up/down 토큰과 동일 — lib/themeColors).
const UP = THEME.up
const DOWN = THEME.down
const SUPPORT = '#8b5cf6'
const RESIST = '#f59e0b'
const STOP_LOSS = THEME.inkMuted // 손절 — 회색(ink-muted)
const TAKE_PROFIT = '#16a34a' // 익절 — 초록

interface TradingChartProps {
  ticker: string
  lastPrice: number | null
  coach: Coach | null
  position: Position | null
}

const toBar = (c: DailyCandle) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close })
const toIntradayBar = (c: IntradayCandle) => ({
  time: c.t as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
})

const INTERVAL_LABEL: Record<ChartInterval, string> = { day: '일', '1m': '1분', '5m': '5분', '15m': '15분', '60m': '60분' }

// 분봉 time 은 UTC epoch seconds — lightweight-charts 는 UTC 로 그리므로 KST(+9h)로 옮겨 라벨을 만든다.
const KST_OFFSET_SEC = 9 * 3600
const pad2 = (n: number) => String(n).padStart(2, '0')
const kstParts = (time: Time) => {
  const d = new Date(((typeof time === 'number' ? time : 0) + KST_OFFSET_SEC) * 1000)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
}
const kstCrosshairLabel = (time: Time) => {
  const p = kstParts(time)
  return `${p.mo}/${p.d} ${pad2(p.h)}:${pad2(p.mi)}`
}
const kstTickMark = (time: Time, type: TickMarkType) => {
  const p = kstParts(time)
  if (type === TickMarkType.Year) return String(p.y)
  if (type === TickMarkType.Month) return `${p.mo}월`
  if (type === TickMarkType.DayOfMonth) return `${p.mo}/${p.d}`
  return `${pad2(p.h)}:${pad2(p.mi)}`
}

/** 시간 오름차순 + 같은 t 중복 제거(lightweight-charts 는 엄격 오름차순 요구) */
const sortUnique = (rows: IntradayCandle[]) => {
  const byT = new Map<number, IntradayCandle>()
  for (const c of rows) byT.set(c.t, c)
  return [...byT.values()].sort((a, b) => a.t - b.t)
}

export default function TradingChart({ ticker, lastPrice, coach, position }: TradingChartProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lastCandleRef = useRef<DailyCandle | null>(null)
  const lastIntradayRef = useRef<IntradayCandle | null>(null)
  const linesRef = useRef<IPriceLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [empty, setEmpty] = useState(false)

  // 단위: 사용자 선택(화면 상태만) > 관리자 기본값 > 일봉(규칙 로드 전·실패)
  const { rules } = useGameRules()
  const [picked, setPicked] = useState<ChartInterval | null>(null)
  const intervals = rules?.chart_intervals ?? CHART_INTERVALS
  const interval: ChartInterval = picked ?? rules?.chart_interval_default ?? 'day'

  // 1) 차트 생성 + 캔들 로드(종목·단위 바뀌면 재생성 — 일봉/분봉 time 형식이 달라 시리즈를 새로 만든다)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: THEME.inkMuted },
      grid: { vertLines: { color: THEME.canvas }, horzLines: { color: THEME.canvas } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: THEME.line },
      timeScale: interval === 'day'
        ? { borderColor: THEME.line }
        : { borderColor: THEME.line, timeVisible: true, secondsVisible: false, tickMarkFormatter: kstTickMark },
      localization: interval === 'day'
        ? { priceFormatter: (p: number) => Math.round(p).toLocaleString('ko-KR') }
        : { priceFormatter: (p: number) => Math.round(p).toLocaleString('ko-KR'), timeFormatter: kstCrosshairLabel },
    })
    const series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    })
    seriesRef.current = series
    setLoaded(false)
    setFailed(false)
    setEmpty(false)

    let cancelled = false
    if (interval === 'day') {
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
    } else {
      getGameCandles(interval)
        .then((res) => {
          if (cancelled) return
          // 다른 종목(시즌 전환 직후 등) 분봉이면 섞지 않고 빈 상태로
          const rows = res.ticker && res.ticker !== ticker ? [] : sortUnique(res.candles)
          series.setData(rows.map(toIntradayBar))
          lastIntradayRef.current = rows[rows.length - 1] ?? null
          if (rows.length > 0) chart.timeScale().fitContent()
          setEmpty(rows.length === 0)
          setLoaded(true)
        })
        .catch(() => {
          if (!cancelled) setFailed(true)
        })
    }

    return () => {
      cancelled = true
      seriesRef.current = null
      linesRef.current = []
      lastCandleRef.current = null
      lastIntradayRef.current = null
      chart.remove()
    }
  }, [ticker, interval])

  // 2) 틱 → 오늘 캔들(일봉) / 현재 버킷(분봉) 병합
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !loaded || lastPrice === null) return
    try {
      if (interval === 'day') {
        const next = mergeTick(lastCandleRef.current, kstDateString(), lastPrice)
        lastCandleRef.current = next
        series.update(toBar(next))
      } else {
        const next = mergeTickIntraday(lastIntradayRef.current, bucketStartSec(Date.now(), interval), lastPrice)
        lastIntradayRef.current = next
        series.update(toIntradayBar(next))
        setEmpty(false)
      }
    } catch {
      // lightweight-charts "Cannot update oldest data" 등 — 틱 반영 실패로 앱이 죽지 않게 무시
    }
  }, [lastPrice, loaded, interval])

  // 3) 가격선(지지/저항/진입가/손절/익절) — 값이 바뀔 때만 재생성(손익 틱마다 재생성하지 않도록 원시값 의존)
  const support = coach?.support_price ?? null
  const resistance = coach?.resistance_price ?? null
  const entry = position?.entry_price ?? null
  const side = position?.side ?? null
  const stopLoss = position?.stop_loss_price ?? null
  const takeProfit = position?.take_profit_price ?? null
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
    if (stopLoss !== null) {
      lines.push(series.createPriceLine({
        price: stopLoss, color: STOP_LOSS, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '손절',
      }))
    }
    if (takeProfit !== null) {
      lines.push(series.createPriceLine({
        price: takeProfit, color: TAKE_PROFIT, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '익절',
      }))
    }
    linesRef.current = lines
  }, [support, resistance, entry, side, stopLoss, takeProfit, loaded])

  return (
    <div>
      <div role="tablist" aria-label="차트 단위" className="mb-2 flex gap-1.5 overflow-x-auto">
        {intervals.map((iv) => (
          <button
            key={iv}
            type="button"
            role="tab"
            aria-selected={interval === iv}
            onClick={() => setPicked(iv)}
            className={chipClass(interval === iv)}
          >
            {INTERVAL_LABEL[iv]}
          </button>
        ))}
      </div>
      <div className="relative h-[260px] overflow-hidden rounded-card border border-line bg-surface sm:h-[320px]">
        <div ref={boxRef} className="h-full w-full" />
        {failed ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface text-sm text-ink-muted">
            차트 데이터를 불러오지 못했어요
          </div>
        ) : (
          empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
              분봉은 오늘부터 쌓이고 있어요
            </div>
          )
        )}
      </div>
    </div>
  )
}
