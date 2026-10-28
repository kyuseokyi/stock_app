// 차트 게임 — 마지막 캔들 몸통이 닿은 지지·저항을 현재 캔들 주변에만 짧은 가로선으로 그린다(가격축 라벨 없음, 이름은 범례).
// 전체 폭 가격선(createPriceLine)은 과거 구간까지 가로질러 지금 닿은 선인지 헷갈리고, 축 라벨이 겹겹이 쌓여 보기 불편했다.
// 앱 chart-web/page/chart-page-script.ts 의 SrSegments 와 같은 규칙.
import type {
  ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, Logical, SeriesAttachedParameter, Time,
} from 'lightweight-charts'

/** 현재 캔들 앞쪽으로 이만큼 봉 + 뒤쪽 여백 이만큼 봉 */
export const SEG_BEFORE = 6
export const SEG_AFTER = 2

export interface SrSegment {
  price: number
  color: string
}

/** 선분의 논리 인덱스 구간 — 캔들이 없으면 null */
export function segmentSpan(barCount: number): { from: number; to: number } | null {
  if (barCount <= 0) return null
  const last = barCount - 1
  return { from: Math.max(0, last - SEG_BEFORE), to: last + SEG_AFTER }
}

type DrawTarget = Parameters<ISeriesPrimitivePaneRenderer['draw']>[0]

export class SrSegmentsPrimitive implements ISeriesPrimitive<Time> {
  private segments: SrSegment[] = []
  private param: SeriesAttachedParameter<Time> | null = null
  private readonly view: ISeriesPrimitivePaneView

  constructor() {
    const renderer: ISeriesPrimitivePaneRenderer = { draw: (target) => this.draw(target) }
    this.view = { zOrder: () => 'top', renderer: () => renderer }
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

  setSegments(segments: SrSegment[]) {
    this.segments = segments
    this.param?.requestUpdate()
  }

  private draw(target: DrawTarget) {
    const p = this.param
    if (!p || this.segments.length === 0) return
    const span = segmentSpan(p.series.data().length)
    if (!span) return
    const ts = p.chart.timeScale()
    const x0 = ts.logicalToCoordinate(span.from as Logical)
    const x1 = ts.logicalToCoordinate(span.to as Logical)
    if (x0 === null || x1 === null) return
    target.useMediaCoordinateSpace(({ context: c }) => {
      c.lineWidth = 2
      c.lineCap = 'round'
      for (const s of this.segments) {
        const y = p.series.priceToCoordinate(s.price)
        if (y === null) continue
        c.strokeStyle = s.color
        c.beginPath()
        c.moveTo(x0, y)
        c.lineTo(x1, y)
        c.stroke()
      }
    })
  }
}
