import { useCallback, useEffect, useRef } from 'react';

import type { MarketSession } from './dashboard';
import { fetchMovers } from './rest';
import { useAutoRefresh } from './use-auto-refresh';
import { useRestResource } from './use-rest-resource';

/** 급등·급락 Top 10 + AI 원인·핫 키워드. 장중 자동 갱신은 화면이 useMoversAutoRefresh 를 건다 */
export function useMovers() {
  return useRestResource(fetchMovers);
}

/** 급등락 자동 갱신 주기 — 서버 AI 원인 분석이 몇 분 단위라 지수(30초)보다 느리게 */
export const MOVERS_REFRESH_MS = 60_000;

/** 정규장일 때만 60초마다 급등락을 조용히 갱신 — 화면이 포커스·앱이 앞에 있을 때만 */
export function useMoversAutoRefresh(silentRefresh: () => Promise<unknown>, session: MarketSession | null) {
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const refreshInSession = useCallback(
    async () => (sessionRef.current === '정규장' ? silentRefresh() : undefined),
    [silentRefresh],
  );
  useAutoRefresh(refreshInSession, MOVERS_REFRESH_MS);
}
