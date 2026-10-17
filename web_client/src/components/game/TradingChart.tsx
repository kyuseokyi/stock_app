import { useEffect, useRef, useState } from 'react'
import {
  CrosshairMode, LineStyle, TickMarkType, createChart, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi,
  type LineData, type Time, type UTCTimestamp,
} from 'lightweight-charts'
import { getGameCandles, getSessionBar } from '../../api/game'
import { getDailyCandles } from '../../api/stock'
import { useGameRules } from '../../hooks/useGameRules'
import { BandFill } from '../../lib/bandFill'
import { widenRange } from '../../lib/autoscale'
import { bucketStartSec, mergeTick, mergeTickIntraday, withSessionBar } from '../../lib/candles'
import { loadChartPrefs, saveChartPrefs } from '../../lib/chartPrefs'
import { MA_PERIODS, bollinger, sma, type MaPeriod } from '../../lib/indicators'
import { kstDateString } from '../../lib/format'
import { THEME } from '../../lib/themeColors'
import { useTradingGameStore } from '../../store/tradingGame'
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
// 보조지표(mobile candle-chart 와 같은 값) — 이동평균 5·20·60, 볼린저밴드(선 + 옅은 띠)
const MA_COLORS: Record<MaPeriod, string> = { 5: '#14b8a6', 20: '#f97316', 60: '#a16207' }
const BB_COLOR = 'rgba(99, 102, 241, 0.7)'
const BB_FILL = 'rgba(99, 102, 241, 0.07)'

/** 지표 선 시리즈 묶음 — 차트와 같이 생성·제거 */
interface IndicatorSeries {
  ma: Record<MaPeriod, ISeriesApi<'Line'>>
  bbUpper: ISeriesApi<'Line'>
  bbMiddle: ISeriesApi<'Line'>
  bbLower: ISeriesApi<'Line'>
  band: BandFill
}

const addIndicatorSeries = (chart: IChartApi): IndicatorSeries => {
  // 가격선 라벨과 겹치지 않게 축 라벨·마지막 값 표시 끔
  const base = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
  const ma = Object.fromEntries(
    MA_PERIODS.map((p) => [p, chart.addLineSeries({ ...base, color: MA_COLORS[p] })]),
  ) as Record<MaPeriod, ISeriesApi<'Line'>>
  const bbUpper = chart.addLineSeries({ ...base, color: BB_COLOR })
  const bbMiddle = chart.addLineSeries({ ...base, color: BB_COLOR, lineStyle: LineStyle.Dashed })
  const bbLower = chart.addLineSeries({ ...base, color: BB_COLOR })
  const band = new BandFill(BB_FILL)
  bbUpper.attachPrimitive(band)
  return { ma, bbUpper, bbMiddle, bbLower, band }
}

/** 시각·종가 배열로 지표 전체 다시 계산해 반영(로드·틱 공통 — 수백 개라 매 틱 전체 계산도 가볍다) */
const setIndicatorData = (s: IndicatorSeries, bars: { time: Time; close: number }[]) => {
  const closes = bars.map((b) => b.close)
  const line = (values: (number | null)[]): LineData[] =>
    values.flatMap((v, i) => (v === null ? [] : [{ time: bars[i].time, value: v }]))
  for (const p of MA_PERIODS) s.ma[p].setData(line(sma(closes, p)))
  const bands = bollinger(closes)
  s.bbUpper.setData(line(bands.map((b) => b?.upper ?? null)))
  s.bbMiddle.setData(line(bands.map((b) => b?.middle ?? null)))
  s.bbLower.setData(line(bands.map((b) => b?.lower ?? null)))
  s.band.setPoints(bands.flatMap((b, i) => (b === null ? [] : [{ time: bars[i].time, upper: b.upper, lower: b.lower }])))
}

