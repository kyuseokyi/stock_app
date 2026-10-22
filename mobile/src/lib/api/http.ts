/**
 * REST 공용 HTTP 클라이언트(fetch 래퍼).
 * 서비스별 base URL로 인스턴스를 만들어 쓴다(blog/auth 등).
 * 로그인 상태면 Bearer를 자동 부착하고, 401(만료)이면 리프레시로 갱신 후 1회 재시도, 갱신 불가면 저장된 인증 정보를 정리한다.
 */
import { trackRequest } from './activity';
import { getAuthToken, getRefreshToken, notifyUnauthorized } from './auth-token';
import { withRetry } from './retry';
import { isRefreshable401, reasonFromBody } from './session-end';
import { refreshAfter401 } from './token-refresh';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * 요청 타임아웃. RN Android(OkHttp) fetch 는 기본 읽기 타임아웃이 없어(0=무제한) 네트워크 전환 직후
 * 걸린 연결이 끝나지 않으면 await 가 영원히 대기 → 당겨서 새로고침 스피너가 멈춘 채로 남았다.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${url}?${qs}` : url;
}

type RequestInitWithQuery = RequestInit & { query?: Query };

async function send(baseUrl: string, path: string, init: RequestInitWithQuery | undefined, token: string | null) {
  const { query, ...rest } = init ?? {};
  // 호출부가 signal 을 주지 않았으면 기본 타임아웃(abort → fetch reject → 호출부의 기존 오류 처리)
  const ctrl = rest.signal ? null : new AbortController();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    return await fetch(buildUrl(baseUrl, path, query), {
      ...rest,
      signal: rest.signal ?? ctrl?.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(rest.headers ?? {}),
      },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return await res.text().catch(() => undefined);
  }
}

function toApiError(res: Response, body: unknown): ApiError {
  return new ApiError(res.status, `HTTP ${res.status} ${res.statusText}`, body);
}

async function parseOk<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * 401 처리(설계 2026-10-22 모바일 리프레시 토큰 4절):
 * - 토큰을 실은 요청이 401 이고 사유가 TOKEN_EXPIRED(또는 사유 없음 — 구 서버)이며 리프레시가 있으면
 *   single-flight 갱신 → 원요청 1회 재시도(새 토큰). 401 은 서버가 실행하지 않은 요청이라 쓰기 요청도 재시도한다.
 * - 갱신 거부(401) → 세션 종료 안내(notifyUnauthorized), 네트워크 오류 → 로그아웃 없이 원래 ApiError.
 * - SESSION_REPLACED·TOKEN_INVALID·리프레시 없음 → 갱신 없이 기존 처리. 재시도 요청이 또 401 이면 더 갱신하지 않는다.
 */
async function request<T>(baseUrl: string, path: string, init?: RequestInitWithQuery): Promise<T> {
  const token = getAuthToken();
  const res = await send(baseUrl, path, init, token);
  if (res.ok) return parseOk<T>(res);

  const body = await readErrorBody(res);
  if (res.status !== 401) throw toApiError(res, body);
  if (!token || !getRefreshToken() || !isRefreshable401(body)) {
    notifyUnauthorized(token, reasonFromBody(body));
    throw toApiError(res, body);
  }

  const refreshed = await refreshAfter401(token);
  if (!refreshed.ok) {
    if (refreshed.kind === 'auth') notifyUnauthorized(token, reasonFromBody(refreshed.body));
    else if (refreshed.kind === 'no-refresh') notifyUnauthorized(token, reasonFromBody(body));
    // network: 로그아웃하지 않음 / stale: 그사이 로그아웃·재로그인 — 아무것도 하지 않음
    throw toApiError(res, body);
  }

  const retry = await send(baseUrl, path, init, refreshed.accessToken);
  if (retry.ok) return parseOk<T>(retry);
  const retryBody = await readErrorBody(retry);
  if (retry.status === 401) notifyUnauthorized(refreshed.accessToken, reasonFromBody(retryBody));
  throw toApiError(retry, retryBody);
}

export function createHttpClient(baseUrl: string) {
  return {
    // 조회(GET)만 배포 순간 공백(연결 실패·502~504)에 짧게 재시도 — 쓰기(POST·PUT·DELETE)는 그대로(중복 실행 방지)
    // trackRequest: 화면 상단 진행 표시줄(재시도 대기 포함 한 번으로 센다)
    get: <T>(path: string, query?: Query) =>
      trackRequest(() => withRetry(() => request<T>(baseUrl, path, { method: 'GET', query }))),
    post: <T>(path: string, body?: unknown) =>
      trackRequest(() =>
        request<T>(baseUrl, path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) }),
      ),
    put: <T>(path: string, body?: unknown) =>
      trackRequest(() =>
        request<T>(baseUrl, path, { method: 'PUT', body: body == null ? undefined : JSON.stringify(body) }),
      ),
    del: <T>(path: string, body?: unknown) =>
      trackRequest(() =>
        request<T>(baseUrl, path, { method: 'DELETE', body: body == null ? undefined : JSON.stringify(body) }),
      ),
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
