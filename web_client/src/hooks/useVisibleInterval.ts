import { useEffect, useRef } from 'react'

/**
 * 탭이 보이는 동안에만 ms 마다 callback 호출(숨겨진 탭은 건너뜀). enabled=false 면 멈춤.
 * callback 은 최신 것을 쓰므로 매 렌더 새 함수여도 타이머가 다시 만들어지지 않는다.
 */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true) {
  const cb = useRef(callback)
  useEffect(() => {
    cb.current = callback
  })

  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') cb.current()
    }, ms)
    return () => clearInterval(t)
  }, [ms, enabled])
}
