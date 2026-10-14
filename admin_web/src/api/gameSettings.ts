import { requireGameClient } from './coach'
import type { GameSettings } from '../types/game'

// 게임 운영 설정(다음 시즌 기간·보상 금액) 관리자 API — 부분 갱신, 응답은 병합된 전체 설정
export const getGameSettings = async (): Promise<GameSettings> => {
  const { data } = await requireGameClient().get<GameSettings>('/api/game/admin/settings')
  return data
}

export const updateGameSettings = async (patch: Partial<GameSettings>): Promise<GameSettings> => {
  const { data } = await requireGameClient().put<GameSettings>('/api/game/admin/settings', patch)
  return data
}
