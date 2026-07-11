import { useCallback, useState } from 'react'

// 도형 id 시퀀스 (모듈 단위, 렌더 간 안정)
let _seq = 0
const nextId = () => `d${++_seq}`

/**
 * 차트 드로잉 상태 훅.
 * 도형은 데이터 좌표(xi=카테고리 인덱스, price=가격)로 저장해 리렌더/캡처 정합성을 유지한다.
 * ECharts에 독립적이므로 향후 web_client/mobile에서 재사용 가능.
 *
 * shape 형태:
 *   { id, type:'hline', price }
 *   { id, type:'rect',  xi1, y1, xi2, y2 }
 *   { id, type:'text',  xi, price, text }
 */
export function useChartDrawings() {
  const [tool, setTool] = useState(null) // 'hline' | 'rect' | 'text' | null
  const [shapes, setShapes] = useState([])

  // 생성한 도형(id 포함)을 반환 → 호출측에서 마지막 도형 추적 가능
  const addShape = useCallback((s) => {
    const shape = { id: nextId(), ...s }
    setShapes((prev) => [...prev, shape])
    return shape
  }, [])
  const removeShape = useCallback(
    (id) => setShapes((prev) => prev.filter((s) => s.id !== id)),
    [],
  )
  const updateShape = useCallback(
    (id, patch) =>
      setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    [],
  )
  const clearAll = useCallback(() => setShapes([]), [])

  // 같은 도구 재클릭 시 해제(토글)
  const toggleTool = useCallback(
    (t) => setTool((prev) => (prev === t ? null : t)),
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
