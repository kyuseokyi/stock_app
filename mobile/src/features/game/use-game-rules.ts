import { useCallback, useEffect, useState } from 'react';

import { getGameRules } from './api';
import type { GameRules } from './types';

// 규칙은 서버 상수라 앱 세션 동안 한 번만 받는다(성공 결과 캐시 + 진행 중 요청 공유). 실패하면 캐시하지 않아 다시 시도 가능.
let cached: GameRules | null = null;
let inflight: Promise<GameRules> | null = null;
// 마운트된 훅들 — 한 곳(규칙 시트 '다시 시도')에서 성공하면 이미 실패 상태인 주문 패널·심리 바에도 반영
const listeners = new Set<(r: GameRules) => void>();

function loadRules(): Promise<GameRules> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = getGameRules()
      .then((r) => {
        cached = r;
        listeners.forEach((l) => l(r));
        return r;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export type GameRulesState = {
  rules: GameRules | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
};

/** GET /api/game/rules — 공개(비로그인 가능). 한 번 받으면 캐시, 실패 시 error + retry */
export function useGameRules(): GameRulesState {
  const [rules, setRules] = useState<GameRules | null>(cached);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const onLoaded = (r: GameRules) => {
      setRules(r);
      setError(false);
    };
    listeners.add(onLoaded);
    return () => {
      listeners.delete(onLoaded);
    };
  }, []);

  useEffect(() => {
    if (cached) {
      setRules(cached);
      return;
    }
    let cancelled = false;
    setError(false);
    loadRules()
      .then((r) => {
        if (!cancelled) setRules(r);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { rules, loading: rules === null && !error, error, retry };
}
