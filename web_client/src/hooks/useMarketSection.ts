import { useCallback, useEffect, useRef, useState } from 'react'
import { MARKET_REQUEST_TIMEOUT_MS } from '../lib/marketLive'

export interface SectionState<T> {
  data: T | null
  loading: boolean
  failed: boolean
}

/**
 * 마켓 개요의 한 섹션을 불러오는 상태 — 섹션마다 따로라 하나가 실패해도 나머지는 그대로 보인다(앱 use-rest-resource 와 같은 방식).
 * - fetcher 가 바뀌면 다시 불러온다 — 호출부는 모듈 함수나 useCallback 으로 고정해 넘긴다
 * - reload: 첫 로딩·[다시 시도]. 요청 번호로 늦게 온 옛 응답을 버린다
 * - silentRefresh: 자동 갱신·복귀 재조회. 실패는 삼키고 이전 값을 유지, 앞 요청이 끝나기 전에는 건너뛴다
 * - keepCurrent: true 를 돌려주면 자동 갱신 결과로 화면을 바꾸지 않는다(히트맵: 기준일이 같으면 들어가 있던 종목 보기를 유지)
 * - fetchedAt: 마지막 조회가 끝난 시각(복귀 재조회 판정용) — 실패해도 찍어야 첫 로드 실패 뒤에도 복귀 재조회가 돈다
 */
export function useMarketSection<T>(fetcher: (timeoutMs?: number) => Promise<T>, keepCurrent?: (cur: T, next: T) => boolean) {
  const [state, setState] = useState<SectionState<T>>({ data: null, loading: true, failed: false })
  const seq = useRef(0)
  const busy = useRef(false)
  const fetchedAt = useRef<number | null>(null)

  const reload = useCallback(async () => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true, failed: false }))
    try {
      const data = await fetcher()
      if (id === seq.current) setState({ data, loading: false, failed: false })
    } catch {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, failed: true }))
    } finally {
      fetchedAt.current = Date.now()
    }
  }, [fetcher])

  const silentRefresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    const id = seq.current
    try {
      const data = await fetcher(MARKET_REQUEST_TIMEOUT_MS)
      if (id !== seq.current) return
      setState((s) => ({
        data: s.data !== null && data !== null && keepCurrent?.(s.data, data) ? s.data : data,
        loading: false,
        failed: false,
      }))
    } catch {
      // 다음 주기·복귀 때 다시 묻는다 — 보이던 값은 그대로
    } finally {
      busy.current = false
      fetchedAt.current = Date.now()
    }
  }, [fetcher, keepCurrent])

  useEffect(() => {
    void reload()
    return () => {
      seq.current += 1 // 언마운트·조건 변경 — 진행 중인 응답은 버린다
    }
  }, [reload])

  return { ...state, reload, silentRefresh, fetchedAt }
}
