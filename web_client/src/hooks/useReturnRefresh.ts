import { useEffect, useRef, type RefObject } from 'react'
import { RETURN_REFRESH_MS, shouldRefetchOnReturn } from '../lib/marketLive'

/**
 * 탭이 다시 보일 때, 마지막 조회(lastFetchedAt) 후 ms 이상 지났으면 run 을 조용히 1회 부른다.
 * 주기 타이머가 없어 보고 있는 동안 서버 요청은 늘지 않는다. 앞 실행이 끝나기 전 복귀는 건너뛰고, 실패는 삼킨다.
 */
export function useReturnRefresh(run: () => Promise<unknown>, lastFetchedAt: RefObject<number | null>, ms = RETURN_REFRESH_MS) {
  const latest = useRef(run)
  useEffect(() => {
    latest.current = run
  })
  const busy = useRef(false)

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || busy.current) return
      if (!shouldRefetchOnReturn(lastFetchedAt.current, Date.now(), ms)) return
      busy.current = true
      latest.current()
        .catch(() => undefined)
        .finally(() => {
          busy.current = false
        })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [lastFetchedAt, ms])
}
