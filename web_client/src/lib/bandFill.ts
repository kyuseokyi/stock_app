import type {
  ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesAttachedParameter, Time,
} from 'lightweight-charts'

// lightweight-charts v4 에는 두 선 사이 채우기가 없어 시리즈 primitive 로 볼린저 상·하단 사이를 칠한다.
// 좌표는 그릴 때마다 시간/가격 → 픽셀로 다시 변환(스크롤·확대 시 따라감). 캔들보다 아래(zOrder bottom).
type DrawTarget = Parameters<ISeriesPrimitivePaneRenderer['draw']>[0]

export interface BandPoint {
  time: Time
  upper: number
  lower: number
}

export class BandFill implements ISeriesPrimitive<Time> {
  private points: BandPoint[] = []
  private visible = true
  private param: SeriesAttachedParameter<Time> | null = null
  private readonly view: ISeriesPrimitivePaneView

  constructor(private readonly color: string) {
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

  setPoints(points: BandPoint[]) {
    this.points = points
    this.param?.requestUpdate()
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.param?.requestUpdate()
  }

  private draw(target: DrawTarget) {
    const p = this.param
    if (!p || !this.visible || this.points.length < 2) return
    const ts = p.chart.timeScale()
    const upper: [number, number][] = []
    const lower: [number, number][] = []
    for (const pt of this.points) {
      const x = ts.timeToCoordinate(pt.time)
      const yu = p.series.priceToCoordinate(pt.upper)
      const yl = p.series.priceToCoordinate(pt.lower)
      if (x === null || yu === null || yl === null) continue
      upper.push([x, yu])
      lower.push([x, yl])
    }
    if (upper.length < 2) return
    target.useMediaCoordinateSpace(({ context }) => {
      context.beginPath()
      context.moveTo(upper[0][0], upper[0][1])
      for (const [x, y] of upper.slice(1)) context.lineTo(x, y)
      for (let i = lower.length - 1; i >= 0; i--) context.lineTo(lower[i][0], lower[i][1])
      context.closePath()
      context.fillStyle = this.color
      context.fill()
    })
  }
}
