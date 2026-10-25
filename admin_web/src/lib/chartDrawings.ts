import type {
  ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, ITimeScaleApi, Logical,
  SeriesAttachedParameter, Time,
} from 'lightweight-charts'
import type { ChannelShape, HLineShape, RectShape, Shape, TextShape } from '../hooks/useChartDrawings'
import type { VolumeProfileBin } from '../types/stock'

// 관리자 차트 삽입(ChartSnapshotModal)의 그리기 레이어 — lightweight-charts v4 시리즈 primitive.
// 도형은 데이터 좌표(xi=캔들 인덱스=logical, price)로 받고 그릴 때마다 픽셀로 변환한다.
// primitive 는 캔버스에 그려지므로 takeScreenshot(본문 삽입 PNG)에 그대로 포함된다.

type DrawTarget = Parameters<ISeriesPrimitivePaneRenderer['draw']>[0]
type Ctx = CanvasRenderingContext2D

/** 채널 좌표(makeChannel 반환) */
export type ChannelCoords = Omit<ChannelShape, 'type'>

export const clampIdx = (i: number, len: number) => Math.max(0, Math.min(len - 1, Math.round(i)))
/** 범위만 자름(반올림 없음) — 가운데 축 회전으로 캔들 사이에 걸친 2중추세선 첫 선 끝 */
export const clampX = (i: number, len: number) => Math.max(0, Math.min(len - 1, i))

// lightweight-charts 4.2.3 의 logicalToCoordinate 는 소수 인덱스면 0, coordinateToLogical 은 정수로 반올림한다.
// 회전한 두 번째 선처럼 캔들 사이에 걸치는 점을 위해 이웃 두 캔들 좌표로 선형 보간한다(막대 간격 일정).
type TimeScaleLike = Pick<ITimeScaleApi<Time>, 'logicalToCoordinate' | 'coordinateToLogical'>

export function logicalToX(ts: TimeScaleLike, xi: number): number | null {
  const i0 = Math.floor(xi)
  const x0 = ts.logicalToCoordinate(i0 as Logical)
  if (x0 === null || xi === i0) return x0
  const x1 = ts.logicalToCoordinate((i0 + 1) as Logical)
  return x1 === null ? null : x0 + (xi - i0) * (x1 - x0)
}

export function xToLogical(ts: TimeScaleLike, x: number): number | null {
  const l = ts.coordinateToLogical(x)
  if (l === null) return null
  const x0 = ts.logicalToCoordinate(l)
  const x1 = ts.logicalToCoordinate((l + 1) as Logical)
  if (x0 === null || x1 === null || x1 === x0) return Number(l)
  return Number(l) + (x - x0) / (x1 - x0)
}

/** 부착 공통 — 차트·시리즈 참조와 다시 그리기 요청 */
abstract class BasePrimitive implements ISeriesPrimitive<Time> {
  protected param: SeriesAttachedParameter<Time> | null = null
  private readonly view: ISeriesPrimitivePaneView

  // 'top' 은 십자선 캔버스에 그려져 takeScreenshot 에서 빠진다 → 캡처에 들어가야 하는 레이어는 bottom/normal 만.
  constructor(zOrder: 'bottom' | 'normal') {
    const renderer: ISeriesPrimitivePaneRenderer = {
      draw: (target: DrawTarget) =>
        target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize.width)),
    }
    this.view = { zOrder: () => zOrder, renderer: () => renderer }
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.param = param
  }

  detached() {
    this.param = null
  }

  paneViews() {
    return [this.view]
  }

  protected update() {
    this.param?.requestUpdate()
  }

  protected x(xi: number): number | null {
    return this.param ? logicalToX(this.param.chart.timeScale(), xi) : null
  }

  protected y(price: number): number | null {
    return this.param?.series.priceToCoordinate(price) ?? null
  }

  protected abstract paint(ctx: Ctx, width: number): void
}

