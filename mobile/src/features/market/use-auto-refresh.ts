import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { startForegroundInterval } from '@/features/game/lib/foreground-interval';

import { createSilentRunner, MARKET_REFRESH_MS, shouldRefreshNow } from './auto-refresh';

/**
 * 화면이 포커스되어 있고 앱이 앞(AppState active)에 있는 동안만 ms 마다 run 을 조용히 부른다.
 * - 포커스를 잃거나(다른 탭·상세 화면) 컴포넌트가 사라지면 useFocusEffect 정리로 타이머·AppState 리스너를 멈춘다
 * - 다시 포커스되거나 앱이 앞으로 돌아올 때, 마지막 실행 후 ms 이상 지났으면 즉시 1회(옛 "장중" 값이 남아 보이지 않게)
 * - 실행기는 한 번만 만들어 재사용 — 포커스마다 busy 가 초기화돼 요청이 겹치지 않는다
 * - run 은 최신 것을 쓴다(타이머 재생성 없음). 장 시간이 아니어도 돌지만 서버가 같은 값을 줄 뿐이다
 */
export function useAutoRefresh(run: () => Promise<unknown>, ms = MARKET_REFRESH_MS) {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const runner = useRef<(() => void) | null>(null);
  const lastAt = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      runner.current ??= createSilentRunner(() => runRef.current());
      const fire = () => {
        lastAt.current = Date.now();
        runner.current?.();
      };
      const catchUp = () => {
        if (shouldRefreshNow(lastAt.current, Date.now(), ms)) fire();
      };
      catchUp();
      const stopTimer = startForegroundInterval(fire, ms);
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') catchUp();
      });
      return () => {
        stopTimer();
        sub.remove();
      };
    }, [ms]),
  );
}
