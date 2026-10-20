import { useEffect, useRef } from 'react'
import { shouldRefreshNow } from '../lib/marketLive'

interface Options {
  /** true 면 탭이 다시 보일 때, 마지막 실행 후 ms 이상 지났으면 즉시 1회 실행(기본 false — 기존 동작 불변) */
  runOnVisible?: boolean
}

/**
 * 탭이 보이는 동안에만 ms 마다 callback 호출(숨겨진 탭은 건너뜀). enabled=false 면 멈춤.
 * callback 은 최신 것을 쓰므로 매 렌더 새 함수여도 타이머가 다시 만들어지지 않는다.
 */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true, options: Options = {}) {
  const cb = useRef(callback)
  useEffect(() => {
    cb.current = callback
  })
  const { runOnVisible = false } = options

  useEffect(() => {
    if (!enabled) return
    let lastAt: number | null = null
    const run = () => {
      lastAt = Date.now()
      cb.current()
    }
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, ms)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && shouldRefreshNow(lastAt, Date.now(), ms)) run()
    }
    if (runOnVisible) document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      if (runOnVisible) document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ms, enabled, runOnVisible])
}
