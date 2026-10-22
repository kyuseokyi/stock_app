import {
  getAuthToken,
  getRefreshToken,
  registerUnauthorizedHandler,
  setAuthToken,
  setRefreshToken,
} from './auth-token';
import { createHttpClient } from './http';
import {
  __resetTokenRefreshForTest,
  getFreshAccessToken,
  isAccessTokenStale,
  jwtExpiresAt,
  refreshAccessToken,
  registerTokensRefreshed,
  withFreshAuth,
} from './token-refresh';

// 테스트용 JWT(서명 검증 안 함) — exp(초)만 의미 있음
function jwt(expSec: number, tag = 'x'): string {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256' })}.${enc({ sub: '1', exp: expSec, tag })}.sig`;
}

type Res = { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> };
const res = (status: number, body?: unknown): Res => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
  text: async () => '',
});

const expired401 = () => res(401, { detail: { code: 'TOKEN_EXPIRED', message: '만료' } });
const isRefresh = (url: string) => url.endsWith('/api/v1/auth/refresh');
const bearer = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;

const realFetch = global.fetch;
let unauthorized: { token: string | null; reason: string }[];
let refreshed: { accessToken: string; refreshToken: string; user: unknown }[];

beforeEach(() => {
  __resetTokenRefreshForTest();
  setAuthToken('A1');
  setRefreshToken('R1');
  unauthorized = [];
  refreshed = [];
  registerUnauthorizedHandler((token, reason) => unauthorized.push({ token, reason }));
  registerTokensRefreshed((r) => refreshed.push(r));
});

