// 알림 표시·채널·탭 처리 — 루트 레이아웃에서 usePushSetup() 한 번
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuthStore } from '@/features/auth/store';
import { fundRefresher } from '@/features/fund/auto-refresh';

import { isPushConfigured } from './config';
import { createResponseClaimer, FUND_CHANNEL_ID, handleNotificationResponseWith } from './handlers-core';
import { installPushLogoutHook, syncPushRegistration } from './registration';

// 같은 알림 응답을 두 번 처리하지 않게(효과 재실행·앱 재실행 때 getLastNotificationResponseAsync 가 같은 응답을 다시 줄 수 있음)
const HANDLED_KEY = 'push_last_handled_v1';
const claimResponse = createResponseClaimer(
  () => SecureStore.getItemAsync(HANDLED_KEY),
  (id) => void SecureStore.setItemAsync(HANDLED_KEY, id).catch(() => {}),
);

// 로그아웃 훅은 모듈 로드 시점에 설치 — hydrate().then(validateSession) 의 401 로그아웃보다 먼저 있어야 한다(멱등)
installPushLogoutHook();

// 앱이 앞에 있을 때 받은 알림은 배너를 띄우지 않는다(SSE·자동 갱신이 이미 반영) — 알림 목록에는 남김
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Android 13+ 는 권한 요청 전에 채널이 있어야 한다 */
export async function ensureFundChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(FUND_CHANNEL_ID, {
    name: '펀드 리포트',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export function usePushSetup(): void {
  const router = useRouter();
  const loggedIn = useAuthStore((s) => s.user !== null);
  // 로그인 상태 복원(hydrate) 전에 /fund 로 가면 펀드 화면이 user=null 로 보고 /profile 로 튕긴다 → 복원 후에 처리
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    if (!isPushConfigured() || !hydrated) return;
    void ensureFundChannel();
    const handle = async (r: Notifications.NotificationResponse | null) => {
      if (!r || !(await claimResponse(r.notification.request.identifier))) return;
      handleNotificationResponseWith(r.notification.request.content.data, {
        navigate: (p) => router.push(p),
        refresh: () => void fundRefresher.run({ force: true }),
      });
    };
    void Notifications.getLastNotificationResponseAsync().then(handle); // 콜드 스타트(앱이 꺼진 상태에서 탭)
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    return () => sub.remove();
  }, [router, hydrated]);

  // 앱 실행·로그인 직후 등록 동기화
  useEffect(() => {
    if (loggedIn) void syncPushRegistration();
  }, [loggedIn]);

  // 설정 앱에서 알림 권한을 켜고 돌아오면 재동기화(토큰이 같으면 서버 호출은 생략됨)
  useEffect(() => {
    if (!loggedIn || !hydrated || !isPushConfigured()) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncPushRegistration();
    });
    return () => sub.remove();
  }, [loggedIn, hydrated]);
}
