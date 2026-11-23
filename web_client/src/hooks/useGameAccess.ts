import { useEffect, useState } from 'react'
import { getActiveSeason } from '../api/game'
import { getEduState } from '../api/eduGame'
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

// ---------------------------------------------------------------- 교육용 합성 종가 게임(확장)
// 게임 탭 노출 = real_market || 교육용 공개. 교육용 공개 여부는 실시간 시즌 응답(상용은 null)이 아니라
// GET /api/game/edu/state 의 enabled 로 본다(비로그인 가능). 실패·게임 서버 미설정은 false(숨김, '기본 닫힘').
// 위 useGameAccess 와 같은 방식으로 토큰마다 1회 캐시(만료 토큰 401 → 기존 세션 만료 흐름 → 토큰이 바뀌면 다시 묻는다).
let eduCached: { token: string | null; value: boolean } | null = null
let eduInflight: { token: string | null; promise: Promise<boolean> } | null = null

function loadEdu(token: string | null): Promise<boolean> {
  if (eduCached?.token === token) return Promise.resolve(eduCached.value)
  if (eduInflight?.token !== token) {
    const promise = getEduState()
      .then((state) => {
        const value = state.enabled === true
        if (useAuthStore.getState().token === token) eduCached = { token, value }
        return value
      })
      .catch(() => false)
      .finally(() => {
        if (eduInflight?.promise === promise) eduInflight = null
      })
    eduInflight = { token, promise }
  }
  return eduInflight!.promise
}

const eduCurrent = (token: string | null): boolean | null => (eduCached?.token === token ? eduCached.value : null)

/** 게임 화면이 state 를 새로 받았을 때 캐시를 맞춘다(관리자가 스위치를 바꾼 뒤 메뉴가 늦게 따라오지 않게) */
export function rememberEduEnabled(enabled: boolean): void {
  eduCached = { token: useAuthStore.getState().token, value: enabled }
}

/** null = 아직 모름(그동안 교육용 게임은 닫힌 것으로 본다), true = 교육용 종가 게임 공개 */
export function useEduGameAccess(): boolean | null {
  const token = useAuthStore((s) => s.token)
  const [state, setState] = useState<{ token: string | null; value: boolean | null }>(() => ({ token, value: eduCurrent(token) }))
  useEffect(() => {
    const hit = eduCurrent(token)
    if (hit !== null) {
      setState({ token, value: hit })
      return
    }
    let alive = true
    void loadEdu(token).then((v) => {
      if (alive) setState({ token, value: v })
    })
    return () => {
      alive = false
    }
  }, [token])
  return state.token === token ? state.value : eduCurrent(token)
}