/** 틱으로 마지막 캔들이 바뀌었을 때 — 마지막 지표 점만 update(setData 는 스크롤 위치를 흔들 수 있어 피함) */
const updateIndicatorLast = (s: IndicatorSeries, bars: { time: Time; close: number }[]) => {
  const n = bars.length
  if (n === 0) return
  const closes = bars.map((b) => b.close)
  const time = bars[n - 1].time
  for (const p of MA_PERIODS) {
    const v = sma(closes, p)[n - 1]
    if (v !== null) s.ma[p].update({ time, value: v })
  }
  const bands = bollinger(closes)
  const b = bands[n - 1]
  if (b === null) return
  s.bbUpper.update({ time, value: b.upper })
  s.bbMiddle.update({ time, value: b.middle })
  s.bbLower.update({ time, value: b.lower })
  s.band.setPoints(bands.flatMap((x, i) => (x === null ? [] : [{ time: bars[i].time, upper: x.upper, lower: x.lower }])))
}

/** 마지막 캔들 반영(같은 시각이면 교체, 새 시각이면 추가) — 원본 불변 */
const upsertLast = (bars: { time: Time; close: number }[], time: Time, close: number) =>
  bars.length > 0 && bars[bars.length - 1].time === time
    ? [...bars.slice(0, -1), { time, close }]
    : [...bars, { time, close }]

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

const DAILY_VISIBLE_DAYS = 180 // 일봉 첫 화면 구간(조회는 api/stock 의 280일 — 지표 워밍업 포함)
// 모바일 폭에선 단위·지표 칩 7개가 한 줄에 들어가게 조금 작게
const CHIP_COMPACT = 'max-sm:px-2.5 max-sm:text-[13px]'
const INTRADAY_VISIBLE_BARS = 120 // 분봉 첫 화면 캔들 수(60분봉은 서버가 30거래일≈195개를 줌)

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

// ---------------------------------------------------------------- 단위별 캔들 캐시(전환 지연 줄이기)
type CandleRows = DailyCandle[] | IntradayCandle[]

/** 단위별 마지막 응답 — 페이지가 열려 있는 동안 유지. 다시 고르면 즉시 그리고 뒤에서 갱신 */
const candleCache = new Map<string, CandleRows>()
const cacheKey = (ticker: string, interval: ChartInterval) => `${ticker}|${interval}`
const PREFETCH_DELAY_MS = 1500 // 첫 화면을 그린 뒤 나머지 단위를 미리 받기 시작

async function fetchRows(ticker: string, interval: ChartInterval): Promise<CandleRows> {
  if (interval === 'day') {
    // 오늘 봉은 분봉으로 만든 서버 값으로(일봉은 20:30 수집 전엔 오늘 행이 없음) — 재조회해도 틱 병합 봉이 사라지지 않게.
    // 당일 봉 조회 실패는 무시(일봉만 표시)
    const [rows, session] = await Promise.all([getDailyCandles(ticker), getSessionBar().catch(() => null)])
    return session && session.ticker === ticker ? withSessionBar(rows, session.bar) : rows
  }
  const res = await getGameCandles(interval)
  // 다른 종목(시즌 전환 직후 등) 분봉이면 섞지 않고 빈 상태로
  return res.ticker && res.ticker !== ticker ? [] : sortUnique(res.candles)
}

