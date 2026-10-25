import type {
  ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, Logical, SeriesAttachedParameter, Time,
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
    return this.param?.chart.timeScale().logicalToCoordinate(xi as Logical) ?? null
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

/** 2중추세선 핸들 키 — C=중심선 끝, S=한쪽 선 끝, M=대칭선 끝(1=왼쪽 x1, 2=오른쪽 x2) */
export type ChannelHandleKey = 'C1' | 'C2' | 'S1' | 'S2' | 'M1' | 'M2'

/** 2중추세선 핸들 6개(위치·히트테스트 공용). 간격이 0 인 미리보기 단계는 중심선 끝만 */
export function channelHandles(ch: ChannelCoords) {
  const pts: { key: ChannelHandleKey; xi: number; price: number }[] = [
    { key: 'C1', xi: ch.x1, price: ch.y1 },
    { key: 'C2', xi: ch.x2, price: ch.y2 },
  ]
  if (ch.o1 === 0 && ch.o2 === 0) return pts
  pts.push(
    { key: 'S1', xi: ch.x1, price: ch.y1 + ch.o1 },
    { key: 'S2', xi: ch.x2, price: ch.y2 + ch.o2 },
    { key: 'M1', xi: ch.x1, price: ch.y1 - ch.o1 },
    { key: 'M2', xi: ch.x2, price: ch.y2 - ch.o2 },
  )
  return pts
}

/** 중심선 위 x 에서의 가격 */
export function channelCenterAt(ch: ChannelCoords, xi: number) {
  return Math.abs(ch.x2 - ch.x1) < 0.5 ? ch.y1 : ch.y1 + ((ch.y2 - ch.y1) / (ch.x2 - ch.x1)) * (xi - ch.x1)
}

// 2중추세선 → 중심선·위쪽 선·아래쪽 선 선분. 한쪽 선(중심+o)과 대칭선(중심−o) 중 가운데 간격이 + 인 쪽이 위.
export function channelSegments(ch: ChannelCoords, n: number) {
  const x1 = clampIdx(ch.x1, n), x2 = clampIdx(ch.x2, n)
  if (x1 === x2) return null
  type Seg = { i1: number; p1: number; i2: number; p2: number }
  const center: Seg = { i1: x1, p1: ch.y1, i2: x2, p2: ch.y2 }
  if (ch.o1 === 0 && ch.o2 === 0) return { center, upper: null, lower: null }
  const side: Seg = { i1: x1, p1: ch.y1 + ch.o1, i2: x2, p2: ch.y2 + ch.o2 }
  const mirror: Seg = { i1: x1, p1: ch.y1 - ch.o1, i2: x2, p2: ch.y2 - ch.o2 }
  const sideUp = ch.o1 + ch.o2 >= 0
  return { center, upper: sideUp ? side : mirror, lower: sideUp ? mirror : side }
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

  private line(ctx: Ctx, i1: number, p1: number, i2: number, p2: number, color: string, width: number, dashed: boolean) {
    const x1 = this.x(i1), y1 = this.y(p1), x2 = this.x(i2), y2 = this.y(p2)
    if (x1 === null || y1 === null || x2 === null || y2 === null) return
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.setLineDash(dashed ? [5, 4] : [])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 역할별 색·굵기(docs/custom_candle_chart_idea.md): 위쪽 저항선·아래쪽 지지선은 굵게, 중심선은 점선.
  private paintChannel(ctx: Ctx, ch: ChannelCoords, n: number) {
    const s = channelSegments(ch, n)
    if (!s) return
    if (s.upper) this.line(ctx, s.upper.i1, s.upper.p1, s.upper.i2, s.upper.p2, '#f43f5e', 2, false)
    if (s.lower) this.line(ctx, s.lower.i1, s.lower.p1, s.lower.i2, s.lower.p2, '#10b981', 2, false)
    this.line(ctx, s.center.i1, s.center.p1, s.center.i2, s.center.p2, '#eab308', 1.5, true)
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
      const x = this.x(clampIdx(pt.xi, n)), y = this.y(pt.price)
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
