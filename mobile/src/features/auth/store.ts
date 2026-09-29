import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { registerUnauthorizedHandler, setAuthToken as setHttpAuthToken } from '@/lib/api/auth-token';

import { guestLogin } from './api';
import type { User } from './types';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

type AuthState = {
  token: string | null;
  user: User | null;
  /** SecureStore에서 최초 로드를 마쳤는지 여부. false인 동안은 로그아웃 상태로 취급한다. */
  hydrated: boolean;
  login: (nickname: string) => Promise<User>;
  logout: () => void;
  hydrate: () => Promise<void>;
};

async function persist(token: string | null, user: User | null): Promise<void> {
  await Promise.all([
    token ? SecureStore.setItemAsync(TOKEN_KEY, token) : SecureStore.deleteItemAsync(TOKEN_KEY),
    user
      ? SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))
      : SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

// 게스트(닉네임) 로그인 전역 상태. web client의 store/auth.js와 동일한 의미론(token+user, login/logout).
// 토큰은 SecureStore에 영속화하고, http 클라이언트가 동기적으로 읽을 수 있도록 메모리 홀더(auth-token.ts)에도 반영한다.
export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  hydrated: false,

  login: async (nickname: string) => {
    const { accessToken, user } = await guestLogin(nickname);
    setHttpAuthToken(accessToken);
    set({ token: accessToken, user });
    // 저장 실패는 무시(메모리 상태가 우선) — logout()과 동일하게 fire-and-forget.
    persist(accessToken, user).catch(() => {});
    return user;
  },

  logout: () => {
    setHttpAuthToken(null);
    set({ token: null, user: null });
    persist(null, null).catch(() => {});
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

// http 클라이언트가 401을 받으면 저장된 인증 정보를 정리한다(재로그인 유도) — web client interceptor와 동일 동작.
registerUnauthorizedHandler(() => {
  useAuthStore.getState().logout();
});
