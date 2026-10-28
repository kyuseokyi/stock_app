// 관리자 전용(웹 원본 없음) — 차트 패턴을 패턴 모양 그대로 캔들 위에 그린다(캔버스 프리미티브).
// 꼭짓점은 패턴 엔진(backend/apps/collector/patterns/kinds/*.py) points 의 role 을 따른다:
//   컵             rim → base → end                    → U자(가파른 옆면·둥근 바닥)
//   컵핸들         rim → base → handle(피벗) → end(손잡이 저점) → U자 + 손잡이 갈고리
//   쌍바닥         rim → base1 → mid_peak → base2 → end → W자
//   플랫 베이스·박스권 rim → base → end               → 사각형(위 = 림, 아래 = 저점)
//   HTF            pole → rim → pivot → base → end      → 깃대 직선 + 깃발 사각형
// 선 시리즈는 시간이 앞으로만 가서 박스의 세로 변·둥근 바닥을 못 그리므로 픽셀 좌표로 직접 그린다.
// 꼭짓점 날짜가 받은 일봉에 없으면(기간 밖) 그 패턴은 건너뛴다 — 과거 캔들을 붙이면 다시 그려진다.
import type {
  ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesAttachedParameter, Time,
} from 'lightweight-charts'

export interface PatternShape {
  patternType: string
  color: string
  /** 선 굵기(px) — 현재 베이스 2, 지난 베이스 1 */
  width: number
  points: { role: string; date: string; price: number }[]
}

type DrawTarget = Parameters<ISeriesPrimitivePaneRenderer['draw']>[0]
type Ctx = CanvasRenderingContext2D
type Pt = { x: number; y: number }

/** 높은 곳 → 낮은 곳: 처음엔 가파르게 떨어지고 바닥에서 평평해진다(컵 왼쪽 벽) */
function down(c: Ctx, a: Pt, b: Pt) {
  const dx = b.x - a.x
  c.bezierCurveTo(a.x + dx * 0.15, b.y, b.x - dx * 0.45, b.y, b.x, b.y)
}

/** 낮은 곳 → 높은 곳: 바닥에서 평평하게 시작해 끝에서 가파르게 오른다(컵 오른쪽 벽) */
function up(c: Ctx, a: Pt, b: Pt) {
  const dx = b.x - a.x
  c.bezierCurveTo(a.x + dx * 0.45, a.y, b.x - dx * 0.15, a.y, b.x, b.y)
}

/** 반투명 채우기 색 — '#rrggbb' 만 알파를 붙이고 그 밖의 색(rgba 등)은 채우지 않는다 */
function fillOf(color: string): string | null {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}1a` : null
}

function box(c: Ctx, x0: number, x1: number, yTop: number, yBottom: number, color: string) {
  const fill = fillOf(color)
  if (fill) {
    c.fillStyle = fill
    c.fillRect(x0, yTop, x1 - x0, yBottom - yTop)
  }
  c.strokeRect(x0, yTop, x1 - x0, yBottom - yTop)
}

export class PatternShapesPrimitive implements ISeriesPrimitive<Time> {
  private shapes: PatternShape[] = []
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

  setShapes(shapes: PatternShape[]) {
    this.shapes = shapes
    this.param?.requestUpdate()
  }

  private draw(target: DrawTarget) {
    const p = this.param
    if (!p || this.shapes.length === 0) return
    const ts = p.chart.timeScale()
    const at = (date: string, price: number): Pt | null => {
      const x = ts.timeToCoordinate(date as Time)
      const y = p.series.priceToCoordinate(price)
      return x === null || y === null ? null : { x, y }
    }
    target.useMediaCoordinateSpace(({ context: c }) => {
      c.lineJoin = 'round'
      c.lineCap = 'round'
      for (const s of this.shapes) {
        const pts = new Map<string, Pt>()
        const prices = new Map<string, number>()
        let missing = false
        for (const q of s.points) {
          const xy = at(q.date, q.price)
          if (!xy) missing = true
          else pts.set(q.role, xy)
          prices.set(q.role, q.price)
        }
        if (missing) continue // 꼭짓점 하나라도 기간 밖이면 모양이 깨지므로 그리지 않는다
        c.strokeStyle = s.color
        c.lineWidth = s.width
        drawShape(c, s.patternType, pts, (price) => p.series.priceToCoordinate(price), prices, s.color)
      }
    })
  }
}

function drawShape(
  c: Ctx,
  type: string,
  pt: Map<string, Pt>,
  yOf: (price: number) => number | null,
  price: Map<string, number>,
  color: string,
) {
  const g = (role: string) => pt.get(role)
  const rim = g('rim')
  const base = g('base')
  const end = g('end')
  switch (type) {
    case 'cup': {
      if (!rim || !base || !end) return
      c.beginPath()
      c.moveTo(rim.x, rim.y)
      down(c, rim, base)
      up(c, base, end)
      c.stroke()
      return
    }
    case 'cup_with_handle': {
      const lip = g('handle') // 손잡이 시작 = 오른쪽 림(피벗)
      if (!rim || !base || !lip || !end) return
      c.beginPath()
      c.moveTo(rim.x, rim.y)
      down(c, rim, base)
      up(c, base, lip)
      // 손잡이: 피벗에서 완만하게 내려가 손잡이 저점, 다시 피벗 높이로 고개를 드는 갈고리
      const hw = Math.max(6, end.x - lip.x)
      c.quadraticCurveTo(lip.x + hw * 0.5, lip.y, end.x, end.y)
      c.quadraticCurveTo(end.x + hw * 0.35, end.y, end.x + hw * 0.7, lip.y)
      c.stroke()
      return
    }
    case 'double_bottom': {
      const b1 = g('base1')
      const mid = g('mid_peak')
      const b2 = g('base2')
      if (!rim || !b1 || !mid || !b2 || !end) return
      c.beginPath()
      c.moveTo(rim.x, rim.y)
      down(c, rim, b1)
      up(c, b1, mid)
      down(c, mid, b2)
      up(c, b2, end)
      c.stroke()
      return
    }
    case 'flat_base':
    case 'consolidation': {
      if (!rim || !base || !end) return
      // 위 = 림과 끝 고가 중 높은 쪽, 아래 = 저점
      const top = Math.min(rim.y, end.y)
      box(c, rim.x, end.x, top, base.y, color)
      return
    }
    case 'htf': {
      const pole = g('pole')
      if (!pole || !rim || !base || !end) return
      // 깃대: 급등 직선
      c.beginPath()
      c.moveTo(pole.x, pole.y)
      c.lineTo(rim.x, rim.y)
      c.stroke()
      // 깃발: 깃대 꼭대기 ~ 끝, 위 = 피벗(없으면 림)·아래 = 저점
      const pivotPrice = price.get('pivot')
      const yTop = pivotPrice !== undefined ? yOf(pivotPrice) ?? rim.y : rim.y
      box(c, rim.x, end.x, Math.min(yTop, rim.y), base.y, color)
      return
    }
    default: {
      // 모르는 패턴 — 꼭짓점을 날짜 순서로 직선 연결
      const list = [...pt.values()].sort((a, b) => a.x - b.x)
      if (list.length < 2) return
      c.beginPath()
      c.moveTo(list[0].x, list[0].y)
      for (const q of list.slice(1)) c.lineTo(q.x, q.y)
      c.stroke()
    }
  }
}
