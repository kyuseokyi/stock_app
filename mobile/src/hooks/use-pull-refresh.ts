import { useCallback, useRef, useState } from 'react';

import { showToast } from '@/ui';

export const REFRESH_FAILED_MESSAGE = '새로고침하지 못했어요. 잠시 후 다시 시도해 주세요.';

/**
 * 당겨서 새로고침(RefreshControl) 공용 상태.
 * - 이미 새로고침 중이면 다시 당겨도 무시(중복 요청 방지)
 * - 실패하면 화면은 그대로 두고 토스트로만 알린다(목록이 사라지지 않게)
 * 사용: const { refreshing, onRefresh } = usePullRefresh(refresh)
 *       <FlatList refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} />
 */
export function usePullRefresh(run: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const runRef = useRef(run);
  runRef.current = run;

  const onRefresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    void runRef
      .current()
      .catch(() => showToast(REFRESH_FAILED_MESSAGE))
      .finally(() => {
        busy.current = false;
        setRefreshing(false);
      });
  }, []);

  return { refreshing, onRefresh };
}
