import { requireGameClient } from './coach'
import type { EduAdminSeason, EduAdvanceResult, EduNewSeasonBody, EduRegime } from '../types/game'

// 교육용 합성 종가 게임 운영 관리자 API(trading_game, require_admin) — EDU_DAILY_GAME 스위치와 무관하게 동작

/** 현재 교육 시즌(국면·남은 봉·참가자 수). 없으면 null */
export const getEduSeason = async (): Promise<EduAdminSeason | null> => {
  const { data } = await requireGameClient().get<EduAdminSeason | null>('/api/game/admin/edu/season')
  return data ?? null
}

/** 다음 봉 1개 즉시 생성 + 전 계좌 정산(하루 1회 제한 없음) */
export const advanceEduDay = async (): Promise<EduAdvanceResult> => {
  const { data } = await requireGameClient().post<EduAdvanceResult>('/api/game/admin/edu/advance-day')
  return data
}

/** 새 시즌 — 기존 ACTIVE 시즌은 CLOSED 로 바뀌고 워밍업 120봉이 새로 생성된다 */
export const createEduSeason = async (body: EduNewSeasonBody): Promise<EduAdminSeason> => {
  const { data } = await requireGameClient().post<EduAdminSeason>('/api/game/admin/edu/new-season', body)
  return data
}

/** 다음 봉부터 적용할 국면 지정(null = 해제·자동 전이). 한 번 적용되면 서버가 지운다 */
export const setEduRegime = async (regime: EduRegime | null): Promise<EduAdminSeason> => {
  const { data } = await requireGameClient().put<EduAdminSeason>('/api/game/admin/edu/regime', { regime })
  return data
}