export default function TradingChart({ ticker, lastPrice, coach, position }: TradingChartProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lastCandleRef = useRef<DailyCandle | null>(null)
  const lastIntradayRef = useRef<IntradayCandle | null>(null)
  const linesRef = useRef<IPriceLine[]>([])
  // 자동 범위에 넣을 가격선(일봉=지지·저항·진입, 분봉=진입). 손절·익절은 멀 수 있어 캔들이 눌리지 않게 제외
  const fitPricesRef = useRef<number[]>([])
  const indRef = useRef<IndicatorSeries | null>(null)
  const reloadRef = useRef<(() => void) | null>(null) // 현재 차트의 캔들 재로드(스트림 재개 시)
  const barsRef = useRef<{ time: Time; close: number }[]>([]) // 지표 계산용 시각·종가
  // 마지막 설정(단위·지표)은 이 브라우저에 저장 — 다시 열면 그대로(lib/chartPrefs)
  const [initialPrefs] = useState(loadChartPrefs)
  const [showMa, setShowMa] = useState(initialPrefs.ma)
  const [showBb, setShowBb] = useState(initialPrefs.bb)
  const [indOpen, setIndOpen] = useState(false) // 모바일 폭 지표 팝오버
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [empty, setEmpty] = useState(false)

  // 단위: 사용자 선택(화면 상태만) > 관리자 기본값 > 일봉(규칙 로드 전·실패)
  const { rules } = useGameRules()
  const [picked, setPicked] = useState<ChartInterval | null>(initialPrefs.interval)
  const intervals = rules?.chart_intervals ?? CHART_INTERVALS
  // 저장값이 관리자가 끈 단위면(목록에 없음) 관리자 기본값으로
  const usable = picked !== null && intervals.includes(picked) ? picked : null
  const interval: ChartInterval = usable ?? rules?.chart_interval_default ?? 'day'

  useEffect(() => {
    saveChartPrefs({ interval: picked, ma: showMa, bb: showBb })
  }, [picked, showMa, showBb])

  // 1) 차트 생성 + 캔들 로드(종목·단위 바뀌면 재생성 — 일봉/분봉 time 형식이 달라 시리즈를 새로 만든다)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: THEME.inkMuted },
      grid: { vertLines: { color: THEME.canvas }, horzLines: { color: THEME.canvas } },
      crosshair: { mode: CrosshairMode.Normal },
      // 모바일: 가로 드래그·핀치는 차트, 세로 스와이프는 페이지 스크롤(컨테이너 touch-action: pan-y 와 짝)
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
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
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => widenRange(original(), fitPricesRef.current),
    })
    seriesRef.current = series
    const ind = addIndicatorSeries(chart)
    indRef.current = ind
    setLoaded(false)
    setFailed(false)
    setEmpty(false)

    let cancelled = false
    let seq = 0 // 늦게 온 이전 요청 응답은 버림(재로드가 겹칠 때)
    let initialDone = false // 첫 로드가 끝나기 전 재로드는 무시(첫 화면 구간 지정이 건너뛰어지지 않게)
    // initial=true: 첫 로드(화면 구간 지정·실패 표시). false: 재로드(스트림이 끊겼다 이어짐) — 화면 위치는 그대로,
    // 실패는 조용히(기존 캔들 유지). 서버(game_ws)는 클라이언트와 무관하게 분봉을 계속 저장하므로 빈 구간이 채워진다.
    // 받은 캔들을 시리즈·지표에 반영. setRange=true 면 첫 화면 구간 지정(최근 180일 / 최근 N개)
    const applyRows = (rows: CandleRows, setRange: boolean) => {
      if (interval === 'day') {
        const candles = rows as DailyCandle[]
        series.setData(candles.map(toBar))
        barsRef.current = candles.map((c) => ({ time: c.date, close: c.close }))
        setIndicatorData(ind, barsRef.current)
        lastCandleRef.current = candles[candles.length - 1] ?? null
        if (setRange) {
          // 앞쪽은 지표 워밍업용 — 처음 화면은 최근 180일만(왼쪽으로 스크롤하면 더 보임)
          const from = kstDateString(new Date(Date.now() - DAILY_VISIBLE_DAYS * 86_400_000))
          const hidden = candles.findIndex((c) => c.date >= from)
          if (hidden > 0) {
            chart.timeScale().setVisibleLogicalRange({ from: hidden, to: candles.length - 1 })
          } else {
            chart.timeScale().fitContent()
          }
        }
      } else {
        const bars = rows as IntradayCandle[]
        series.setData(bars.map(toIntradayBar))
        barsRef.current = bars.map((c) => ({ time: c.t as UTCTimestamp, close: c.close }))
        setIndicatorData(ind, barsRef.current)
        lastIntradayRef.current = bars[bars.length - 1] ?? null
        // 분봉도 첫 화면은 최근 INTRADAY_VISIBLE_BARS 개(앞쪽은 지표 워밍업 — 왼쪽 스크롤로 보임)
        if (setRange && bars.length > INTRADAY_VISIBLE_BARS) {
          chart.timeScale().setVisibleLogicalRange({ from: bars.length - INTRADAY_VISIBLE_BARS, to: bars.length - 1 })
        } else if (setRange && bars.length > 0) {
          chart.timeScale().fitContent()
        }
        setEmpty(bars.length === 0)
      }
      setLoaded(true)
    }

    const load = (initial: boolean) => {
      const my = ++seq
      const stale = () => cancelled || my !== seq
      // 첫 로드: 캐시가 있으면 즉시 그리고(전환 지연 0) 뒤에서 최신으로 갱신(stale-while-revalidate)
      const key = cacheKey(ticker, interval)
      const cached = initial ? candleCache.get(key) : undefined
      if (cached) {
        applyRows(cached, true)
        initialDone = true
      }
      fetchRows(ticker, interval)
        .then((rows) => {
          if (rows.length > 0) candleCache.set(key, rows) // 늦게 온 응답도 캐시에는 넣는다
          if (stale()) return
          if ((!initial || cached) && rows.length === 0) return // 빈 재응답이 화면의 캔들을 지우지 않게
          applyRows(rows, initial && !cached) // 캐시로 이미 구간을 잡았으면 사용자가 보던 위치 유지
          if (initial) initialDone = true
        })
        .catch(() => {
          if (!stale() && initial && !cached) setFailed(true) // 캐시가 있으면 그대로 보여 준다
        })
    }
    load(true)
    reloadRef.current = () => {
      if (initialDone) load(false)
    }

    return () => {
      cancelled = true
      reloadRef.current = null
      seriesRef.current = null
      indRef.current = null
      barsRef.current = []
      linesRef.current = []
      lastCandleRef.current = null
      lastIntradayRef.current = null
      chart.remove()
    }
  }, [ticker, interval])

  // 1-0) 나머지 단위 미리 받기 — 첫 화면이 그려진 뒤 하나씩(동시 요청 폭주 방지). 첫 전환도 캐시로 즉시
  // 규칙 로드 전후로 intervals 배열이 새로 만들어져도 내용이 같으면 다시 돌지 않게 문자열 키로 구독
  const intervalsKey = intervals.join(',')
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      for (const iv of intervalsKey.split(',') as ChartInterval[]) {
        if (cancelled) return
        const key = cacheKey(ticker, iv)
        if (candleCache.has(key)) continue
        try {
          const rows = await fetchRows(ticker, iv)
          if (rows.length > 0 && !candleCache.has(key)) candleCache.set(key, rows)
        } catch {
          // 미리 받기 실패는 무시(전환할 때 다시 받는다)
        }
      }
    }, PREFETCH_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ticker, intervalsKey])

  // 1-1) WS 재연결·화면 복귀(streamEpoch 증가) → 끊긴 동안의 캔들을 서버에서 다시 받아 빈 구간을 채운다
  const streamEpoch = useTradingGameStore((s) => s.streamEpoch)
  useEffect(() => {
    if (streamEpoch > 0) reloadRef.current?.()
  }, [streamEpoch])

  // 2) 틱 → 오늘 캔들(일봉) / 현재 버킷(분봉) 병합
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !loaded || lastPrice === null) return
    try {
      if (interval === 'day') {
        const next = mergeTick(lastCandleRef.current, kstDateString(), lastPrice)
        lastCandleRef.current = next
        series.update(toBar(next))
        barsRef.current = upsertLast(barsRef.current, next.date, next.close)
      } else {
        const next = mergeTickIntraday(lastIntradayRef.current, bucketStartSec(Date.now(), interval), lastPrice)
        lastIntradayRef.current = next
        series.update(toIntradayBar(next))
        barsRef.current = upsertLast(barsRef.current, next.t as UTCTimestamp, next.close)
        setEmpty(false)
      }
      if (indRef.current) updateIndicatorLast(indRef.current, barsRef.current)
    } catch {
      // lightweight-charts "Cannot update oldest data" 등 — 틱 반영 실패로 앱이 죽지 않게 무시
    }
  }, [lastPrice, loaded, interval])

  // 2-1) 보조지표 켜기/끄기(차트 재생성 시에도 다시 적용 — ticker·interval 의존)
  useEffect(() => {
    const ind = indRef.current
    if (!ind) return
    for (const p of MA_PERIODS) ind.ma[p].applyOptions({ visible: showMa })
    for (const s of [ind.bbUpper, ind.bbMiddle, ind.bbLower]) s.applyOptions({ visible: showBb })
    ind.band.setVisible(showBb)
  }, [showMa, showBb, ticker, interval])

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
    // 분봉은 하루 변동폭이 작아 멀리 있는 지지·저항까지 넓히면 캔들이 납작해진다 — 일봉에서만 넣는다
    const levels = interval === 'day' ? [support, resistance] : []
    fitPricesRef.current = [...levels, entry].filter((p): p is number => p !== null)
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
  }, [support, resistance, entry, side, stopLoss, takeProfit, loaded, interval])

  return (
    <div>
      {/* 한 줄(넘치면 가로 스크롤) — 모바일에서 차트·하단 주문 바가 한 화면에 들어오게 세로 공간 절약 */}
      <div className="mb-2 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        <div role="tablist" aria-label="차트 단위" className="flex shrink-0 gap-1.5">
          {intervals.map((iv) => (
            <button
              key={iv}
              type="button"
              role="tab"
              aria-selected={interval === iv}
              onClick={() => setPicked(iv)}
              className={`${chipClass(interval === iv)} ${CHIP_COMPACT}`}
            >
              {INTERVAL_LABEL[iv]}
            </button>
          ))}
        </div>
        {/* 데스크톱: 지표 칩 2개 그대로 */}
        <div role="group" aria-label="보조지표" className="ml-auto hidden shrink-0 gap-1.5 sm:flex">
          <button type="button" aria-pressed={showMa} onClick={() => setShowMa((v) => !v)} className={chipClass(showMa)}>
            이동평균
          </button>
          <button type="button" aria-pressed={showBb} onClick={() => setShowBb((v) => !v)} className={chipClass(showBb)}>
            볼린저
          </button>
        </div>
        {/* 모바일 폭: '지표 N ▾' 하나 → 차트 위 팝오버(앱과 같은 방식) */}
        <button
          type="button"
          aria-expanded={indOpen}
          aria-haspopup="true"
          onClick={() => setIndOpen((v) => !v)}
          className={`ml-auto shrink-0 sm:hidden ${chipClass(indOpen)} ${CHIP_COMPACT}`}
        >
          지표{(showMa || showBb) && ` ${Number(showMa) + Number(showBb)}`} {indOpen ? '▴' : '▾'}
        </button>
      </div>
      <div className="relative h-[260px] overflow-hidden rounded-card border border-line bg-surface sm:h-[320px]">
        {/* pan-y: 세로 스크롤만 브라우저가 맡고 가로 제스처는 차트가 받음(첫 touchmove 를 브라우저가 가로채 차트가 안 움직이던 문제) */}
        {/* 차트를 누르면 지표 팝오버 닫기 */}
        <div ref={boxRef} className="h-full w-full touch-pan-y" onPointerDown={() => setIndOpen(false)} />
        {indOpen && (
          <div
            role="group"
            aria-label="보조지표"
            className="absolute right-2 top-2 z-20 flex flex-col gap-2 rounded-card border border-line bg-surface p-2.5 shadow-lg sm:hidden"
          >
            <button type="button" aria-pressed={showMa} onClick={() => setShowMa((v) => !v)} className={`${chipClass(showMa)} ${CHIP_COMPACT}`}>
              이동평균 5·20·60
            </button>
            <button type="button" aria-pressed={showBb} onClick={() => setShowBb((v) => !v)} className={`${chipClass(showBb)} ${CHIP_COMPACT}`}>
              볼린저 20·2σ
            </button>
          </div>
        )}
        {showMa && loaded && !failed && !empty && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex gap-1.5 text-[11px] font-bold">
            {MA_PERIODS.map((p) => (
              <span key={p} style={{ color: MA_COLORS[p] }}>
                {p}
              </span>
            ))}
          </div>
        )}
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
