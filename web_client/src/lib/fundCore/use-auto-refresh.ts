// 자동 갱신 상태 구독 훅(웹·앱 공용). web_client/src/lib/fundCore 와 동일.
import { useSyncExternalStore } from 'react';

import type { AutoRefresher, AutoRefreshStatus } from './refresh-all';

export function useAutoRefreshStatus(r: AutoRefresher): AutoRefreshStatus {
  return useSyncExternalStore(r.subscribe, r.getStatus, r.getStatus);
}
