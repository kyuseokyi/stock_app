import { useEffect, useState } from 'react';

import { getRewardConfig } from './api';
import { DEFAULT_REWARD_CONFIG } from './lib/ranking-period';
import type { RewardConfig } from './types';

// 마지막으로 받은 보상 설정(앱 세션 동안) — 다음 마운트 때 기본값 대신 즉시 표시하고, 백그라운드로 최신화한다.
let lastKnown: RewardConfig | null = null;

/** 보상 금액 안내용 설정. 조회 전·실패 시 직전 값 또는 기본값(실패는 조용히) */
export function useRewardConfig(): RewardConfig {
  const [config, setConfig] = useState<RewardConfig>(lastKnown ?? DEFAULT_REWARD_CONFIG);

  useEffect(() => {
    let cancelled = false;
    getRewardConfig()
      .then((c) => {
        lastKnown = c;
        if (!cancelled) setConfig(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