afterEach(() => {
  global.fetch = realFetch;
  registerUnauthorizedHandler(null);
});

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Res> | Res): jest.Mock {
  const fn = jest.fn(async (url: unknown, init?: RequestInit) => handler(String(url), init));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const refreshOk = (access = 'A2', refresh = 'R2') =>
  res(200, { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, user: { id: 1, role: 'user' } });

describe('http 401 → 토큰 갱신 → 재시도', () => {
  it('single-flight: 동시 401 3개 → 갱신 1회, 원요청 3개 모두 새 토큰으로 재시도', async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((r) => (releaseRefresh = r));
    const fetchMock = mockFetch(async (url, init) => {
      if (isRefresh(url)) {
        await refreshGate;
        return refreshOk();
      }
      return bearer(init) === 'Bearer A2' ? res(200, { url }) : expired401();
    });
    const api = createHttpClient('https://x.test');
    const ps = [api.get('/a'), api.post('/b', { x: 1 }), api.del('/c')];
    // 세 요청의 401 이 모두 도착해 갱신 대기에 합류할 때까지
    for (let i = 0; i < 20; i++) await Promise.resolve();
    releaseRefresh();
    const out = await Promise.all(ps);

    expect(out.map((o) => (o as { url: string }).url)).toEqual(['https://x.test/a', 'https://x.test/b', 'https://x.test/c']);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter(isRefresh)).toHaveLength(1);
    expect(urls.filter((u) => !isRefresh(u))).toHaveLength(6);
    expect(getAuthToken()).toBe('A2');
    expect(getRefreshToken()).toBe('R2');
    expect(refreshed).toHaveLength(1);
    expect(unauthorized).toEqual([]);
  });

  it('이미 다른 요청이 회전시킨 뒤 옛 토큰으로 늦게 온 401 → 갱신 없이 현재 토큰으로 재시도', async () => {
    setAuthToken('A2'); // 이 토큰으로 보낸 요청의 응답을 기다리는 동안 다른 요청이 A9 로 회전시킨 상황
    let first = true;
    const fetchMock = mockFetch(async (url, init) => {
      if (isRefresh(url)) return refreshOk('A3', 'R3');
      if (first) {
        first = false;
        setAuthToken('A9'); // 응답 대기 중 다른 갱신이 끝남
        return expired401();
      }
      return bearer(init) === 'Bearer A9' ? res(200, { ok: 1 }) : expired401();
    });
    await expect(createHttpClient('https://x.test').get('/a')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter(isRefresh)).toHaveLength(0);
  });

  it('갱신 거부(401) → expireSession(notifyUnauthorized) 1회, 동시 요청 여러 개여도', async () => {
    mockFetch(async (url) =>
      isRefresh(url) ? res(401, { detail: { code: 'REFRESH_EXPIRED', message: '만료' } }) : expired401(),
    );
    const api = createHttpClient('https://x.test');
    const results = await Promise.allSettled([api.post('/a'), api.post('/b')]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    // 두 요청 모두 같은 토큰(A1)을 알리지만 store.expireSession 은 현재 토큰일 때만 1회 로그아웃 — 여기선 호출 인자 확인
    expect(unauthorized.every((u) => u.token === 'A1' && u.reason === 'expired')).toBe(true);
    expect(unauthorized.length).toBeGreaterThanOrEqual(1);
  });

  it('갱신 거부 사유 SESSION_REPLACED → replaced 안내', async () => {
    mockFetch(async (url) =>
      isRefresh(url) ? res(401, { detail: { code: 'SESSION_REPLACED', message: '교체' } }) : expired401(),
    );
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toEqual([{ token: 'A1', reason: 'replaced' }]);
  });

  it('갱신 거부 사유 REFRESH_REUSED → reused(보안 로그아웃) 안내', async () => {
    mockFetch(async (url) =>
      isRefresh(url) ? res(401, { detail: { code: 'REFRESH_REUSED', message: '재사용' } }) : expired401(),
    );
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toEqual([{ token: 'A1', reason: 'reused' }]);
  });

  it('SESSION_ENDED 401 → 갱신하지 않고 ended(로그아웃됨) 안내', async () => {
    const fetchMock = mockFetch(async () => res(401, { detail: { code: 'SESSION_ENDED', message: '로그아웃' } }));
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter(isRefresh)).toHaveLength(0);
    expect(unauthorized).toEqual([{ token: 'A1', reason: 'ended' }]);
  });

  it('갱신 거부 사유 SESSION_ENDED → ended 안내', async () => {
    mockFetch(async (url) =>
      isRefresh(url) ? res(401, { detail: { code: 'SESSION_ENDED', message: '로그아웃' } }) : expired401(),
    );
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toEqual([{ token: 'A1', reason: 'ended' }]);
  });

  it('갱신 응답에 refresh_token 이 없으면 옛 리프레시를 유지하지 않고 만료 처리', async () => {
    mockFetch(async (url) =>
      isRefresh(url)
        ? res(200, { access_token: 'A2', token_type: 'bearer', expires_in: 3600, user: { id: 1 } })
        : expired401(),
    );
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toEqual([{ token: 'A1', reason: 'expired' }]);
    expect(getAuthToken()).toBe('A1'); // 새 접근 토큰도 저장하지 않음
    expect(getRefreshToken()).toBe('R1');
    expect(refreshed).toEqual([]);
  });

  it('갱신 네트워크 오류 → 로그아웃 안 함, 원래 401 ApiError', async () => {
    mockFetch(async (url) => {
      if (isRefresh(url)) throw new TypeError('Network request failed');
      return expired401();
    });
    await expect(createHttpClient('https://x.test').post('/a')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toEqual([]);
    expect(getAuthToken()).toBe('A1');
    expect(getRefreshToken()).toBe('R1');
  });

  it('갱신 5xx 도 네트워크 오류로 취급 — 로그아웃 안 함', async () => {
    mockFetch(async (url) => (isRefresh(url) ? res(503) : expired401()));
    await expect(createHttpClient('https://x.test').post('/a')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toEqual([]);
  });

  it('SESSION_REPLACED 401 → 갱신하지 않고 바로 replaced 로그아웃', async () => {
    const fetchMock = mockFetch(async () => res(401, { detail: { code: 'SESSION_REPLACED', message: '교체' } }));
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter(isRefresh)).toHaveLength(0);
    expect(unauthorized).toEqual([{ token: 'A1', reason: 'replaced' }]);
  });

  it('TOKEN_INVALID 401 → 갱신하지 않음', async () => {
    const fetchMock = mockFetch(async () => res(401, { detail: { code: 'TOKEN_INVALID', message: '무효' } }));
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter(isRefresh)).toHaveLength(0);
    expect(unauthorized).toEqual([{ token: 'A1', reason: 'expired' }]);
  });

  it('사유 없는 401(구 서버)도 리프레시가 있으면 갱신 시도', async () => {
    const fetchMock = mockFetch(async (url, init) => {
      if (isRefresh(url)) return refreshOk();
      return bearer(init) === 'Bearer A2' ? res(200, { ok: 1 }) : res(401, { detail: '유효하지 않은 토큰입니다.' });
    });
    await expect(createHttpClient('https://x.test').get('/a')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls.map((c) => String(c[0])).filter(isRefresh)).toHaveLength(1);
  });

  it('리프레시가 없으면(구 로그인) 기존처럼 바로 만료 처리', async () => {
    setRefreshToken(null);
    const fetchMock = mockFetch(async () => expired401());
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unauthorized).toEqual([{ token: 'A1', reason: 'expired' }]);
  });

  it('재시도 요청이 또 401 이어도 다시 갱신하지 않음(루프 없음) — 새 토큰으로 만료 알림', async () => {
    const fetchMock = mockFetch(async (url) => (isRefresh(url) ? refreshOk() : expired401()));
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toMatchObject({ status: 401 });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter(isRefresh)).toHaveLength(1);
    expect(urls).toHaveLength(3); // 원요청 + 갱신 + 재시도
    expect(unauthorized).toEqual([{ token: 'A2', reason: 'expired' }]);
  });

  it('토큰 없는 요청의 401(로그인 실패 등)은 갱신하지 않음', async () => {
    setAuthToken(null);
    const fetchMock = mockFetch(async () => res(401, { detail: '잘못된 코드' }));
    await expect(createHttpClient('https://x.test').post('/login')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('refreshAccessToken', () => {
  it('갱신 요청 자체의 401 은 http 401 처리를 타지 않음(1번 호출, 알림 없음)', async () => {
    const fetchMock = mockFetch(async () => res(401, { detail: { code: 'REFRESH_INVALID', message: 'x' } }));
    await expect(refreshAccessToken()).resolves.toMatchObject({ ok: false, kind: 'auth', code: 'REFRESH_INVALID' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unauthorized).toEqual([]); // 판단은 호출자 몫
  });

  it('200 이지만 refresh_token 누락·빈 값 → auth 실패(code null)', async () => {
    for (const refresh_token of [undefined, '']) {
      __resetTokenRefreshForTest();
      mockFetch(async () => res(200, { access_token: 'A2', refresh_token, user: { id: 1 } }));
      await expect(refreshAccessToken()).resolves.toMatchObject({ ok: false, kind: 'auth', code: null });
    }
    expect(getRefreshToken()).toBe('R1');
  });

  it('리프레시 없으면 즉시 no-refresh(요청 없음)', async () => {
    setRefreshToken(null);
    const fetchMock = mockFetch(async () => refreshOk());
    await expect(refreshAccessToken()).resolves.toEqual({ ok: false, kind: 'no-refresh' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('갱신 중 로그아웃(리프레시 변경) → 결과를 버림(stale), 저장하지 않음', async () => {
    mockFetch(async () => {
      setAuthToken(null);
      setRefreshToken(null);
      return refreshOk();
    });
    await expect(refreshAccessToken()).resolves.toEqual({ ok: false, kind: 'stale' });
    expect(getAuthToken()).toBeNull();
    expect(refreshed).toEqual([]);
  });

  it('요청 본문은 {refresh_token}', async () => {
    const fetchMock = mockFetch(async () => refreshOk());
    await refreshAccessToken();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: 'R1' });
    expect(bearer(init)).toBeNull();
  });
});

describe('JWT 만료 판정·getFreshAccessToken', () => {
  const now = 1_800_000_000_000;
  it('exp 읽기', () => {
    expect(jwtExpiresAt(jwt(1000))).toBe(1_000_000);
    expect(jwtExpiresAt('not-a-jwt')).toBeNull();
  });
  it('만료 임박(60초 이내)·형식 오류는 stale', () => {
    expect(isAccessTokenStale(jwt(now / 1000 + 3600), now)).toBe(false);
    expect(isAccessTokenStale(jwt(now / 1000 + 30), now)).toBe(true);
    expect(isAccessTokenStale('garbage', now)).toBe(true);
  });
  it('유효한 토큰이면 갱신 없이 그대로', async () => {
    const t = jwt(Date.now() / 1000 + 3600);
    setAuthToken(t);
    const fetchMock = mockFetch(async () => refreshOk());
    await expect(getFreshAccessToken()).resolves.toBe(t);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('만료 임박이면 갱신 후 새 토큰', async () => {
    setAuthToken(jwt(Date.now() / 1000 - 10));
    mockFetch(async () => refreshOk('A2', 'R2'));
    await expect(getFreshAccessToken()).resolves.toBe('A2');
  });
  it('로그아웃 상태면 null', async () => {
    setAuthToken(null);
    await expect(getFreshAccessToken()).resolves.toBeNull();
  });
});

describe('withFreshAuth(푸시 직접 fetch)', () => {
  beforeEach(() => setAuthToken(jwt(Date.now() / 1000 + 3600, 'a1')));

  it('401(만료) → 한 번 갱신 후 재시도', async () => {
    mockFetch(async () => refreshOk('A2', 'R2'));
    const seen: string[] = [];
    const out = await withFreshAuth('fallback', async (t) => {
      seen.push(t);
      if (t !== 'A2') throw Object.assign(new Error('401'), { status: 401, body: { detail: { code: 'TOKEN_EXPIRED' } } });
      return 'done';
    });
    expect(out).toBe('done');
    expect(seen).toHaveLength(2);
    expect(unauthorized).toEqual([]);
  });

  it('401 이 아닌 오류·SESSION_REPLACED 는 그대로 throw(갱신 없음)', async () => {
    const fetchMock = mockFetch(async () => refreshOk());
    await expect(
      withFreshAuth('f', async () => {
        throw Object.assign(new Error('401'), { status: 401, body: { detail: { code: 'SESSION_REPLACED' } } });
      }),
    ).rejects.toThrow('401');
    await expect(
      withFreshAuth('f', async () => {
        throw Object.assign(new Error('500'), { status: 500 });
      }),
    ).rejects.toThrow('500');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
