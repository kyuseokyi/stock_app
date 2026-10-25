import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  CrosshairMode, LineType, createChart,
  type IChartApi, type ISeriesApi, type LineData, type MouseEventParams, type Time, type WhitespaceData,
} from 'lightweight-charts'
import { getChartData, searchStocks } from '../api/stockClient'
import { useChartDrawings } from '../hooks/useChartDrawings'
import {
  DrawingsPrimitive, HANDLE_RADIUS, VolumeProfilePrimitive, channelCenterAt, channelHandles, clampIdx, logicalToX, xToLogical,
  type ChannelCoords, type ChannelHandleKey,
} from '../lib/chartDrawings'
import type { ChartData, MaOrder, Stock } from '../types/stock'
import type { ChannelShape, DrawingTool, RectShape } from '../hooks/useChartDrawings'

/** 저장된(id 부여) 채널 도형 */
type StoredChannel = ChannelShape & { id: string }

/** 데이터 좌표 점 (xi=캔들 인덱스, price=가격) */
interface DataPoint {
  xi: number
  price: number
}
/** 사각형 드래그 미리보기 — setPreview 에 type 포함 객체를 넘긴다 */
type RectPreview = RectShape
/** 텍스트 입력 오버레이 위치 */
interface TextInputState {
  px: number
  py: number
  xi: number
  price: number
}
interface Px {
  x: number
  y: number
}
/** 마우스 아래 편집 대상 — 수평선 / 첫 선 끝(C1·C2) / 첫 선 몸통(통째 이동) / 두 번째 선(회전·거리) */
type EditHit =
  | { kind: 'hline'; id: string }
  | { kind: 'handle'; id: string; key: Exclude<ChannelHandleKey, 'B'> }
  | { kind: 'move'; id: string }
  | { kind: 'rotate'; id: string }
/** 끌기 중 상태 — 통째 이동은 시작 도형·커서, 회전은 시작 시점의 픽셀 기하(첫 선 가운데·두 번째 선 끝·커서 극좌표) */
type EditDragState =
  | Exclude<EditHit, { kind: 'move' } | { kind: 'rotate' }>
  | { kind: 'move'; id: string; cxi: number; cprice: number; orig: StoredChannel }
  | { kind: 'rotate'; id: string; m: Px; b1: Px; b2: Px; r0: number; a0: number }
/** 캔들 정보(마우스오버) 박스 위치·대상 캔들 */
interface HoverState {
  x: number
  y: number
  idx: number
}
interface DateRange {
  start: string
  end: string
}
interface ChartSnapshotModalProps {
  open: boolean
  onClose: () => void
  onInsert: (dataURL: string) => void
}

/** 차트 시리즈 묶음(범례 이름으로 보이기/숨기기) */
interface SeriesSet {
  candle: ISeriesApi<'Candlestick'>
  lines: Record<string, ISeriesApi<'Line'>>
  volume: ISeriesApi<'Histogram'>
}

const UP = '#ef4444'
const DOWN = '#3b82f6'
const TRANSPARENT = 'rgba(0,0,0,0)'
/** 범례 순서·색 — 클릭하면 그 시리즈를 숨긴다(BB중심은 범례에 없어 항상 표시) */
const LEGEND = [
  { name: '캔들', color: UP },
  { name: 'MA5', color: '#f59e0b' },
  { name: 'MA20', color: '#8b5cf6' },
  { name: 'MA50', color: '#10b981' },
  { name: 'MA120', color: '#64748b' },
  { name: 'BB상단', color: '#0ea5e9' },
  { name: 'BB하단', color: '#0ea5e9' },
  { name: '거래량', color: '#94a3b8' },
  { name: '매물대', color: 'rgba(100,116,139,0.5)' },
] as const
const LEGEND_OFF = '#cbd5e1'
/** 캡처 PNG 위쪽 제목·범례 줄 높이(CSS px) — 화면의 차트 머리글과 같은 높이 */
const HEADER_H = 44

// 일봉 time 은 'YYYY-MM-DD' — 라이브러리가 BusinessDay 객체로 돌려줄 때도 같은 문자열로 맞춘다.
function isoDate(t: Time): string {
  if (typeof t === 'string') return t
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10)
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}
const mmdd = (t: Time) => isoDate(t).slice(5)

const fmtVolume = (v: number) =>
  v >= 1e8 ? `${(v / 1e8).toFixed(0)}억` : v >= 1e4 ? `${(v / 1e4).toFixed(0)}만` : String(v)

function priceFormatter(currency: string) {
  const digits = currency === 'KRW' ? 0 : 2
  return (v: number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })
}

/** 지표 배열(null=계산 전) → 라인 데이터(null 은 빈 칸) */
function lineData(times: string[], values: (number | null)[] | undefined): (LineData | WhitespaceData)[] {
  return times.map((time, i) => {
    const v = values?.[i]
    return v == null ? { time } : { time, value: v }
  })
}

