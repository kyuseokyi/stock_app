import type {
  ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesAttachedParameter, Time,
} from 'lightweight-charts'

// 매물대(Volume Profile) — 화면에 보이는 캔들만으로 가격대별 누적 거래량을 그린다(트레이딩뷰 VPVR 방식).
// 계산은 서버 chart.volume_profile(관리자 차트)과 같다: 보이는 구간 저가~고가를 20칸으로 나누고 각 캔들 거래량을 종가 칸에 합산.
// 그릴 때마다 보이는 구간을 다시 읽어 계산 → 끌기·확대에 따로 구독할 필요가 없다. 왼쪽 끝에서 오른쪽으로(폭 최대 28%), 캔들 뒤.

export interface VolumePoint {
  high: number
  low: number
  close: number
  volume: number
}

export interface VolumeBin {
  low: number
  high: number
  volume: number
}

export const VP_BINS = 20
// 막대 최대 폭(차트 폭 대비)·색 — 좁은 차트(폰 폭)는 28%·0.22 면 가늘고 흐려 앱(chart-page-script)과 같은 50%·0.3
const VP_NARROW_PX = 640
const VP_WIDE = { maxWidth: 0.28, color: 'rgba(100, 116, 139, 0.22)' }
const VP_NARROW = { maxWidth: 0.5, color: 'rgba(100, 116, 139, 0.3)' }

/** 가격대별 누적 거래량. 거래량 정보가 없는 캔들(0)만 있으면 [] */
export function volumeProfile(points: VolumePoint[], bins: number = VP_BINS): VolumeBin[] {
  const pts = points.filter((p) => p.volume > 0)
  if (pts.length === 0) return []
  const min = Math.min(...pts.map((p) => p.low))
  const max = Math.max(...pts.map((p) => p.high))
  const total = pts.reduce((s, p) => s + p.volume, 0)
  if (max <= min) return [{ low: min, high: max, volume: total }]
  const width = (max - min) / bins
  const buckets = new Array<number>(bins).fill(0)
  for (const p of pts) buckets[Math.max(0, Math.min(bins - 1, Math.floor((p.close - min) / width)))] += p.volume
  return buckets.map((volume, i) => ({ low: min + i * width, high: min + (i + 1) * width, volume }))
}

/** 거래량 가장 큰 칸의 가운데 가격(같으면 아래 칸). 칸이 없으면 null — 지지·저항 후보(POC) */
export function pocPrice(bins: VolumeBin[]): number | null {
  let best: VolumeBin | null = null
  for (const b of bins) if (b.volume > 0 && (best === null || b.volume > best.volume)) best = b
  return best === null ? null : (best.low + best.high) / 2
}

const POC_RESIST = '#f59e0b' // POC 가 현재가 위(저항)
const POC_SUPPORT = '#8b5cf6' // POC 가 현재가 아래(지지)

type DrawTarget = Parameters<ISeriesPrimitivePaneRenderer['draw']>[0]

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private points: VolumePoint[] = [] // 캔들 시리즈와 같은 순서(인덱스 = logical)
  private visible = true
  /** 보이는 구간 POC 가 바뀌면(끄면 null) — 그리기 중 React 상태를 바꾸지 않게 다음 프레임에 부른다 */
  onPocChange: ((price: number | null) => void) | null = null
  private sentPoc: number | null | undefined = undefined

  private reportPoc(poc: number | null) {
    if (poc === this.sentPoc) return
    this.sentPoc = poc
    const cb = this.onPocChange
    if (cb) requestAnimationFrame(() => cb(poc))
  }
  private param: SeriesAttachedParameter<Time> | null = null
  private readonly view: ISeriesPrimitivePaneView

  constructor() {
    const renderer: ISeriesPrimitivePaneRenderer = { draw: (target) => this.draw(target) }
    this.view = { zOrder: () => 'bottom', renderer: () => renderer }
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

  setPoints(points: VolumePoint[]) {
    this.points = points
    this.param?.requestUpdate()
  }

  /** 틱 — 마지막 캔들만 바꾸거나(같은 봉) 새 봉을 붙인다 */
  upsertLast(point: VolumePoint, isNew: boolean) {
    this.points = isNew ? [...this.points, point] : [...this.points.slice(0, -1), point]
    this.param?.requestUpdate()
  }

  setVisible(visible: boolean) {
    this.visible = visible
    if (!visible) this.reportPoc(null)
    this.param?.requestUpdate()
  }

  private draw(target: DrawTarget) {
    const p = this.param
    if (!p || !this.visible || this.points.length === 0) return
    const range = p.chart.timeScale().getVisibleLogicalRange()
    if (!range) return
    const from = Math.max(0, Math.ceil(range.from))
    const to = Math.min(this.points.length - 1, Math.floor(range.to))
    if (to < from) return
    const bins = volumeProfile(this.points.slice(from, to + 1))
    if (bins.length === 0) {
      this.reportPoc(null)
      return
    }
    const maxVol = Math.max(1, ...bins.map((b) => b.volume))
    const poc = pocPrice(bins)
    const last = this.points[this.points.length - 1].close
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const style = mediaSize.width < VP_NARROW_PX ? VP_NARROW : VP_WIDE
      context.fillStyle = style.color
      for (const b of bins) {
        const yHigh = p.series.priceToCoordinate(b.high)
        const yLow = p.series.priceToCoordinate(b.low)
        if (yHigh === null || yLow === null || b.volume === 0) continue
        const w = (b.volume / maxVol) * mediaSize.width * style.maxWidth
        context.fillRect(0, Math.min(yHigh, yLow), w, Math.max(1, Math.abs(yLow - yHigh) - 1))
      }
      // POC 칸 막대 오른쪽 끝(= 최대 폭)에 점 — 현재가 위면 주황(저항), 아래면 보라(지지)
      const y = poc === null ? null : p.series.priceToCoordinate(poc)
      if (poc !== null && y !== null) {
        context.fillStyle = poc >= last ? POC_RESIST : POC_SUPPORT
        context.beginPath()
        context.arc(mediaSize.width * style.maxWidth, y, 3, 0, Math.PI * 2)
        context.fill()
      }
    })
    this.reportPoc(poc)
  }
}
