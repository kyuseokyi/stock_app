import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  registerUnauthorizedHandler,
  setAuthToken as setHttpAuthToken,
  setRefreshToken as setHttpRefreshToken,
} from '@/lib/api/auth-token';

import { sessionEndMessage, shouldValidate, type SessionEndReason } from '@/lib/api/session-end';
import { callRefresh, isAccessTokenStale, registerTokensRefreshed, serverLogout } from '@/lib/api/token-refresh';
import { showToast } from '@/ui';

import { deleteAccount as deleteAccountApi, fetchMe, guestLogin, toUserOrNull, type LoginResult } from './api';
import { runBeforeLogout } from './logout-hooks';
import type { User } from './types';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
/** 리프레시 토큰(앱 로그인만) — 2026-10-22 모바일 리프레시 토큰 설계 */
export const REFRESH_KEY = 'auth_refresh';
/** 사용자 로그아웃 직전 갱신(푸시 해제용 유효 토큰 확보)의 시간 제한 — 오래 걸리면 갱신 없이 진행 */
export const LOGOUT_REFRESH_TIMEOUT_MS = 5_000;

type AuthState = {
  token: string | null;
  /** 리프레시 토큰 — 없으면(구 로그인) 접근 토큰 만료 시 다시 로그인 */
  refreshToken: string | null;
  user: User | null;
  /** SecureStore에서 최초 로드를 마쳤는지 여부. false인 동안은 로그아웃 상태로 취급한다. */
  hydrated: boolean;
  login: (nickname: string) => Promise<User>;
  /** 이미 발급된 토큰(간편 로그인 교환 결과)을 저장 — login 과 같은 경로(메모리 홀더 + SecureStore) */
  loginWithToken: (result: LoginResult) => User;
  /** 토큰 갱신 결과 저장(token-refresh.ts 콜백) — user 는 서버 원형(검증 후 반영, 틀리면 기존 유지) */
  applyRefreshed: (r: { accessToken: string; refreshToken: string; user: unknown }) => void;
  /** 사용자 로그아웃 — 로컬 즉시 삭제, 서버 정리(필요 시 갱신 → 훅 → /auth/logout)는 백그라운드 */
  logout: () => void;
  /** 회원 탈퇴(DELETE /auth/me) 성공 시 로그아웃. 실패는 그대로 throw(ApiError) — 로그인 상태 유지 */
  deleteAccount: () => Promise<void>;
  hydrate: () => Promise<void>;
  /** 서버가 토큰을 거부(401·WS 4401) — 거부된 토큰이 현재 토큰일 때만 로그아웃 + 안내 1회 */
  expireSession: (rejectedToken: string | null, reason: SessionEndReason) => void;
  /** 실행·포그라운드 복귀 시 GET /auth/me 로 세션 확인(force=false 면 60초 이내 생략, 네트워크 오류 무시) */
  validateSession: (force?: boolean) => Promise<void>;
};

// 저장은 한 줄로 — 연속 회전(R2 → R3)의 쓰기가 뒤섞여 옛 리프레시가 남지 않게
let persistChain: Promise<void> = Promise.resolve();

function persist(token: string | null, refreshToken: string | null, user: User | null): Promise<void> {
  const run = persistChain.then(() => write(token, refreshToken, user));
  persistChain = run.catch(() => {});
  return run;
}

