import { useEffect, useState } from 'react'
import { getRewardConfig } from '../api/game'
import type { RewardConfig } from '../types/game'

/** 서버 설정을 못 받았을 때 쓰는 기본값(backend game_settings 기본값과 동일) */
export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  weekly: [500_000, 300_000, 200_000],
  monthly: [1_500_000, 900_000, 600_000],
  streak: { '3': 100_000, '7': 300_000, '14': 700_000, '30': 2_000_000 },
}

const isAmounts = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))

/** 응답 일부가 비정상이면 그 항목만 기본값으로 대체 */
export function normalizeRewardConfig(raw: Partial<RewardConfig> | null | undefined): RewardConfig {
  return {
    weekly: isAmounts(raw?.weekly) ? raw.weekly : DEFAULT_REWARD_CONFIG.weekly,
    monthly: isAmounts(raw?.monthly) ? raw.monthly : DEFAULT_REWARD_CONFIG.monthly,
    streak: raw?.streak && typeof raw.streak === 'object' ? { ...DEFAULT_REWARD_CONFIG.streak, ...raw.streak } : DEFAULT_REWARD_CONFIG.streak,
  }
}

// 모달을 열 때마다 재요청하지 않도록 페이지 수명 동안 1회 요청 결과를 공유(실패 시 다음 마운트에 재시도).
let cached: RewardConfig | null = null
let inflight: Promise<RewardConfig> | null = null

function loadRewardConfig(): Promise<RewardConfig> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = getRewardConfig()
      .then((raw) => {
        cached = normalizeRewardConfig(raw)
        return cached
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** 보상 안내 문구용 금액. 로딩 중·실패 시 기본값 */
export function useRewardConfig(): RewardConfig {
  const [config, setConfig] = useState<RewardConfig>(cached ?? DEFAULT_REWARD_CONFIG)
  useEffect(() => {
    let cancelled = false
    loadRewardConfig()
      .then((c) => {
        if (!cancelled) setConfig(c)
      })
      .catch(() => undefined) // 기본값 유지
    return () => {
      cancelled = true
    }
  }, [])
  return config
}