// 매물대(Volume Profile): 왼쪽 끝에서 오른쪽으로 뻗는 가격대별 누적 거래량 가로막대(폭 최대 28%), 캔들 뒤.
export class VolumeProfilePrimitive extends BasePrimitive {
  private bins: VolumeProfileBin[] = []
  private visible = true

  constructor() {
    super('bottom')
  }

  setBins(bins: VolumeProfileBin[]) {
    this.bins = bins
    this.update()
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.update()
  }

  protected paint(ctx: Ctx, width: number) {
    if (!this.visible || !this.bins.length) return
    const maxVol = Math.max(1, ...this.bins.map((b) => b.volume))
    ctx.fillStyle = 'rgba(100,116,139,0.28)'
    for (const bin of this.bins) {
      const yHigh = this.y(bin.priceHigh)
      const yLow = this.y(bin.priceLow)
      if (yHigh === null || yLow === null) continue
      const w = (bin.volume / maxVol) * (width * 0.28)
      const h = Math.max(1, Math.abs(yLow - yHigh) - 1)
      ctx.fillRect(0, Math.min(yHigh, yLow), w, h)
    }
  }
}

export interface DrawingsState {
  shapes: Shape[]
  rectPreview: RectShape | null
  channelPreview: ChannelCoords | null
  /** 편집 모드 — 저장된 2중추세선 끝점에 드래그 핸들(흰 원). 본문 삽입 캡처 때는 끈다 */
  editable: boolean
  candleCount: number
  formatPrice: (v: number) => string
}

export const HANDLE_RADIUS = 6.5

/** 2중추세선 핸들 키 — C1·C2 = 첫 선 끝, B = 두 번째 선 가운데(잡고 끌면 회전·거리) */
export type ChannelHandleKey = 'C1' | 'C2' | 'B'

/** 두 번째 선이 아직 없음(첫 선만 그린 미리보기) — 두 선이 같은 위치 */
export const hasSecond = (ch: ChannelCoords) =>
  ch.bx1 !== ch.x1 || ch.by1 !== ch.y1 || ch.bx2 !== ch.x2 || ch.by2 !== ch.y2

/** 2중추세선 핸들(위치·히트테스트 공용). 첫 선 끝은 캔들에 맞춘 정수 x, 두 번째 선은 회전 결과라 소수 x */
export function channelHandles(ch: ChannelCoords) {
  const pts: { key: ChannelHandleKey; xi: number; price: number }[] = [
    { key: 'C1', xi: ch.x1, price: ch.y1 },
    { key: 'C2', xi: ch.x2, price: ch.y2 },
  ]
  if (hasSecond(ch)) pts.push({ key: 'B', xi: (ch.bx1 + ch.bx2) / 2, price: (ch.by1 + ch.by2) / 2 })
  return pts
}

/** 첫 선 위 x 에서의 가격 */
export function channelCenterAt(ch: ChannelCoords, xi: number) {
  return Math.abs(ch.x2 - ch.x1) < 0.5 ? ch.y1 : ch.y1 + ((ch.y2 - ch.y1) / (ch.x2 - ch.x1)) * (xi - ch.x1)
}

// 수평선·사각형·텍스트·2중추세선(+미리보기·핸들). 모든 시리즈 위에 오도록 마지막에 추가한
// 운반용 투명 시리즈(캔들과 같은 가격 스케일)에 normal 순서로 붙인다.
export class DrawingsPrimitive extends BasePrimitive {
  private state: DrawingsState = {
    shapes: [], rectPreview: null, channelPreview: null, editable: false, candleCount: 0, formatPrice: String,
  }

  constructor() {
    super('normal')
  }

  setState(state: DrawingsState) {
    this.state = state
    this.update()
  }

