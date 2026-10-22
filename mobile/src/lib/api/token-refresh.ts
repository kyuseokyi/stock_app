/**
 * 앱 접근 토큰 갱신(리프레시 토큰) — 설계 docs/superpowers/specs/2026-10-22-mobile-refresh-token-design.md 4절.
 *
 * - 갱신·서버 로그아웃 요청은 http 클라이언트를 거치지 않는 직접 fetch(401 처리 로직을 다시 타면 무한 루프).
 * - refreshAccessToken() 은 single-flight: 동시에 여러 401 이 와도 서버 갱신은 한 번.
 * - 결과는 판별 유니온으로 돌려주고 로그아웃 판단(notifyUnauthorized)은 호출자(http·게임 WS)가 한다 —
 *   로그아웃·탈퇴 경로에서 갱신이 실패해도 "만료" 안내가 뜨지 않게.
 * - store 를 import 하지 않는다(순환 참조 방지). 갱신 결과 저장은 store 가 등록한 콜백으로.
 */
import { ENV } from '@/lib/env';

import { getAuthToken, getRefreshToken, setAuthToken, setRefreshToken } from './auth-token';
import { codeFromBody, isRefreshable401 } from './session-end';

export const REFRESH_PATH = '/api/v1/auth/refresh';
export const LOGOUT_PATH = '/api/v1/auth/logout';
export const REFRESH_TIMEOUT_MS = 15_000;
/** 만료 이만큼 전부터는 "곧 만료"로 보고 미리 갱신(기기 시계 오차 여유) */
export const STALE_MARGIN_MS = 60_000;

/**
 * 서버 원응답 하나 — 성공이면 새 토큰 쌍, 401 이면 사유 코드, 그 밖(연결 실패·타임아웃·5xx·형식 오류)은 network.
 * 200 인데 refresh_token 이 없으면 auth 실패(code null) — 서버는 회전 때 옛 리프레시를 이미 '사용됨'으로 바꿨으므로
 * 옛 것을 계속 쓰면 30초 뒤 재사용 감지로 세션이 통째로 끊긴다. 세션을 이어 가지 않고 로그인 종료로 처리한다.
 */
export type RefreshCallResult =
  | { ok: true; accessToken: string; refreshToken: string; user: unknown }
  | { ok: false; kind: 'auth'; code: string | null; body: unknown }
  | { ok: false; kind: 'network' };

/**
 * refreshAccessToken 결과.
 * - no-refresh: 리프레시 토큰이 없음(구 로그인·웹) — 기존처럼 처리
 * - auth: 서버가 갱신을 거부(REFRESH_INVALID·EXPIRED·REUSED·SESSION_REPLACED·SESSION_ENDED)하거나
 *   응답에 새 리프레시가 없음 — 세션 종료 대상
 * - network: 일시 오류 — 로그아웃하지 않는다
 * - stale: 갱신 도중 로그아웃·재로그인 — 결과를 버림
 */
export type RefreshOutcome =
  | { ok: true; accessToken: string }
  | { ok: false; kind: 'no-refresh' | 'network' | 'stale' }
  | { ok: false; kind: 'auth'; code: string | null; body: unknown };

type RefreshedHandler = (r: { accessToken: string; refreshToken: string; user: unknown }) => void;
let onRefreshed: RefreshedHandler | null = null;

/** 갱신 성공 시 상태·SecureStore 저장 콜백(auth store 가 등록) */
export function registerTokensRefreshed(handler: RefreshedHandler | null): void {
  onRefreshed = handler;
}

