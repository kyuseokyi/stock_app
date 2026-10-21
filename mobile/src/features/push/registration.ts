// 푸시 등록 동기화 — 실제 의존성 연결. 호출 시점: 앱 실행·로그인 직후, 펀드 추가·삭제, 권한 허용 직후,
// 내정보 새 글 알림 스위치 변경, active 복귀. 로그아웃 직전은 훅.
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { registerBeforeLogout } from '@/features/auth/logout-hooks';
import { useAuthStore } from '@/features/auth/store';
import { loadFunds } from '@/features/fund/fund-store';

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
  countFunds: async () => (await loadFunds()).length,
  postNotice: loadPostNotice,
  permission: async () => (await Notifications.getPermissionsAsync()).status as PushPermission,
  getPushToken: async () =>
    (await withTimeout(Notifications.getExpoPushTokenAsync({ projectId: getProjectId() }), PUSH_TIMEOUT_MS, 'push token')).data,
  loadSaved: () => SecureStore.getItemAsync(SAVED_KEY),
  saveSaved: (raw) => (raw ? SecureStore.setItemAsync(SAVED_KEY, raw) : SecureStore.deleteItemAsync(SAVED_KEY)),
  put: (auth, token, flags) => putPushDevice(auth, token, platform, flags),
  del: deletePushDevice,
};

const registrar = createPushRegistrar(deps);

export const syncPushRegistration = () => registrar.sync();

let hooked = false;
/** 로그아웃 직전 해제 훅 — 앱 시작 시 한 번 */
export function installPushLogoutHook(): void {
  if (hooked) return;
  hooked = true;
  registerBeforeLogout((authToken) => {
    if (isPushConfigured()) void registrar.unregister(authToken);
  });
}
