import { useEffect, useState } from 'react'
import { getActiveSeason } from '../api/game'
import { realMarketOf } from '../lib/marketAccess'
import { useAuthStore } from '../store/auth'

// 게임 메뉴 노출 판단값 — GET /api/game/seasons/active 의 features.real_market(요청자 기준, A안).
// 메뉴는 게임 화면에 들어가기 전에 알아야 하므로 앱 시작·로그인·로그아웃 때 따로 묻는다(토큰마다 1회 캐시).
// 실패·시즌 없음·게임 서버 미설정은 false(숨김). gameClient 가 로그인 토큰을 붙인다(관리자·열람 권한 회원은 true).
let cached: { token: string | null; value: boolean } | null = null
let inflight: { token: string | null; promise: Promise<boolean> } | null = null

function load(token: string | null): Promise<boolean> {
  if (cached?.token === token) return Promise.resolve(cached.value)
  if (inflight?.token !== token) {
    const promise = getActiveSeason()
      .then((season) => {
        const value = realMarketOf(season)
        if (useAuthStore.getState().token === token) cached = { token, value }
        return value
      })
      .catch(() => false)
      .finally(() => {
        if (inflight?.promise === promise) inflight = null
      })
    inflight = { token, promise }
  }
  return inflight!.promise
}

const current = (token: string | null): boolean | null => (cached?.token === token ? cached.value : null)

/** null = 아직 모름(그동안 메뉴는 숨김), true = 실제 시세 게임 허용 */
export function useGameAccess(): boolean | null {
  const token = useAuthStore((s) => s.token)
  const [state, setState] = useState<{ token: string | null; value: boolean | null }>(() => ({ token, value: current(token) }))
  useEffect(() => {
    const hit = current(token)
    if (hit !== null) {
      setState({ token, value: hit })
      return
    }
    let alive = true
    void load(token).then((v) => {
      if (alive) setState({ token, value: v })
    })
    return () => {
      alive = false
    }
  }, [token])
  return state.token === token ? state.value : current(token)
}