  protected paint(ctx: Ctx, width: number) {
    const { shapes, rectPreview, channelPreview, editable, candleCount: n } = this.state
    if (!n) return
    const rects = shapes.filter((s): s is RectShape & { id: string } => s.type === 'rect')
    for (const r of rectPreview ? [...rects, rectPreview] : rects) this.paintRect(ctx, r, n)
    for (const h of shapes.filter((s): s is HLineShape & { id: string } => s.type === 'hline')) this.paintHLine(ctx, h, width)
    const channels = shapes.filter((s): s is ChannelShape & { id: string } => s.type === 'channel')
    for (const ch of channelPreview ? [...channels, channelPreview] : channels) this.paintChannel(ctx, ch, n)
    for (const t of shapes.filter((s): s is TextShape & { id: string } => s.type === 'text')) this.paintText(ctx, t, n)
    if (editable) for (const ch of channels) this.paintHandles(ctx, ch, n)
  }

  private paintRect(ctx: Ctx, r: RectShape, n: number) {
    const x1 = this.x(clampIdx(r.xi1, n)), x2 = this.x(clampIdx(r.xi2, n))
    const y1 = this.y(Math.max(r.y1, r.y2)), y2 = this.y(Math.min(r.y1, r.y2))
    if (x1 === null || x2 === null || y1 === null || y2 === null) return
    const [l, t, w, h] = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]
    ctx.fillStyle = 'rgba(59,130,246,0.12)'
    ctx.fillRect(l, t, w, h)
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.strokeRect(l, t, w, h)
  }

  private paintHLine(ctx: Ctx, h: HLineShape, width: number) {
    const y = this.y(h.price)
    if (y === null) return
    ctx.strokeStyle = '#e11d48'
    ctx.lineWidth = 1.2
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    // 가격 라벨 — 선 오른쪽 끝 위
    ctx.font = '12px sans-serif'
    ctx.fillStyle = '#e11d48'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(this.state.formatPrice(h.price), width - 4, y - 2)
  }

  private line(ctx: Ctx, i1: number, p1: number, i2: number, p2: number, color: string, width: number, dash: number[] = []) {
    const x1 = this.x(i1), y1 = this.y(p1), x2 = this.x(i2), y2 = this.y(p2)
    if (x1 === null || y1 === null || x2 === null || y2 === null) return
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 2중추세선: 첫 선(빨강)·두 번째 선(초록) 굵게, 같은 쪽 끝끼리 얇은 점선 연결, 두 선 가운데 중심선(노란 점선).
  private paintChannel(ctx: Ctx, ch: ChannelCoords, n: number) {
    const x1 = clampX(ch.x1, n), x2 = clampX(ch.x2, n)
    if (Math.abs(x2 - x1) < 0.5) return
    this.line(ctx, x1, ch.y1, x2, ch.y2, '#f43f5e', 2)
    if (!hasSecond(ch)) return
    this.line(ctx, ch.bx1, ch.by1, ch.bx2, ch.by2, '#10b981', 2)
    this.line(ctx, x1, ch.y1, ch.bx1, ch.by1, '#94a3b8', 1, [2, 3])
    this.line(ctx, x2, ch.y2, ch.bx2, ch.by2, '#94a3b8', 1, [2, 3])
    this.line(ctx, (x1 + ch.bx1) / 2, (ch.y1 + ch.by1) / 2, (x2 + ch.bx2) / 2, (ch.y2 + ch.by2) / 2, '#eab308', 1.5, [5, 4])
  }

  private paintText(ctx: Ctx, t: TextShape, n: number) {
    const x = this.x(clampIdx(t.xi, n)), y = this.y(t.price)
    if (x === null || y === null) return
    ctx.fillStyle = '#0f172a'
    ctx.beginPath()
    ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '12px sans-serif'
    const w = ctx.measureText(t.text).width + 8
    const h = 18
    const left = x - w / 2, top = y - 6 - h
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(left, top, w, h, 3)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#0f172a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t.text, x, top + h / 2)
  }

  private paintHandles(ctx: Ctx, ch: ChannelCoords, n: number) {
    for (const pt of channelHandles(ch)) {
      const x = this.x(clampX(pt.xi, n)), y = this.y(pt.price)
      if (x === null || y === null) continue
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }
}
