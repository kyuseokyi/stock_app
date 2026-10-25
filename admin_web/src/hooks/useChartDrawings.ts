import { useCallback, useState } from 'react'

// 도형 id 시퀀스 (모듈 단위, 렌더 간 안정)
let _seq = 0
const nextId = () => `d${++_seq}`

/** 드로잉 도구. null = 도구 해제 */
export type DrawingTool = 'hline' | 'rect' | 'text' | 'channel'

export interface HLineShape {
  type: 'hline'
  price: number
}
export interface RectShape {
  type: 'rect'
  xi1: number
  y1: number
  xi2: number
  y2: number
}
export interface TextShape {
  type: 'text'
  xi: number
  price: number
  text: string
}
/**
 * 2중추세선 — 중심선 (x1,y1)-(x2,y2)(x=캔들 인덱스, y=가격)과 양 끝의 세로 간격 o1·o2.
 * 한쪽 선 = 중심 + o, 반대쪽 선 = 중심 − o → 두 선은 중심선 기준 거리·각도 대칭(o1≠o2 면 기울기가 다름).
 */
export interface ChannelShape {
  type: 'channel'
  x1: number
  y1: number
  x2: number
  y2: number
  o1: number
  o2: number
}

/** addShape 입력(id 없음) */
export type ShapeInput = HLineShape | RectShape | TextShape | ChannelShape
/** 저장된 도형(id 부여됨) */
export type Shape = ShapeInput & { id: string }
/** updateShape 패치 — 수평선 끌기(price)·2중추세선 이동/핸들(x·y·o) */
export type ShapePatch = Partial<Omit<HLineShape, 'type'> & Omit<ChannelShape, 'type'>>

/**
 * 차트 드로잉 상태 훅.
 * 도형은 데이터 좌표(xi=카테고리 인덱스, price=가격)로 저장해 리렌더/캡처 정합성을 유지한다.
 * ECharts에 독립적이므로 향후 web_client/mobile에서 재사용 가능.
 *
 * shape 형태:
 *   { id, type:'hline', price }
 *   { id, type:'rect',  xi1, y1, xi2, y2 }
 *   { id, type:'text',  xi, price, text }
 *   { id, type:'channel', x1, y1, x2, y2, o1, o2 }
 */
export function useChartDrawings() {
  const [tool, setTool] = useState<DrawingTool | null>(null)
  const [shapes, setShapes] = useState<Shape[]>([])

  // 생성한 도형(id 포함)을 반환 → 호출측에서 마지막 도형 추적 가능
  const addShape = useCallback((s: ShapeInput): Shape => {
    const shape: Shape = { id: nextId(), ...s }
    setShapes((prev) => [...prev, shape])
    return shape
  }, [])
  const removeShape = useCallback(
    (id: string) => setShapes((prev) => prev.filter((s) => s.id !== id)),
    [],
  )
  const updateShape = useCallback(
    (id: string, patch: ShapePatch) =>
      setShapes((prev) =>
        // 패치는 type 을 바꾸지 않으므로 판별자는 유지된다(TS 가 유니온 스프레드를 증명하지 못해 단언).
        prev.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)),
      ),
    [],
  )
  const clearAll = useCallback(() => setShapes([]), [])

  // 같은 도구 재클릭 시 해제(토글)
  const toggleTool = useCallback(
    (t: DrawingTool) => setTool((prev) => (prev === t ? null : t)),
    [],
  )

  return {
    tool,
    setTool,
    toggleTool,
    shapes,
    addShape,
    removeShape,
    updateShape,
    clearAll,
  }
}