// 기본 조회 기간: 최근 3개월
function defaultRange(): DateRange {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - 3)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}

const MARKET_BADGE: Record<string, string> = {
  KOSPI: 'bg-red-50 text-red-600',
  KOSDAQ: 'bg-orange-50 text-orange-600',
  NASDAQ: 'bg-blue-50 text-blue-600',
  NYSE: 'bg-indigo-50 text-indigo-600',
  INDEX: 'bg-emerald-50 text-emerald-600',
}

const MA_ORDER_BADGE: Record<MaOrder, { label: string; cls: string }> = {
  PERFECT: { label: '정배열', cls: 'bg-red-50 text-red-600' },
  REVERSE: { label: '역배열', cls: 'bg-blue-50 text-blue-600' },
  MIXED: { label: '혼조', cls: 'bg-slate-100 text-slate-500' },
}

// 2중추세선: 1·2번 클릭 = 첫 선 두 끝(캔들 인덱스로 맞춤), 3번 클릭 = 두 번째 선 위치.
// 두 번째 선은 처음엔 첫 선을 위아래로 옮긴 평행 복사본 — 이후 잡고 끌면 첫 선 가운데를 축으로 회전·거리 조절.
// p3 가 없으면(2번째 클릭 전 미리보기) 두 번째 선 = 첫 선(그리지 않음).
function makeChannel(n: number, a: DataPoint, b: DataPoint, p3?: DataPoint): ChannelCoords {
  const [l, r] = a.xi <= b.xi ? [a, b] : [b, a]
  const x1 = clampIdx(l.xi, n), x2 = clampIdx(r.xi, n)
  const first = { x1, y1: l.price, x2, y2: r.price }
  const d = p3 ? p3.price - channelCenterAt({ ...first, bx1: 0, by1: 0, bx2: 0, by2: 0 }, p3.xi) : 0
  return { ...first, bx1: x1, by1: l.price + d, bx2: x2, by2: r.price + d }
}

/** (x,y) 를 원점 기준 각도 t 만큼 회전 */
const rotate = (p: Px, t: number): Px => ({
  x: p.x * Math.cos(t) - p.y * Math.sin(t),
  y: p.x * Math.sin(t) + p.y * Math.cos(t),
})

const sq = (v: number) => v * v
/** 점 (px,py) 와 선분 (ax,ay)-(bx,by) 사이 픽셀 거리 */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const len2 = sq(bx - ax) + sq(by - ay)
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2))
  return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
}
/** 선을 잡았다고 볼 거리(px) */
const LINE_HIT_PX = 5