async function write(token: string | null, refreshToken: string | null, user: User | null): Promise<void> {
  // 리프레시를 먼저 — 회전된 리프레시를 잃으면 다음 실행에서 이미 쓴 토큰을 다시 보내 재사용(REFRESH_REUSED)으로 끊긴다
  await (refreshToken ? SecureStore.setItemAsync(REFRESH_KEY, refreshToken) : SecureStore.deleteItemAsync(REFRESH_KEY));
  await Promise.all([
    token ? SecureStore.setItemAsync(TOKEN_KEY, token) : SecureStore.deleteItemAsync(TOKEN_KEY),
    user
      ? SecureStore.setItemAsync(USER_KEY, JSON.stringify(user))
      : SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

let lastValidatedAt = 0;

/**
 * 세션 종료의 서버 쪽 정리(로컬 상태는 이미 비움). 순서: (사용자 로그아웃이고 접근 토큰이 만료 임박이면) 갱신
 * → 로그아웃 훅(푸시 해제 등) 대기 → 서버 /auth/logout(best-effort).
 * 로그아웃 직전 갱신 결과는 store 에 쓰지 않는다(로그아웃한 세션이 되살아나지 않게).
 */
async function finishLogoutRemotely(
  access: string | null,
  refresh: string | null,
  hooksDone: Promise<void> | null,
  serverSide: boolean,
): Promise<void> {
  let refreshForLogout = refresh;
  if (!hooksDone) {
    let hookToken = access;
    if (access && refresh) {
      const r = await callRefresh(refresh, LOGOUT_REFRESH_TIMEOUT_MS);
      if (r.ok) {
        hookToken = r.accessToken;
        refreshForLogout = r.refreshToken;
      }
    }
    if (hookToken) await runBeforeLogout(hookToken);
  } else {
    await hooksDone;
  }
  if (serverSide && refreshForLogout) await serverLogout(refreshForLogout);
}

type EndMode = 'user' | 'expired' | 'deleted';

// 게스트(닉네임) 로그인 전역 상태. web client의 store/auth.js와 동일한 의미론(token+user, login/logout).
// 토큰은 SecureStore에 영속화하고, http 클라이언트가 동기적으로 읽을 수 있도록 메모리 홀더(auth-token.ts)에도 반영한다.
export const useAuthStore = create<AuthState>((set, get) => {
  /**
   * 로컬 로그아웃(즉시) + 서버 정리(백그라운드).
   * - user: 접근 토큰이 만료 임박이고 리프레시가 있으면 짧은 시간 제한으로 갱신을 먼저 시도(푸시 해제가 401 나지 않게)
   * - expired·deleted: 이미 거부된 세션·삭제된 사용자 — 갱신하지 않음. deleted 는 서버 로그아웃도 생략(탈퇴가 이미 폐기)
   * 갱신이 필요 없으면 훅은 지금처럼 로컬 삭제 전에 동기로 시작한다.
   */
  const endSession = (mode: EndMode) => {
    const { token: access, refreshToken: refresh } = get();
    const preRefresh = mode === 'user' && !!access && !!refresh && isAccessTokenStale(access);
    const hooksDone = preRefresh ? null : access ? runBeforeLogout(access) : Promise.resolve();
    setHttpAuthToken(null);
    setHttpRefreshToken(null);
    set({ token: null, refreshToken: null, user: null });
    persist(null, null, null).catch(() => {});
    if (access || refresh) {
      void finishLogoutRemotely(access, refresh, hooksDone, mode !== 'deleted').catch(() => {});
    }
  };

  return {
    token: null,
    refreshToken: null,
    user: null,
    hydrated: false,

    login: async (nickname: string) => {
      const result = await guestLogin(nickname);
      return get().loginWithToken(result);
    },

    loginWithToken: ({ accessToken, refreshToken = null, user }) => {
      setHttpAuthToken(accessToken);
      setHttpRefreshToken(refreshToken);
      set({ token: accessToken, refreshToken, user });
      // 저장 실패는 무시(메모리 상태가 우선) — logout()과 동일하게 fire-and-forget.
      persist(accessToken, refreshToken, user).catch(() => {});
      return user;
    },

    applyRefreshed: ({ accessToken, refreshToken, user }) => {
      const nextUser = toUserOrNull(user) ?? get().user;
      set({ token: accessToken, refreshToken, user: nextUser });
      persist(accessToken, refreshToken, nextUser).catch(() => {});
    },

    logout: () => endSession('user'),

    deleteAccount: async () => {
      await deleteAccountApi();
      endSession('deleted');
    },

    expireSession: (rejectedToken, reason) => {
      if (rejectedToken === null || rejectedToken !== get().token) return;
      endSession('expired');
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
        // 요청 중 갱신으로 토큰이 회전됐어도 같은 사용자면 반영 — 로그아웃·다른 사용자 재로그인만 걸러낸다
        const cur = get();
        if (!cur.token || (cur.token !== token && cur.user?.id !== user.id)) return;
        set({ user });
        persist(cur.token, cur.refreshToken, user).catch(() => {});
      } catch {
        // 401 은 http 클라이언트 → notifyUnauthorized → expireSession 이 처리. 네트워크 오류·5xx 는 무시
      }
    },

    hydrate: async () => {
      if (get().hydrated) return;
      try {
        const [token, rawUser, refreshToken] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
          SecureStore.getItemAsync(REFRESH_KEY),
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
        // 접근 토큰 없이 남은 리프레시(저장 도중 종료 등)는 쓰지 않는다
        const refresh = token ? refreshToken : null;
        setHttpRefreshToken(refresh);
        set({ token, refreshToken: refresh, user, hydrated: true });
      } catch {
        set({ hydrated: true });
      }
    },
  };
});

// 갱신 성공(token-refresh.ts) → 상태·SecureStore 저장
registerTokensRefreshed((r) => {
  useAuthStore.getState().applyRefreshed(r);
});

// http 클라이언트가 401 을 받으면 사유별 안내와 함께 로그아웃(web client interceptor 와 동일 동작)
registerUnauthorizedHandler((rejectedToken, reason) => {
  useAuthStore.getState().expireSession(rejectedToken, reason);
});
