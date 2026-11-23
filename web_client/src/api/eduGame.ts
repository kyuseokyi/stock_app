import type { AxiosInstance } from 'axios'
import { gameClient } from './gameClient'
import type { EduActionRequest, EduActionResponse, EduHistory, EduLeaderboard, EduState } from '../types/eduGame'

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
