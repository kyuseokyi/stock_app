import { useCallback, useEffect, useMemo, useRef } from 'react';

import { fetchMarketOverview } from '@/features/market/api';
import { marketSession } from '@/features/market/dashboard';
import { useAutoRefresh } from '@/features/market/use-auto-refresh';
import { useMorningBrief } from '@/features/market/use-morning-brief';
import { useMovers, useMoversAutoRefresh } from '@/features/market/use-movers';
import { useRestResource } from '@/features/market/use-rest-resource';
import { useReturnRefresh } from '@/features/market/use-return-refresh';

import { pickHomeIndices, topMovers } from './summary';

/**
 * 앱 홈 요약(AI 브리핑·지수 3개·급등락) 데이터 — 공개 데이터라 로그인과 무관하다.
 * 진입 때 3건(브리핑·개요·급등락)만 받는다. 마켓 탭과 달리 테마·일정은 받지 않으므로 useMarketOverview 를 쓰지 않는다.
 * 섹션마다 따로 불러와 하나가 실패해도 나머지는 보이고, 실패한 섹션은 화면에서 조용히 숨는다.
 * 지수 30초·급등락 60초(정규장만)·브리핑 복귀 10분 — 모두 홈이 포커스·앱이 앞에 있을 때만.
 */
export function useHomeSummary() {
  const brief = useMorningBrief();
  const overview = useRestResource(fetchMarketOverview);
  const movers = useMovers();

  const indices = useMemo(() => overview.data?.indices ?? [], [overview.data]);
  const homeIndices = useMemo(() => pickHomeIndices(indices), [indices]);
  const topped = useMemo(() => topMovers(movers.data), [movers.data]);

  // useAutoRefresh 는 첫 포커스에 바로 한 번 부른다 — 첫 로딩이 진행 중이면 건너뛰어 개요를 두 번 받지 않게.
  // 첫 로딩이 실패한 뒤에는 다음 주기에 다시 받아 숨었던 섹션이 스스로 돌아온다.
  const overviewLoading = useRef(true);
  useEffect(() => {
    overviewLoading.current = overview.loading;
  }, [overview.loading]);
  const overviewSilent = overview.silentRefresh;
  const refreshOverview = useCallback(
    async () => (overviewLoading.current ? undefined : overviewSilent()),
    [overviewSilent],
  );
  useAutoRefresh(refreshOverview);
  useMoversAutoRefresh(movers.silentRefresh, marketSession(indices));
  useReturnRefresh(brief.silentRefresh, brief.fetchedAt);
  useReturnRefresh(movers.silentRefresh, movers.fetchedAt);

  /** 당겨서 새로고침 — 실패한 섹션은 받아 둔 값을 유지하고, 오류는 올리지 않는다 */
  const refresh = () => Promise.allSettled([brief.refresh(), overview.refresh(), movers.refresh()]);

  return {
    brief: brief.data,
    indices: homeIndices,
    indicesLoading: overview.loading,
    movers: topped,
    moversUpdatedAt: movers.data?.updatedAt ?? null,
    moversLoading: movers.loading,
    refresh,
  };
}
