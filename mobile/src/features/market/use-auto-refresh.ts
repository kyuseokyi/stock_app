import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { startForegroundInterval } from '@/features/game/lib/foreground-interval';

import { createSilentRunner, MARKET_REFRESH_MS } from './auto-refresh';

/**
 * 화면이 포커스되어 있고 앱이 앞(AppState active)에 있는 동안만 ms 마다 run 을 조용히 부른다.
 * - 포커스를 잃거나(다른 탭·상세 화면) 컴포넌트가 사라지면 useFocusEffect 정리로 타이머를 멈춘다
 * - 백그라운드에서는 주기마다 건너뛴다(startForegroundInterval)
 * - run 은 최신 것을 쓴다(타이머 재생성 없음). 장 시간이 아니어도 돌지만 서버가 같은 값을 줄 뿐이다
 */
export function useAutoRefresh(run: () => Promise<unknown>, ms = MARKET_REFRESH_MS) {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useFocusEffect(
    useCallback(() => startForegroundInterval(createSilentRunner(() => runRef.current()), ms), [ms]),
  );
}