function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** JWT payload 의 exp(밀리초). 형식이 틀리면 null */
export function jwtExpiresAt(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(base64UrlDecode(part)) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** 접근 토큰이 만료됐거나 곧 만료되는가 — exp 를 읽을 수 없으면 만료로 본다 */
export function isAccessTokenStale(token: string, now: number = Date.now(), marginMs = STALE_MARGIN_MS): boolean {
  const exp = jwtExpiresAt(token);
  return exp === null || exp - now <= marginMs;
}

async function postJson(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${ENV.authApiUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** POST /auth/refresh 한 번(저장하지 않음). 로그아웃 직전 갱신처럼 상태에 쓰면 안 되는 곳도 이걸 쓴다 */
export async function callRefresh(refreshToken: string, timeoutMs = REFRESH_TIMEOUT_MS): Promise<RefreshCallResult> {
  try {
    const res = await postJson(REFRESH_PATH, { refresh_token: refreshToken }, timeoutMs);
    if (res.status === 401) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      return { ok: false, kind: 'auth', code: codeFromBody(body), body };
    }
    if (!res.ok) return { ok: false, kind: 'network' };
    const raw = (await res.json()) as { access_token?: unknown; refresh_token?: unknown; user?: unknown };
    if (typeof raw.access_token !== 'string' || raw.access_token === '') return { ok: false, kind: 'network' };
    if (typeof raw.refresh_token !== 'string' || raw.refresh_token === '') {
      return { ok: false, kind: 'auth', code: null, body: raw };
    }
    return { ok: true, accessToken: raw.access_token, refreshToken: raw.refresh_token, user: raw.user };
  } catch {
    return { ok: false, kind: 'network' };
  }
}

let inflight: Promise<RefreshOutcome> | null = null;

/**
 * 접근 토큰 갱신(single-flight). 성공하면 메모리 홀더 + store(콜백) 에 새 토큰·리프레시·사용자를 저장한다.
 * 갱신 도중 로그아웃·재로그인으로 리프레시가 바뀌었으면 결과를 버린다(stale — 로그아웃한 세션이 되살아나지 않게).
 */
export function refreshAccessToken(): Promise<RefreshOutcome> {
  if (inflight) return inflight;
  const refresh = getRefreshToken();
  if (!refresh) return Promise.resolve({ ok: false, kind: 'no-refresh' });
  const run = (async (): Promise<RefreshOutcome> => {
    const r = await callRefresh(refresh);
    if (getRefreshToken() !== refresh) return { ok: false, kind: 'stale' };
    if (!r.ok) return r.kind === 'auth' ? { ok: false, kind: 'auth', code: r.code, body: r.body } : { ok: false, kind: 'network' };
    const nextRefresh = r.refreshToken;
    setAuthToken(r.accessToken);
    setRefreshToken(nextRefresh);
    onRefreshed?.({ accessToken: r.accessToken, refreshToken: nextRefresh, user: r.user });
    return { ok: true, accessToken: r.accessToken };
  })();
  inflight = run;
  void run.finally(() => {
    if (inflight === run) inflight = null;
  });
  return run;
}

/**
 * rejectedToken 으로 보낸 요청이 401(만료) — 그사이 다른 요청이 이미 회전시켰으면 갱신 없이 현재 토큰을 쓰고,
 * 아니면 갱신한다(늦게 도착한 401 이 두 번째 갱신을 일으키지 않게).
 */
export function refreshAfter401(rejectedToken: string): Promise<RefreshOutcome> {
  const current = getAuthToken();
  if (current === null) return Promise.resolve({ ok: false, kind: 'stale' });
  if (current !== rejectedToken) return Promise.resolve({ ok: true, accessToken: current });
  return refreshAccessToken();
}

/**
 * 직접 fetch(푸시 등) 직전에 쓸 접근 토큰 — 만료 임박이면 먼저 갱신. 로그아웃 상태면 null.
 * 갱신이 실패하면 현재 토큰을 그대로 준다(로그아웃 판단은 하지 않음).
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const token = getAuthToken();
  if (!token) return null;
  if (!getRefreshToken() || !isAccessTokenStale(token)) return token;
  const r = await refreshAccessToken();
  return r.ok ? r.accessToken : getAuthToken();
}

/** 직접 fetch 오류가 "갱신해 볼 401" 인가 — {status:401, code?} 형태의 오류(푸시 api 가 던짐) */
export function isRefreshableAuthError(err: unknown): boolean {
  const e = err as { status?: unknown; body?: unknown } | null;
  return e?.status === 401 && isRefreshable401(e.body);
}

/**
 * 직접 fetch 호출을 유효한 토큰으로 실행 — 먼저 getFreshAccessToken, 401(만료)이면 한 번 갱신 후 재시도.
 * 로그아웃은 하지 않는다(실패는 그대로 throw). fallbackToken: 홀더가 비었을 때 쓸 토큰
 */
export async function withFreshAuth<T>(fallbackToken: string, fn: (token: string) => Promise<T>): Promise<T> {
  const token = (await getFreshAccessToken()) ?? fallbackToken;
  try {
    return await fn(token);
  } catch (err) {
    if (!isRefreshableAuthError(err) || !getRefreshToken()) throw err;
    const r = await refreshAfter401(token);
    if (!r.ok) throw err;
    return fn(r.accessToken);
  }
}

/** POST /auth/logout(best-effort) — 서버가 그 세션의 리프레시를 폐기. 실패는 무시 */
export async function serverLogout(refreshToken: string, timeoutMs = REFRESH_TIMEOUT_MS): Promise<void> {
  try {
    await postJson(LOGOUT_PATH, { refresh_token: refreshToken }, timeoutMs);
  } catch {
    // 네트워크 오류여도 로컬 로그아웃은 이미 끝났다
  }
}

/** 테스트 전용 — single-flight 상태 초기화 */
export function __resetTokenRefreshForTest(): void {
  inflight = null;
  onRefreshed = null;
}
