// 푸시 등록 동기화 — 실제 의존성 연결. 호출 시점: 앱 실행·로그인 직후, 펀드 추가·삭제, 권한 허용 직후,
// 내정보 새 글 알림 스위치 변경, active 복귀. 로그아웃 직전은 훅.
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { registerBeforeLogout } from '@/features/auth/logout-hooks';
import { useAuthStore } from '@/features/auth/store';
import { loadFunds } from '@/features/fund/fund-store';
import { isNoOwnerError } from '@/features/fund/owner';
import { withFreshAuth } from '@/lib/api/token-refresh';

import { deletePushDevice, putPushDevice } from './api';
import { getProjectId, isPushConfigured } from './config';
import { loadPostNotice } from './post-notice';
import { createPushRegistrar, PUSH_TIMEOUT_MS, withTimeout, type PushPermission, type SyncDeps } from './registration-core';

// 키를 바꾸지 않는다 — 구버전(토큰 문자열) 값도 이 키에 있어야 업데이트 뒤 로그아웃 때 해제할 수 있다
const SAVED_KEY = 'push_device_v1';
const platform = Platform.OS === 'ios' ? 'ios' : 'android';

const deps: SyncDeps = {
  isConfigured: isPushConfigured,
  authToken: () => useAuthStore.getState().token,
  // 사용자 정보 없이 토큰만 복원된 경우(저장값 손상)는 펀드 0개 — 읽기 실패는 그대로 던져 이번 동기화를 건너뛴다
  // (일시 오류로 fund_notice=false 를 보내지 않게)
  countFunds: async () => {
    try {
      return (await loadFunds()).length;
    } catch (e) {
      if (isNoOwnerError(e)) return 0;
      throw e;
    }
  },
  postNotice: loadPostNotice,
  permission: async () => (await Notifications.getPermissionsAsync()).status as PushPermission,
  getPushToken: async () =>
    (await withTimeout(Notifications.getExpoPushTokenAsync({ projectId: getProjectId() }), PUSH_TIMEOUT_MS, 'push token')).data,
  loadSaved: () => SecureStore.getItemAsync(SAVED_KEY),
  saveSaved: (raw) => (raw ? SecureStore.setItemAsync(SAVED_KEY, raw) : SecureStore.deleteItemAsync(SAVED_KEY)),
  // 등록·권한 해제 시 삭제: 만료 임박이면 먼저 갱신, 401(만료)이면 한 번 갱신 후 재시도(getFreshAccessToken)
  put: (auth, token, flags) => withFreshAuth(auth, (a) => putPushDevice(a, token, platform, flags)),
  del: (auth, token) => withFreshAuth(auth, (a) => deletePushDevice(a, token)),
};

// 로그아웃 직전 해제는 훅 인자 토큰 그대로(이미 로컬 상태가 비었을 수 있음 — 필요한 갱신은 로그아웃 쪽이 먼저 한다)
const logoutDeps = { ...deps, del: deletePushDevice };

const registrar = createPushRegistrar(deps, logoutDeps);

export const syncPushRegistration = () => registrar.sync();

let hooked = false;
/** 로그아웃 직전 해제 훅 — 앱 시작 시 한 번 */
export function installPushLogoutHook(): void {
  if (hooked) return;
  hooked = true;
  // Promise 를 돌려줘 로그아웃이 해제를 기다린 뒤 서버 로그아웃(/auth/logout — 세션 삭제)을 보낸다
  registerBeforeLogout((authToken) => (isPushConfigured() ? registrar.unregister(authToken) : undefined));
}
