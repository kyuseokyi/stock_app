// auth store — 리프레시 토큰 저장·복원, 로그아웃 서버 정리, 세션 만료 1회(2026-10-22 모바일 리프레시 토큰 설계)
import { getAuthToken, getRefreshToken, notifyUnauthorized } from '@/lib/api/auth-token';
import { refreshAccessToken } from '@/lib/api/token-refresh';

import { registerBeforeLogout } from './logout-hooks';
import { REFRESH_KEY, useAuthStore } from './store';

// jest.mock 은 import 보다 먼저 실행되도록 호이스팅된다(팩토리 안 변수는 mock 접두사)
const mockMem = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockMem.set(k, v);
  }),
  getItemAsync: jest.fn(async (k: string) => mockMem.get(k) ?? null),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockMem.delete(k);
  }),
}));
const mockToasts: string[] = [];
jest.mock('@/ui', () => ({ showToast: (m: string) => mockToasts.push(m) }));

const user = { id: 7, email: null, nickname: '개미', role: 'user' };

function jwt(expSec: number, tag = 'x'): string {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256' })}.${enc({ sub: '7', exp: expSec, tag })}.sig`;
}
const fresh = (tag = 'a') => jwt(Math.floor(Date.now() / 1000) + 3600, tag);
const expired = (tag = 'e') => jwt(Math.floor(Date.now() / 1000) - 10, tag);

type Res = { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> };
const res = (status: number, body?: unknown): Res => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  json: async () => body,
  text: async () => '',
});

const realFetch = global.fetch;
let calls: { url: string; body: unknown }[];
function mockFetch(handler: (url: string) => Res | Promise<Res>) {
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(String(url));
  }) as unknown as typeof fetch;
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  mockMem.clear();
  mockToasts.length = 0;
  calls = [];
  mockFetch(() => res(204));
  // 이전 테스트의 로그인 상태 정리(서버 호출 없이)
  useAuthStore.setState({ token: null, refreshToken: null, user: null, hydrated: false });
});
afterEach(() => {
  global.fetch = realFetch;
});

describe('리프레시 토큰 저장·복원', () => {
  it('loginWithToken → 메모리 홀더·SecureStore(auth_refresh) 에 저장', async () => {
    const a = fresh();
    useAuthStore.getState().loginWithToken({ accessToken: a, refreshToken: 'R1', user });
    await flush();
    expect(getAuthToken()).toBe(a);
    expect(getRefreshToken()).toBe('R1');
    expect(useAuthStore.getState().refreshToken).toBe('R1');
    expect(mockMem.get(REFRESH_KEY)).toBe('R1');
    expect(mockMem.get('auth_token')).toBe(a);
  });

  it('리프레시 없는 로그인(구 서버) → auth_refresh 삭제', async () => {
    mockMem.set(REFRESH_KEY, 'old');
    useAuthStore.getState().loginWithToken({ accessToken: fresh(), user });
    await flush();
    expect(mockMem.has(REFRESH_KEY)).toBe(false);
    expect(getRefreshToken()).toBeNull();
  });

  it('hydrate → 리프레시도 복원(메모리 홀더 포함)', async () => {
    const a = fresh();
    mockMem.set('auth_token', a);
    mockMem.set('auth_user', JSON.stringify(user));
    mockMem.set(REFRESH_KEY, 'R9');
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ token: a, refreshToken: 'R9', hydrated: true });
    expect(getRefreshToken()).toBe('R9');
  });

  it('갱신 성공 → store 상태·SecureStore 가 새 토큰 쌍으로', async () => {
    useAuthStore.getState().loginWithToken({ accessToken: expired(), refreshToken: 'R1', user });
    const a2 = fresh('a2');
    mockFetch(() =>
      res(200, { access_token: a2, refresh_token: 'R2', token_type: 'bearer', expires_in: 3600, user: { ...user, nickname: '새이름' } }),
    );
    await expect(refreshAccessToken()).resolves.toEqual({ ok: true, accessToken: a2 });
    await flush();
    expect(useAuthStore.getState()).toMatchObject({ token: a2, refreshToken: 'R2', user: { nickname: '새이름' } });
    expect(mockMem.get(REFRESH_KEY)).toBe('R2');
    expect(mockMem.get('auth_token')).toBe(a2);
  });
});

