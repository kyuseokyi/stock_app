/**
 * REST 공용 HTTP 클라이언트(fetch 래퍼).
 * 서비스별 base URL로 인스턴스를 만들어 쓴다(blog/auth 등).
 * 로그인 상태면 Bearer를 자동 부착하고, 401 응답 시 저장된 인증 정보를 정리한다(web client/client.js와 동일 동작).
 */
import { getAuthToken, notifyUnauthorized } from './auth-token';
import { withRetry } from './retry';
import { reasonFromBody } from './session-end';

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

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { query?: Query },
): Promise<T> {
  const { query, ...rest } = init ?? {};
  const token = getAuthToken();
  // 호출부가 signal 을 주지 않았으면 기본 타임아웃(abort → fetch reject → 호출부의 기존 오류 처리)
  const ctrl = rest.signal ? null : new AbortController();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
  let res: Response;
  try {
    res = await fetch(buildUrl(baseUrl, path, query), {
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

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => undefined);
    }
    if (res.status === 401) {
      notifyUnauthorized(token, reasonFromBody(body));
    }
    throw new ApiError(res.status, `HTTP ${res.status} ${res.statusText}`, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function createHttpClient(baseUrl: string) {
  return {
    // 조회(GET)만 배포 순간 공백(연결 실패·502~504)에 짧게 재시도 — 쓰기(POST·PUT·DELETE)는 그대로(중복 실행 방지)
    get: <T>(path: string, query?: Query) => withRetry(() => request<T>(baseUrl, path, { method: 'GET', query })),
    post: <T>(path: string, body?: unknown) =>
      request<T>(baseUrl, path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) }),
    put: <T>(path: string, body?: unknown) =>
      request<T>(baseUrl, path, { method: 'PUT', body: body == null ? undefined : JSON.stringify(body) }),
    del: <T>(path: string, body?: unknown) =>
      request<T>(baseUrl, path, { method: 'DELETE', body: body == null ? undefined : JSON.stringify(body) }),
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
