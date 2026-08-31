/**
 * REST 공용 HTTP 클라이언트(fetch 래퍼).
 * 서비스별 base URL로 인스턴스를 만들어 쓴다(blog/auth 등).
 */

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
  const res = await fetch(buildUrl(baseUrl, path, query), {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
  });

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => undefined);
    }
    throw new ApiError(res.status, `HTTP ${res.status} ${res.statusText}`, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function createHttpClient(baseUrl: string) {
  return {
    get: <T>(path: string, query?: Query) => request<T>(baseUrl, path, { method: 'GET', query }),
    post: <T>(path: string, body?: unknown) =>
      request<T>(baseUrl, path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) }),
    put: <T>(path: string, body?: unknown) =>
      request<T>(baseUrl, path, { method: 'PUT', body: body == null ? undefined : JSON.stringify(body) }),
    del: <T>(path: string) => request<T>(baseUrl, path, { method: 'DELETE' }),
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
