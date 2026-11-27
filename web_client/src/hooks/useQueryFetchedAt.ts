import { useEffect, useRef } from 'react'

/**
 * 조회가 마지막으로 끝난 시각(성공·실패 모두)을 ref 로 — useReturnRefresh 의 복귀 재조회 판정에 넘긴다.
 * 복귀 재조회가 직접 끝난 시각을 찍을 수도 있게 ref 를 그대로 돌려준다(뒤로 가지 않게 큰 값만 반영).
 */
export function useQueryFetchedAt(q: { dataUpdatedAt: number; errorUpdatedAt: number }) {
  const at = useRef<number | null>(null)
  useEffect(() => {
    const t = Math.max(q.dataUpdatedAt, q.errorUpdatedAt)
    if (t > 0) at.current = Math.max(at.current ?? 0, t)
  }, [q.dataUpdatedAt, q.errorUpdatedAt])
  return at
}
