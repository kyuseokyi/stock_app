import { requireGameClient } from './coach'
import type { FeatureFlag, FeatureFlagKey } from '../types/game'

// 기능 on/off 관리자 API (trading_game, Phase 5b)
export const listFeatureFlags = async (): Promise<FeatureFlag[]> => {
  const { data } = await requireGameClient().get<FeatureFlag[]>('/api/game/admin/feature-flags')
  return data
}

export const updateFeatureFlag = async (key: FeatureFlagKey, enabled: boolean): Promise<FeatureFlag> => {
  const { data } = await requireGameClient().put<FeatureFlag>(`/api/game/admin/feature-flags/${key}`, { enabled })
  return data
}
