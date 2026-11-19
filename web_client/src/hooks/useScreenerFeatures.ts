import { useEffect, useState } from 'react'
import { getScreenerFeatures, type ScreenerFeatures } from '../api/screenerFeatures'
import { useAuthStore } from '../store/auth'

// 관리자가 켜고 끄는 스크리너 스위치(종목 찾기 전체·조건검색·차트 패턴) + 요청자 기준 시세 열람 값(marketData·marketIndexKr, A안).
// 로그인 상태(토큰)마다 1회 요청을 메뉴·라우트·화면이 함께 쓴다(useGameRules 와 같은 방식).
// marketData·marketIndexKr 은 '누가 묻는가'로 답이 바뀌므로 토큰이 바뀌면(로그인·로그아웃) 캐시를 버리고 다시 묻는다 —
// 이전 사용자(관리자)의 true 가 로그아웃 뒤에 남으면 시세가 새므로, 바뀌는 순간 먼저 '모름(null)'으로 되돌린다.
// 실패하면 모두 꺼진 것으로 본다(fail-closed). 실패는 캐시하지 않아 다음 새로고침에 다시 묻는다.
const HIDDEN: ScreenerFeatures = { stockFinder: false, finder: false, patterns: false, marketData: false, marketIndexKr: false }
let cached: { token: string | null; value: ScreenerFeatures } | null = null
let inflight: { token: string | null; promise: Promise<ScreenerFeatures> } | null = null

function normalize(f: Partial<ScreenerFeatures> | null | undefined): ScreenerFeatures {
  return {
    stockFinder: f?.stockFinder === true,
    finder: f?.finder === true,
    patterns: f?.patterns === true,
    marketData: f?.marketData === true,
    marketIndexKr: f?.marketIndexKr === true,
  }
}

function load(token: string | null): Promise<ScreenerFeatures> {
  if (cached?.token === token) return Promise.resolve(cached.value)
  if (inflight?.token !== token) {
    const promise = getScreenerFeatures()
      .then((f) => {
        const value = normalize(f)
        if (useAuthStore.getState().token === token) cached = { token, value } // 응답 사이에 로그인 상태가 바뀌었으면 저장 안 함
        return value
      })
      .catch(() => HIDDEN)
      .finally(() => {
        if (inflight?.promise === promise) inflight = null
      })
    inflight = { token, promise }
  }
  return inflight!.promise
}

function current(token: string | null): ScreenerFeatures | null {
  return cached?.token === token ? cached.value : null
}

/** null = 아직 모름(로딩) — 그동안 탭·시세 섹션은 숨긴다 */
export function useScreenerFeatures(): ScreenerFeatures | null {
  const token = useAuthStore((s) => s.token)
  const [state, setState] = useState<{ token: string | null; value: ScreenerFeatures | null }>(() => ({
    token,
    value: current(token),
  }))
  useEffect(() => {
    const hit = current(token)
    if (hit) {
      setState({ token, value: hit })
      return
    }
    let alive = true
    void load(token).then((f) => {
      if (alive) setState({ token, value: f })
    })
    return () => {
      alive = false
    }
  }, [token])
  // 토큰이 바뀐 첫 렌더에서 이전 사용자의 값을 쓰지 않는다
  return state.token === token ? state.value : current(token)
}
