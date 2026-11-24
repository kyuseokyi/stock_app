import axios, { type AxiosInstance } from 'axios'
import { gameClient } from './gameClient'
import type {
  EduActionRequest, EduActionResponse, EduFeatures, EduHistory, EduLeaderboard, EduState,
} from '../types/eduGame'

// 교육용 합성 종가 게임 REST(/api/game/edu/*) — 실시간 게임과 같은 trading_game 서버·클라이언트(토큰 첨부·401 세션 만료 처리).
// state·leaderboard 는 비로그인도 열린다. 주문(action)은 POST 라 재시도하지 않는다(installRetry 는 GET 만).

function client(): AxiosInstance {
  if (!gameClient) throw new Error('GAME_API_URL 미설정')
  return gameClient
}

/** 시즌·최근 120봉·오늘 해설·참여자 비율 + (로그인 시) 내 계좌·오늘 참가 여부. 꺼져 있으면 {enabled:false} */
export const getEduState = async (): Promise<EduState> => {
  const { data } = await client().get<EduState>('/api/game/edu/state')
  return data
}

/**
 * 게임 탭(메뉴) 노출 판단값 — 전역 플래그 두 개만(가볍고 시즌을 만들지 않는다).
 * features 가 없는 옛 서버(404)면 state 로 한 번 폴백해 같은 두 값을 꺼낸다(배포 순서와 무관하게 동작).
 */
export const getEduFeatures = async (): Promise<EduFeatures> => {
  try {
    const { data } = await client().get<EduFeatures>('/api/game/edu/features')
    return { enabled: data.enabled === true, real_market_switch: data.real_market_switch === true }
  } catch (err) {
    if (!(axios.isAxiosError(err) && err.response?.status === 404)) throw err
    const state = await getEduState()
    return { enabled: state.enabled === true, real_market_switch: state.real_market_switch === true }
  }
}

/** 하루(봉) 1회 의사결정 제출 */
export const submitEduAction = async (body: EduActionRequest): Promise<EduActionResponse> => {
  const { data } = await client().post<EduActionResponse>('/api/game/edu/action', body)
  return data
}

export const getEduLeaderboard = async (): Promise<EduLeaderboard> => {
  const { data } = await client().get<EduLeaderboard>('/api/game/edu/leaderboard')
  return data
}

/** 이번 시즌 내 참가 기록(최신순) — 로그인 전용 */
export const getEduHistory = async (): Promise<EduHistory> => {
  const { data } = await client().get<EduHistory>('/api/game/edu/history')
  return data
}
