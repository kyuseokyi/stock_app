import { useCallback, useEffect, useRef } from 'react';

import type { MarketSession } from './dashboard';
import { fetchFeatured } from './rest';
import { useAutoRefresh } from './use-auto-refresh';
import { useRestResource } from './use-rest-resource';

/** 오늘 특징주(신고가·신저가 + VI 발동). 장중 자동 갱신은 화면이 useFeaturedAutoRefresh 를 건다 */
export function useFeatured() {
  return useRestResource(fetchFeatured);
}

/** 자동 갱신 주기 — 서버 VI 수집이 5분 주기라 그에 맞춘다 */
export const FEATURED_REFRESH_MS = 5 * 60_000;

/** 정규장일 때만 5분마다 조용히 갱신(VI 발동이 늘어나는 시간) — 화면이 포커스·앱이 앞에 있을 때만 */
export function useFeaturedAutoRefresh(silentRefresh: () => Promise<unknown>, session: MarketSession | null) {
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const refreshInSession = useCallback(
    async () => (sessionRef.current === '정규장' ? silentRefresh() : undefined),
    [silentRefresh],
  );
  useAutoRefresh(refreshInSession, FEATURED_REFRESH_MS);
}
