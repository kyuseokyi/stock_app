import type { AxiosInstance } from 'axios'
import { gameClient } from './client'
import type { CoachMessage, CoachUpsertBody, SeasonOption } from '../types/game'

// 데일리 코치 API (trading_game). gameClient 가 없으면(미설정 배포) 명확한 에러.
export function requireGameClient(): AxiosInstance {
  if (!gameClient) throw new Error('게임 서버(VITE_GAME_API_URL)가 설정되지 않았습니다.')
  return gameClient
}

export const listSeasons = async (): Promise<SeasonOption[]> => {
  const { data } = await requireGameClient().get<SeasonOption[]>('/api/game/admin/seasons')
  return data
}

export const listCoachMessages = async (
  seasonId: number,
  targetDate: string,
): Promise<CoachMessage[]> => {
  const { data } = await requireGameClient().get<CoachMessage[]>('/api/game/admin/coach-messages', {
    params: { season_id: seasonId, target_date: targetDate },
  })
  return data
}

export const upsertCoachMessage = async (body: CoachUpsertBody): Promise<CoachMessage> => {
  const { data } = await requireGameClient().put<CoachMessage>('/api/game/admin/coach-messages', body)
  return data
}