/** 본문 삽입 PNG 머리글 — 제목(가운데)·범례(오른쪽, 숨긴 항목은 회색). 화면 머리글과 같은 배치 */
function paintHeader(
  ctx: CanvasRenderingContext2D, width: number, r: number, title: string,
  legend: readonly { name: string; color: string }[], hidden: Set<string>,
) {
  ctx.fillStyle = '#0f172a'
  ctx.font = `bold ${14 * r}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, width / 2, 12 * r)
  ctx.font = `${12 * r}px sans-serif`
  ctx.textAlign = 'left'
  let x = width - 10 * r
  const y = 32 * r
  for (const item of [...legend].reverse()) {
    const off = hidden.has(item.name)
    x -= ctx.measureText(item.name).width
    ctx.fillStyle = off ? LEGEND_OFF : '#334155'
    ctx.fillText(item.name, x, y)
    x -= 18 * r
    ctx.fillStyle = off ? LEGEND_OFF : item.color
    ctx.fillRect(x, y - 4 * r, 14 * r, 8 * r)
    x -= 12 * r
  }
}

export default function ChartSnapshotModal({ open, onClose, onInsert }: ChartSnapshotModalProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [selected, setSelected] = useState<Stock | null>(null)
  const [range, setRange] = useState(defaultRange)
  const [bbStdDev, setBbStdDev] = useState(2.0)
  const [showVP, setShowVP] = useState(true) // 매물대 표시 토글
  const [showTooltip, setShowTooltip] = useState(false) // 캔들 인포창(마우스오버) — 기본 off
  const [chart, setChart] = useState<ChartData | null>(null)
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 범례에서 끈 시리즈 — 이평선은 5·20·50일이 기본, 120일은 꺼 두고 범례로 켠다
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(['MA120']))
  const [editHover, setEditHover] = useState<EditHit['kind'] | null>(null) // 커서 모양용
  const [hover, setHover] = useState<HoverState | null>(null)

  // 차트(lightweight-charts) 인스턴스 — 데이터가 바뀔 때만 다시 만든다. 도형은 primitive 상태만 갱신.
  const boxRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<SeriesSet | null>(null)
  const drawRef = useRef<DrawingsPrimitive | null>(null)
  const vpRef = useRef<VolumeProfilePrimitive | null>(null)

  // 드로잉
  const { tool, toggleTool, setTool, shapes, addShape, removeShape, updateShape, clearAll } =
    useChartDrawings()
  const [preview, setPreview] = useState<RectPreview | null>(null) // 사각형 드래그 미리보기
  const [channelPreview, setChannelPreview] = useState<ChannelCoords | null>(null) // 채널 미리보기
  const [textInput, setTextInput] = useState<TextInputState | null>(null) // { px, py, xi, price }
  const dragStartRef = useRef<DataPoint | null>(null) // 사각형 드래그 시작점
  const chPtsRef = useRef<DataPoint[]>([]) // 채널 진행 점들(첫 선 2점)
  const editDragRef = useRef<EditDragState | null>(null) // 끌고 있는 수평선·2중추세선
  const suppressClickRef = useRef(false) // 핸들 드래그 직후의 click(그리기 추가) 억제

  // 그리는 중 ESC → 진행 중 드로잉 취소(모달은 유지)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const inProgress =
        chPtsRef.current.length ||
        dragStartRef.current ||
        channelPreview ||
        preview ||
        textInput
      if (!inProgress) return
      e.stopPropagation()
      chPtsRef.current = []
      dragStartRef.current = null
      setChannelPreview(null)
      setPreview(null)
      setTextInput(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, channelPreview, preview, textInput])

  // 검색어 debounce → searchStocks
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      searchStocks(query.trim())
        .then(setResults)
        .catch(() => setError('종목 검색에 실패했습니다. (stock_api 8002 확인)'))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  // 차트 생성 — 스크롤·확대 없는 고정 화면(기존 ECharts 와 같음, 그리기 드래그가 차트를 밀지 않게)
  useEffect(() => {
    const box = boxRef.current
    if (!chart || !box) return
    const digits = chart.currency === 'KRW' ? 0 : 2
    const api = createChart(box, {
      autoSize: true,
      layout: { background: { color: '#ffffff' }, textColor: '#475569', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: '#f1f5f9' } },
      // 위 = 가격(약 64%), 아래 = 거래량(약 20%) — 기존 2단 그리드 비율
      rightPriceScale: { borderColor: '#94a3b8', scaleMargins: { top: 0.06, bottom: 0.3 } },
      timeScale: {
        borderColor: '#94a3b8',
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 0,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (t: Time) => mmdd(t),
      },
      localization: { timeFormatter: (t: Time) => isoDate(t), priceFormatter: priceFormatter(chart.currency) },
      handleScroll: false,
      handleScale: false,
    })
    const times = chart.candles.map((c) => c.date)
    const common = { lastValueVisible: false, priceLineVisible: false } as const
    const candle = api.addCandlestickSeries({
      ...common,
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      priceFormat: { type: 'price', precision: digits, minMove: digits ? 0.01 : 1 },
    })
    candle.setData(chart.candles.map((c, i) => ({ time: times[i], open: c.open, high: c.high, low: c.low, close: c.close })))
    const line = (color: string, values: (number | null)[] | undefined, curved: boolean) => {
      const s = api.addLineSeries({
        ...common, color, lineWidth: 1, crosshairMarkerVisible: false,
        lineType: curved ? LineType.Curved : LineType.Simple,
      })
      s.setData(lineData(times, values))
      return s
    }
    const bb = chart.bollinger
    const lines: Record<string, ISeriesApi<'Line'>> = {
      MA5: line('#f59e0b', chart.ma5, true),
      MA20: line('#8b5cf6', chart.ma20, true),
      MA50: line('#10b981', chart.ma50, true),
      MA120: line('#64748b', chart.ma120, true),
      BB상단: line('#0ea5e9', bb?.upper, false),
      BB중심: line('rgba(14,165,233,0.6)', bb?.mid, false),
      BB하단: line('#0ea5e9', bb?.lower, false),
    }
    // 거래량: 상승(종가≥시가) 빨강 / 하락 파랑 (한국 관례), 아래 칸 overlay 스케일
    const volume = api.addHistogramSeries({ ...common, priceScaleId: 'vol', priceFormat: { type: 'volume' } })
    api.priceScale('vol').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })
    volume.setData(chart.candles.map((c, i) => ({ time: times[i], value: c.volume, color: c.close >= c.open ? UP : DOWN })))

    const vp = new VolumeProfilePrimitive()
    candle.attachPrimitive(vp)
    vp.setBins(chart.volumeProfile)
    // 도형 운반용 — 마지막에 추가해 모든 시리즈 위에 그려지고, 범례로 숨기는 일이 없다(종가 데이터·투명색).
    const carrier = api.addLineSeries({
      ...common, color: TRANSPARENT, lineVisible: false, pointMarkersVisible: false, crosshairMarkerVisible: false,
    })
    carrier.setData(chart.candles.map((c, i) => ({ time: times[i], value: c.close })))
    const draw = new DrawingsPrimitive()
    carrier.attachPrimitive(draw)
    api.timeScale().fitContent()

    apiRef.current = api
    seriesRef.current = { candle, lines, volume }
    vpRef.current = vp
    drawRef.current = draw
    return () => {
      api.remove()
      apiRef.current = null
      seriesRef.current = null
      vpRef.current = null
      drawRef.current = null
      setHover(null)
    }
  }, [chart])

  // 범례·매물대 토글 → 시리즈 보이기/숨기기. 캔들은 색만 투명하게(도형이 캔들 시리즈에 붙어 있어 함께 사라지지 않게).
  useEffect(() => {
    const s = seriesRef.current
    if (!s) return
    const off = (name: string) => hidden.has(name)
    s.candle.applyOptions(
      off('캔들')
        ? { upColor: TRANSPARENT, downColor: TRANSPARENT, borderVisible: false, wickVisible: false }
        : { upColor: UP, downColor: DOWN, borderVisible: true, wickVisible: true },
    )
    for (const [name, series] of Object.entries(s.lines)) {
      series.applyOptions({ visible: name === 'BB중심' || !off(name) })
    }
    s.volume.applyOptions({ visible: !off('거래량') })
    vpRef.current?.setVisible(showVP && !off('매물대'))
  }, [chart, hidden, showVP])

  // 도형·미리보기 → 그리기 레이어
  useEffect(() => {
    if (!chart) return
    drawRef.current?.setState({
      shapes,
      rectPreview: preview,
      channelPreview,
      editable: true,
      candleCount: chart.candles.length,
      formatPrice: priceFormatter(chart.currency),
    })
  }, [chart, shapes, preview, channelPreview])

  // 캔들 정보 — 켤 때만 십자선 + 정보 박스. 끄면 십자선도 숨김(기존과 같음).
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const shown = { visible: showTooltip, labelVisible: showTooltip }
    api.applyOptions({ crosshair: { mode: CrosshairMode.Normal, vertLine: shown, horzLine: shown } })
    if (!showTooltip) {
      setHover(null)
      return
    }
    const onMove = (p: MouseEventParams<Time>) => {
      if (!p.point || p.logical == null || p.logical < 0) {
        setHover(null)
        return
      }
      setHover({ x: p.point.x, y: p.point.y, idx: Math.round(p.logical) })
    }
    api.subscribeCrosshairMove(onMove)
    return () => api.unsubscribeCrosshairMove(onMove)
  }, [chart, showTooltip])

  const loadChart = async (stock: Stock, r: DateRange, std: number) => {
    setLoading(true)
    setError('')
    try {
      const data = await getChartData(stock.symbol, r.start, r.end, std)
      if (!data || data.candles.length === 0) {
        setChart(null)
        setError('해당 기간의 데이터가 없습니다.')
      } else {
        setChart(data)
      }
    } catch {
      setError('차트 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (stock: Stock) => {
    setSelected(stock)
    setResults([])
    setQuery(stock.name)
    loadChart(stock, range, bbStdDev)
  }

  const handleRangeChange = (field: keyof DateRange, val: string) => {
    const next = { ...range, [field]: val }
    setRange(next)
    if (selected) loadChart(selected, next, bbStdDev)
  }

  const handleBbChange = (val: number) => {
    setBbStdDev(val)
    if (selected) loadChart(selected, range, val)
  }

  // 마우스 위치(차트 상자 기준) → 데이터 좌표
  const toData = (e: ReactMouseEvent) => {
    const api = apiRef.current
    const candle = seriesRef.current?.candle
    const box = boxRef.current
    if (!api || !candle || !box) return null
    const rect = box.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const xi = api.timeScale().coordinateToLogical(px)
    const price = candle.coordinateToPrice(py)
    if (xi == null || price == null || Number.isNaN(price)) return null
    return { xi: Number(xi), price, px, py }
  }

  // 데이터 좌표 → 픽셀(snap=캔들 인덱스로 맞춤 — 첫 선 끝. 두 번째 선은 회전 결과라 소수 x 그대로)
  const toPx = (xi: number, price: number, snap = true): Px | null => {
    const api = apiRef.current
    const candle = seriesRef.current?.candle
    const n = chart?.candles.length ?? 0
    if (!api || !candle || !n) return null
    const x = logicalToX(api.timeScale(), snap ? clampIdx(xi, n) : xi)
    const y = candle.priceToCoordinate(price)
    return x === null || y === null ? null : { x, y }
  }

  // 편집 대상 히트테스트(도구 상태 무관): 핸들 > 수평선 > 두 번째 선(회전) > 첫 선(통째 이동)
  const hitTestEdit = (px: number, py: number): EditHit | null => {
    const candle = seriesRef.current?.candle
    if (!candle) return null
    const channels = shapes.filter((s): s is StoredChannel => s.type === 'channel')
    for (const ch of channels) {
      for (const pt of channelHandles(ch)) {
        const q = toPx(pt.xi, pt.price, pt.key !== 'B')
        if (q && Math.hypot(q.x - px, q.y - py) <= HANDLE_RADIUS + 5.5) {
          return pt.key === 'B' ? { kind: 'rotate', id: ch.id } : { kind: 'handle', id: ch.id, key: pt.key }
        }
      }
    }
    for (const s of shapes) {
      if (s.type !== 'hline') continue
      const y = candle.priceToCoordinate(s.price)
      if (y !== null && Math.abs(y - py) <= LINE_HIT_PX) return { kind: 'hline', id: s.id }
    }
    for (const ch of channels) {
      const a = toPx(ch.bx1, ch.by1, false), b = toPx(ch.bx2, ch.by2, false)
      if (a && b && distToSegment(px, py, a.x, a.y, b.x, b.y) <= LINE_HIT_PX) return { kind: 'rotate', id: ch.id }
    }
    for (const ch of channels) {
      const a = toPx(ch.x1, ch.y1), b = toPx(ch.x2, ch.y2)
      if (a && b && distToSegment(px, py, a.x, a.y, b.x, b.y) <= LINE_HIT_PX) return { kind: 'move', id: ch.id }
    }
    return null
  }

  const onChartClick = (e: ReactMouseEvent) => {
    // 선·핸들을 잡아 끈 직후의 click 은 그리기 추가로 이어지지 않게 무시
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (tool !== 'channel' && chPtsRef.current.length) {
      chPtsRef.current = []
      setChannelPreview(null)
    }
    if (!tool || tool === 'rect' || !chart) return
    const p = toData(e)
    if (!p) return
    if (tool === 'hline') addShape({ type: 'hline', price: p.price })
    else if (tool === 'text') setTextInput({ px: p.px, py: p.py, xi: p.xi, price: p.price })
    else if (tool === 'channel') {
      // 1·2번 클릭: 첫 선, 3번 클릭: 두 번째 선 위치(첫 선의 평행 복사본). 스냅 없이 클릭 위치 그대로.
      const pts = [...chPtsRef.current, { xi: p.xi, price: p.price }]
      chPtsRef.current = pts
      if (pts.length === 3) {
        const n = chart.candles.length
        // 첫 선 두 점이 같은 캔들이면(세로 클릭) 만들지 않는다
        if (clampIdx(pts[0].xi, n) !== clampIdx(pts[1].xi, n)) {
          addShape({ type: 'channel', ...makeChannel(n, pts[0], pts[1], pts[2]) })
        }
        chPtsRef.current = []
        setChannelPreview(null)
      }
    }
  }

  const onChartMouseDown = (e: ReactMouseEvent) => {
    // 수평선·2중추세선을 잡으면(도구 상태 무관) 끌기 시작 + 뒤따르는 click 억제
    const p = toData(e)
    if (!p) return
    const hit = hitTestEdit(p.px, p.py)
    if (hit) {
      const ch = shapes.find((s) => s.id === hit.id) as StoredChannel | undefined // move·rotate 히트는 channel 도형에서만
      if (hit.kind === 'move') {
        if (ch) editDragRef.current = { kind: 'move', id: hit.id, cxi: p.xi, cprice: p.price, orig: ch }
      } else if (hit.kind === 'rotate') {
        const a1 = ch && toPx(ch.x1, ch.y1), a2 = ch && toPx(ch.x2, ch.y2)
        const b1 = ch && toPx(ch.bx1, ch.by1, false), b2 = ch && toPx(ch.bx2, ch.by2, false)
        if (a1 && a2 && b1 && b2) {
          const m = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 }
          const r0 = Math.hypot(p.px - m.x, p.py - m.y)
          const a0 = Math.atan2(p.py - m.y, p.px - m.x)
          editDragRef.current = { kind: 'rotate', id: hit.id, m, b1, b2, r0, a0 }
        }
      } else {
        editDragRef.current = hit
      }
      suppressClickRef.current = true
      return
    }
    if (tool !== 'rect') return
    dragStartRef.current = { xi: p.xi, price: p.price }
    setPreview(null)
  }

  const onChartMouseMove = (e: ReactMouseEvent) => {
    const p = toData(e)
    if (!p) return
    const n = chart?.candles.length ?? 0
    const d = editDragRef.current
    if (d) {
      if (d.kind === 'hline') {
        updateShape(d.id, { price: p.price }) // 잡은 수평선을 위아래로
        return
      }
      const ch = shapes.find((s) => s.id === d.id) as StoredChannel | undefined
      if (!ch) return
      if (d.kind === 'move') {
        // 첫 선을 잡고 끌면 2중추세선 통째 이동(두 선 모양 유지). x 이동은 첫 선 두 끝이 차트 밖으로 나가지 않게 제한.
        const o = d.orig
        const dxi = Math.max(-Math.min(o.x1, o.x2), Math.min(n - 1 - Math.max(o.x1, o.x2), Math.round(p.xi - d.cxi)))
        const dprice = p.price - d.cprice
        updateShape(d.id, {
          x1: o.x1 + dxi, x2: o.x2 + dxi, y1: o.y1 + dprice, y2: o.y2 + dprice,
          bx1: o.bx1 + dxi, bx2: o.bx2 + dxi, by1: o.by1 + dprice, by2: o.by2 + dprice,
        })
        return
      }
      if (d.kind === 'rotate') {
        // 두 번째 선: 첫 선 가운데(m)를 축으로 커서가 돈 각도만큼 회전 + 커서가 멀어진 만큼 바깥으로(화면 픽셀 기준).
        const api = apiRef.current
        const candle = seriesRef.current?.candle
        if (!api || !candle) return
        const dTheta = Math.atan2(p.py - d.m.y, p.px - d.m.x) - d.a0
        const dr = Math.hypot(p.px - d.m.x, p.py - d.m.y) - d.r0
        const q1 = rotate({ x: d.b1.x - d.m.x, y: d.b1.y - d.m.y }, dTheta)
        const q2 = rotate({ x: d.b2.x - d.m.x, y: d.b2.y - d.m.y }, dTheta)
        const mid = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 }
        const len = Math.hypot(mid.x, mid.y)
        const dir = len > 1e-6 ? { x: mid.x / len, y: mid.y / len } : { x: 0, y: -1 }
        const toData = (q: Px) => {
          const xi = xToLogical(api.timeScale(), d.m.x + q.x + dir.x * dr)
          const price = candle.coordinateToPrice(d.m.y + q.y + dir.y * dr)
          return xi === null || price === null ? null : { xi, price }
        }
        const e1 = toData(q1), e2 = toData(q2)
        if (e1 && e2) updateShape(d.id, { bx1: e1.xi, by1: e1.price, bx2: e2.xi, by2: e2.price })
        return
      }
      // 첫 선 끝 핸들: 그 끝만 옮김(두 번째 선은 그대로)
      const xi = clampIdx(p.xi, n)
      if (d.key === 'C1' && xi !== ch.x2) updateShape(d.id, { x1: xi, y1: p.price })
      else if (d.key === 'C2' && xi !== ch.x1) updateShape(d.id, { x2: xi, y2: p.price })
      return
    }
    setEditHover(hitTestEdit(p.px, p.py)?.kind ?? null)
    const drag = dragStartRef.current
    if (tool === 'rect' && drag) {
      setPreview({ type: 'rect', xi1: drag.xi, y1: drag.price, xi2: p.xi, y2: p.price })
    } else if (tool === 'channel' && chPtsRef.current.length) {
      // 1점: 커서까지 첫 선 미리보기 / 2점: 커서 위치에 두 번째 선 미리보기
      const pts = chPtsRef.current
      setChannelPreview(pts.length >= 2 ? makeChannel(n, pts[0], pts[1], p) : makeChannel(n, pts[0], p))
    }
  }

  const onChartMouseUp = (e: ReactMouseEvent) => {
    // 편집 드래그 종료
    if (editDragRef.current) {
      editDragRef.current = null
      return
    }
    const drag = dragStartRef.current
    if (tool !== 'rect' || !drag) return
    const p = toData(e)
    if (p) addShape({ type: 'rect', xi1: drag.xi, y1: drag.price, xi2: p.xi, y2: p.price })
    dragStartRef.current = null
    setPreview(null)
  }

  if (!open) return null

  const legend = LEGEND.filter((l) => showVP || l.name !== '매물대')
  const toggleLegend = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const commitText = (val: string) => {
    if (textInput && val.trim()) {
      addShape({ type: 'text', xi: textInput.xi, price: textInput.price, text: val.trim() })
    }
    setTextInput(null)
  }

  // 본문 삽입 PNG = 머리글(제목·범례) + 차트 캔버스(도형 포함). 흰 배경.
  const handleInsert = () => {
    const api = apiRef.current
    const box = boxRef.current
    if (!api || !box || !chart) return
    // 편집 핸들(흰 원)은 이미지에 넣지 않는다 — takeScreenshot 이 대기 중인 다시 그리기를 먼저 반영한다
    drawRef.current?.setState({
      shapes, rectPreview: null, channelPreview: null, editable: false,
      candleCount: chart.candles.length, formatPrice: priceFormatter(chart.currency),
    })
    const shot = api.takeScreenshot()
    const r = shot.width / Math.max(1, box.clientWidth) // 기기 픽셀 배율
    const headerH = Math.round(HEADER_H * r)
    const out = document.createElement('canvas')
    out.width = shot.width
    out.height = shot.height + headerH
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    paintHeader(ctx, out.width, r, `${chart.name} (${chart.symbol})`, legend, hidden)
    ctx.drawImage(shot, 0, headerH)
    onInsert(out.toDataURL('image/png'))
    clearAll()
    setTool(null)
    setPreview(null)
    setChannelPreview(null)
    chPtsRef.current = []
    onClose()
  }

  const hoverCandle = hover && chart ? chart.candles[hover.idx] : undefined
  const fmtPrice = chart ? priceFormatter(chart.currency) : String
  const boxWidth = boxRef.current?.clientWidth ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-[1344px] flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">차트 삽입 — 종목 검색</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 검색 */}
        <div className="relative">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
            }}
            onKeyDown={(e) => {
              // 부모 폼 submit(→모달 닫힘) 방지. Enter 시 첫 검색결과 선택
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!selected && results.length > 0) handleSelect(results[0])
              }
            }}
            placeholder="국내외 종목·지수 검색 (예: 삼성, AAPL, KOSPI)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {!selected && results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((s) => (
                <li key={s.symbol}>
                  <button type="button"
                    onClick={() => handleSelect(s)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-800">
                      {s.name} <span className="text-slate-400">{s.symbol}</span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        MARKET_BADGE[s.market] || 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {s.market}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searching && !selected && (
            <p className="absolute right-3 top-2.5 text-xs text-slate-400">검색 중…</p>
          )}
        </div>

        {/* 기간 + 볼린저 편차 + 정배열/역배열 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <label className="text-slate-500">기간</label>
            <input
              type="date"
              value={range.start}
              onChange={(e) => handleRangeChange('start', e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1"
            />
            <span className="text-slate-400">~</span>
            <input
              type="date"
              value={range.end}
              onChange={(e) => handleRangeChange('end', e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-slate-500">볼린저 σ</label>
            <input
              type="number"
              min="0.5"
              max="4"
              step="0.1"
              value={bbStdDev}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isNaN(v) && v > 0) handleBbChange(v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault()
              }}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1 tabular-nums"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-1.5 text-slate-600">
            <input
              type="checkbox"
              checked={showVP}
              onChange={(e) => setShowVP(e.target.checked)}
              className="accent-slate-500"
            />
            매물대
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-slate-600">
            <input
              type="checkbox"
              checked={showTooltip}
              onChange={(e) => setShowTooltip(e.target.checked)}
              className="accent-slate-500"
            />
            캔들 정보
          </label>

          {chart && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                MA_ORDER_BADGE[chart.maOrder]?.cls || MA_ORDER_BADGE.MIXED.cls
              }`}
              title="MA5·20·50·120 배열 상태"
            >
              {MA_ORDER_BADGE[chart.maOrder]?.label || '혼조'}
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {/* 드로잉 툴바 */}
        {chart && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">그리기</span>
            {([
              { key: 'hline', label: '수평선 ─' },
              { key: 'channel', label: '2중추세선 ⧉' },
              { key: 'rect', label: '사각형 ▭' },
              { key: 'text', label: '텍스트 T' },
            ] satisfies { key: DrawingTool; label: string }[]).map((b) => (
              <button type="button"
                key={b.key}
                onClick={() => toggleTool(b.key)}
                className={`rounded-lg border px-2.5 py-1 ${
                  tool === b.key
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {b.label}
              </button>
            ))}
            {shapes.length > 0 && (
              <button type="button"
                onClick={clearAll}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-500 hover:bg-slate-50"
              >
                전체지우기
              </button>
            )}
            {tool && (
              <span className="text-xs text-slate-400">
                {tool === 'hline' && '차트를 클릭해 수평선을 추가 · 그린 선은 잡고 위아래로 이동'}
                {tool === 'channel' &&
                  '3번 클릭: 첫 선 2점 → 두 번째 선 위치 1점 · 두 선 가운데 중심선, 끝은 점선으로 연결'}
                {tool === 'rect' && '드래그해 사각형 영역을 지정'}
                {tool === 'text' && '클릭한 위치에 텍스트를 입력'}
              </span>
            )}
            {shapes.some((s) => s.type === 'channel') && (
              <span className="text-xs text-slate-400">
                편집: 두 번째 선(초록)을 잡고 끌면 첫 선 가운데를 축으로 회전·거리 조절 · 첫 선 끝 핸들로 끝점 · 첫 선을 잡으면 통째 이동
              </span>
            )}
          </div>
        )}

        {/* 그린 항목 칩 (개별 삭제) */}
        {shapes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shapes.map((s, i) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                {s.type === 'hline' && `수평선 ${i + 1}`}
                {s.type === 'channel' && `2중추세선 ${i + 1}`}
                {s.type === 'rect' && `사각형 ${i + 1}`}
                {s.type === 'text' && `텍스트: ${s.text}`}
                <button type="button"
                  onClick={() => removeShape(s.id)}
                  className="text-slate-400 hover:text-red-500"
                  aria-label="삭제"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 차트 — 머리글(제목·범례) + 캔버스. 불러오는 동안에도 상자는 유지(차트 인스턴스 보존) */}
        <div className="relative mt-3 flex h-[62vh] min-h-[340px] flex-col rounded-lg border border-slate-200">
          {chart ? (
            <>
              <div className="flex shrink-0 flex-col items-center px-2.5" style={{ height: HEADER_H }}>
                <p className="pt-1 text-sm font-bold text-slate-900">
                  {chart.name} ({chart.symbol})
                </p>
                <div className="flex w-full flex-wrap justify-end gap-x-3 text-xs">
                  {legend.map((l) => {
                    const off = hidden.has(l.name)
                    return (
                      <button
                        type="button"
                        key={l.name}
                        onClick={() => toggleLegend(l.name)}
                        className="inline-flex items-center gap-1"
                        style={{ color: off ? LEGEND_OFF : '#334155' }}
                        aria-pressed={!off}
                      >
                        <span className="inline-block h-2 w-3.5" style={{ background: off ? LEGEND_OFF : l.color }} />
                        {l.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div
                className="relative min-h-0 flex-1"
                style={{ cursor: editHover === 'hline' ? 'ns-resize' : editHover ? 'grab' : tool ? 'crosshair' : 'default' }}
                onClick={onChartClick}
                onMouseDown={onChartMouseDown}
                onMouseMove={onChartMouseMove}
                onMouseUp={onChartMouseUp}
              >
                <div ref={boxRef} className="absolute inset-0" />

                {/* 캔들 정보(마우스오버) */}
                {hover && hoverCandle && (
                  <div
                    className="pointer-events-none absolute z-10 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs text-slate-700 shadow"
                    style={{
                      left: hover.x + 180 > boxWidth ? hover.x - 172 : hover.x + 14,
                      top: Math.max(4, hover.y - 60),
                      width: 158,
                    }}
                  >
                    <p className="mb-0.5 font-semibold text-slate-900">{hoverCandle.date}</p>
                    {([
                      ['시가', hoverCandle.open],
                      ['고가', hoverCandle.high],
                      ['저가', hoverCandle.low],
                      ['종가', hoverCandle.close],
                    ] as const).map(([k, v]) => (
                      <p key={k} className="flex justify-between tabular-nums">
                        <span className="text-slate-500">{k}</span>
                        {fmtPrice(v)}
                      </p>
                    ))}
                    {(['ma5', 'ma20', 'ma50', 'ma120'] as const).map((k) => {
                      const v = chart[k][hover.idx]
                      return v == null ? null : (
                        <p key={k} className="flex justify-between tabular-nums">
                          <span className="text-slate-500">{k.toUpperCase()}</span>
                          {fmtPrice(v)}
                        </p>
                      )
                    })}
                    <p className="flex justify-between tabular-nums">
                      <span className="text-slate-500">거래량</span>
                      {fmtVolume(hoverCandle.volume)}
                    </p>
                  </div>
                )}

                {/* 텍스트 입력 오버레이 (임시 — 확정 시 그리기 레이어에 배치) */}
                {textInput && (
                  <input
                    autoFocus
                    defaultValue=""
                    placeholder="텍스트 입력 후 Enter"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitText((e.target as HTMLInputElement).value) // KeyboardEvent<input>.target 은 EventTarget
                      else if (e.key === 'Escape') setTextInput(null)
                    }}
                    onBlur={(e) => commitText((e.target as HTMLInputElement).value)} // FocusEvent<input>.target 은 EventTarget
                    style={{
                      position: 'absolute',
                      left: Math.max(0, Math.min(textInput.px, boxWidth - 170)),
                      top: textInput.py,
                    }}
                    className="z-10 w-40 rounded border border-indigo-400 bg-white px-2 py-1 text-xs shadow"
                  />
                )}
              </div>
              {loading && (
                <p className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 text-sm text-slate-400">
                  차트 불러오는 중…
                </p>
              )}
            </>
          ) : loading ? (
            <p className="py-32 text-center text-sm text-slate-400">차트 불러오는 중…</p>
          ) : (
            <p className="py-32 text-center text-sm text-slate-400">
              종목을 검색해 선택하면 차트가 표시됩니다.
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <button type="button"
            onClick={handleInsert}
            disabled={!chart}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            본문에 삽입
          </button>
        </div>
      </div>
    </div>
  )
}
