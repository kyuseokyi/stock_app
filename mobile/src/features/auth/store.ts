import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { registerUnauthorizedHandler, setAuthToken as setHttpAuthToken } from '@/lib/api/auth-token';

import { sessionEndMessage, shouldValidate, type SessionEndReason } from '@/lib/api/session-end';
import { showToast } from '@/ui';

import { deleteAccount as deleteAccountApi, fetchMe, guestLogin, type LoginResult } from './api';
import { runBeforeLogout } from './logout-hooks';
import type { User } from './types';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

type AuthState = {
  token: string | null;
  user: User | null;
  /** SecureStore에서 최초 로드를 마쳤는지 여부. false인 동안은 로그아웃 상태로 취급한다. */
  hydrated: boolean;
  login: (nickname: string) => Promise<User>;
  /** 이미 발급된 토큰(간편 로그인 교환 결과)을 저장 — login 과 같은 경로(메모리 홀더 + SecureStore) */
  loginWithToken: (result: LoginResult) => User;
  logout: () => void;
  /** 회원 탈퇴(DELETE /auth/me) 성공 시 로그아웃. 실패는 그대로 throw(ApiError) — 로그인 상태 유지 */
  deleteAccount: () => Promise<void>;
  hydrate: () => Promise<void>;
  /** 서버가 토큰을 거부(401·WS 4401) — 거부된 토큰이 현재 토큰일 때만 로그아웃 + 안내 1회 */
  expireSession: (rejectedToken: string | null, reason: SessionEndReason) => void;
  /** 실행·포그라운드 복귀 시 GET /auth/me 로 세션 확인(force=false 면 60초 이내 생략, 네트워크 오류 무시) */
  validateSession: (force?: boolean) => Promise<void>;
};

async function persist(token: string | null, user: User | null): Promise<void> {
  await Promise.all([
    token ? SecureStore.setItemAsync(TOKEN_KEY, token) : SecureStore.deleteItemAsync(TOKEN_KEY),
    user
      ? SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))
      : SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

let lastValidatedAt = 0;

// 게스트(닉네임) 로그인 전역 상태. web client의 store/auth.js와 동일한 의미론(token+user, login/logout).
// 토큰은 SecureStore에 영속화하고, http 클라이언트가 동기적으로 읽을 수 있도록 메모리 홀더(auth-token.ts)에도 반영한다.
export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  hydrated: false,

  login: async (nickname: string) => {
    const result = await guestLogin(nickname);
    return get().loginWithToken(result);
  },

  loginWithToken: ({ accessToken, user }) => {
    setHttpAuthToken(accessToken);
    set({ token: accessToken, user });
    // 저장 실패는 무시(메모리 상태가 우선) — logout()과 동일하게 fire-and-forget.
    persist(accessToken, user).catch(() => {});
    return user;
  },

  logout: () => {
    const prev = get().token;
    if (prev) runBeforeLogout(prev); // 토큰이 지워지기 전 — 푸시 기기 해제 등
    setHttpAuthToken(null);
    set({ token: null, user: null });
    persist(null, null).catch(() => {});
  },

  deleteAccount: async () => {
    await deleteAccountApi();
    get().logout();
  },

  expireSession: (rejectedToken, reason) => {
    if (rejectedToken === null || rejectedToken !== get().token) return;
    get().logout();
    showToast(sessionEndMessage(reason));
  },

  validateSession: async (force = false) => {
    const { token } = get();
    if (!token) return;
    const now = Date.now();
    if (!shouldValidate(lastValidatedAt, now, force)) return;
    lastValidatedAt = now;
    try {
      const user = await fetchMe();
      if (get().token !== token) return;
      set({ user });
      persist(token, user).catch(() => {});
    } catch {
      // 401 은 http 클라이언트 → notifyUnauthorized → expireSession 이 처리. 네트워크 오류·5xx 는 무시
    }
  },

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [token, rawUser] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);

      // hydrate()가 대기하는 동안 사용자가 이미 로그인했다면(닉네임 입력이 SecureStore 읽기보다 빠른 경우),
      // 이전 저장값으로 방금 로그인한 상태를 덮어쓰지 않는다.
      if (get().token) {
        set({ hydrated: true });
        return;
      }

      let user: User | null = null;
      if (rawUser) {
        try {
          user = JSON.parse(rawUser) as User;
        } catch {
          user = null; // 손상된 저장값이어도 토큰 복원은 계속 진행한다.
        }
      }
      setHttpAuthToken(token);
      set({ token, user, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));

// http 클라이언트가 401 을 받으면 사유별 안내와 함께 로그아웃(web client interceptor 와 동일 동작)
registerUnauthorizedHandler((rejectedToken, reason) => {
  useAuthStore.getState().expireSession(rejectedToken, reason);
});
