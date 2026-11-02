import { useFocusEffect } from 'expo-router';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { createSilentRunner, RETURN_REFRESH_MS, shouldRefetchOnReturn } from './auto-refresh';

/**
 * 화면에 다시 들어오거나 앱이 앞으로 돌아왔을 때, 마지막 조회(lastFetchedAt) 후 ms 이상 지났으면 run 을 조용히 1회 부른다.
 * 주기 타이머가 없어 머물러 있는 동안 서버 요청은 늘지 않는다. 실패는 삼키고 다음 복귀 때 다시 판단한다.
 */
export function useReturnRefresh(
  run: () => Promise<unknown>,
  lastFetchedAt: RefObject<number | null>,
  ms = RETURN_REFRESH_MS,
) {
  const latest = useRef({ run, lastFetchedAt });
  useEffect(() => {
    latest.current = { run, lastFetchedAt };
  });
  const runner = useRef<(() => void) | null>(null);

  useFocusEffect(
    useCallback(() => {
      runner.current ??= createSilentRunner(() => latest.current.run());
      const check = () => {
        if (shouldRefetchOnReturn(latest.current.lastFetchedAt.current, Date.now(), ms)) runner.current?.();
      };
      check();
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') check();
      });
      return () => sub.remove();
    }, [ms]),
  );
}