describe('로그아웃', () => {
  it('훅(푸시 해제)이 끝난 뒤 서버 /auth/logout {refresh_token}, 로컬 즉시 삭제', async () => {
    const a = fresh();
    useAuthStore.getState().loginWithToken({ accessToken: a, refreshToken: 'R1', user });
    await flush();
    const order: string[] = [];
    let releaseHook!: () => void;
    const off = registerBeforeLogout((t) => {
      order.push(`hook:${t === a}`);
      return new Promise<void>((r) => (releaseHook = r));
    });
    mockFetch((url) => {
      order.push(url.endsWith('/api/v1/auth/logout') ? 'logout' : url);
      return res(204);
    });

    useAuthStore.getState().logout();
    expect(useAuthStore.getState().token).toBeNull();
    expect(getAuthToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    await flush();
    expect(order).toEqual(['hook:true']); // 훅이 끝나기 전엔 서버 로그아웃 안 함
    releaseHook();
    await flush();
    expect(order).toEqual(['hook:true', 'logout']);
    expect(calls.at(-1)?.body).toEqual({ refresh_token: 'R1' });
    expect(mockMem.has(REFRESH_KEY)).toBe(false);
    off();
  });

  it('접근 토큰이 만료됐으면 먼저 갱신 → 훅은 새 토큰 → 새 리프레시로 /logout, 상태는 되살아나지 않음', async () => {
    useAuthStore.getState().loginWithToken({ accessToken: expired(), refreshToken: 'R1', user });
    await flush();
    const a2 = fresh('a2');
    const hookTokens: string[] = [];
    const off = registerBeforeLogout((t) => {
      hookTokens.push(t);
    });
    mockFetch((url) =>
      url.endsWith('/api/v1/auth/refresh')
        ? res(200, { access_token: a2, refresh_token: 'R2', token_type: 'bearer', expires_in: 3600, user })
        : res(204),
    );

    useAuthStore.getState().logout();
    await flush();
    expect(hookTokens).toEqual([a2]);
    expect(calls.map((c) => c.url.replace(/^.*\/api\/v1\/auth/, ''))).toEqual(['/refresh', '/logout']);
    expect(calls[1].body).toEqual({ refresh_token: 'R2' });
    expect(useAuthStore.getState().token).toBeNull();
    expect(getAuthToken()).toBeNull();
    expect(mockMem.has('auth_token')).toBe(false);
    off();
  });

  it('리프레시 없는 세션(구 로그인)은 서버 로그아웃 호출 없음', async () => {
    useAuthStore.getState().loginWithToken({ accessToken: fresh(), user });
    useAuthStore.getState().logout();
    await flush();
    expect(calls).toEqual([]);
  });
});

describe('세션 만료', () => {
  it('같은 토큰으로 401 이 여러 번 와도 로그아웃·안내 1회, 갱신 시도 없음', async () => {
    const a = fresh();
    useAuthStore.getState().loginWithToken({ accessToken: a, refreshToken: 'R1', user });
    notifyUnauthorized(a, 'expired');
    notifyUnauthorized(a, 'expired');
    await flush();
    expect(useAuthStore.getState().token).toBeNull();
    expect(mockToasts).toEqual(['로그인이 만료되었어요. 다시 로그인해 주세요']);
    expect(calls.some((c) => c.url.endsWith('/api/v1/auth/refresh'))).toBe(false);
  });

  it('이전 토큰의 늦은 401 은 새 세션을 지우지 않음', async () => {
    useAuthStore.getState().loginWithToken({ accessToken: fresh('new'), refreshToken: 'R2', user });
    notifyUnauthorized(fresh('old'), 'expired');
    expect(useAuthStore.getState().refreshToken).toBe('R2');
    expect(mockToasts).toEqual([]);
  });
});
