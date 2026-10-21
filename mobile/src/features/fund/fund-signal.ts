// 앱이 열려 있을 때 관리자 "오늘 리포트 업데이트" 신호(SSE)를 받아 0~30초 뒤 자동 갱신(force).
// 푸시 설정(EAS·Firebase) 없이도 동작한다. 백그라운드에서는 연결하지 않는다(배터리·서버 연결 수).
import { useEffect } from 'react';
import { AppState } from 'react-native';
import EventSource from 'react-native-sse';

import { useAuthStore } from '@/features/auth/store';
import { ENV } from '@/lib/env';

import { fundRefresher } from './auto-refresh';
import { createSignalController, createSignalScheduler, parseFundSignal } from './fund-signal-core';
import { loadFunds } from './fund-store';

// 연결이 닫힌 사이(백그라운드)에 대기 중이던 신호를 잃지 않도록 모듈 단위로 유지
const scheduler = createSignalScheduler({
  run: () => void fundRefresher.run({ force: true }),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
});

function openStream(): () => void {
  const es = new EventSource<'notification'>(`${ENV.blogApiUrl}/api/v1/notifications/stream`);
  es.addEventListener('notification', (e) => {
    if (parseFundSignal(e.data)) scheduler.signal();
  });
  scheduler.start(); // 놓친 신호가 있으면 지연 없이 바로 갱신
  return () => {
    scheduler.stop();
    es.removeAllEventListeners();
    es.close();
  };
}

/** 루트 레이아웃에서 한 번 */
export function useFundSignal(): void {
  const loggedIn = useAuthStore((s) => s.user !== null);
  useEffect(() => {
    const c = createSignalController({ open: openStream, countFunds: async () => (await loadFunds()).length });
    void c.update({ loggedIn, active: AppState.currentState === 'active' });
    const sub = AppState.addEventListener('change', (next) => {
      void c.update({ loggedIn, active: next === 'active' });
    });
    return () => {
      sub.remove();
      c.dispose();
    };
  }, [loggedIn]);
}
