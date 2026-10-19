import { createHttpClient, REQUEST_TIMEOUT_MS } from './http';
import { RETRY_DELAYS_MS, isGraphqlQuery, isTransientError, withRetry } from './retry';

describe('조회 재시도(배포 순간 공백)', () => {
  const realFetch = global.fetch;
  const saved = [...RETRY_DELAYS_MS];
  beforeEach(() => RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, 1, 1, 1));
  afterEach(() => {
    global.fetch = realFetch;
    RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, ...saved);
    jest.useRealTimers();
  });

  const res = (status: number, body: unknown = {}) =>
    ({ ok: status < 400, status, statusText: '', json: async () => body, text: async () => '' }) as unknown as Response;

  it('GET 은 502·503 뒤 성공하면 결과를 돌려준다', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200, { ok: 1 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(createHttpClient('https://x.test').get('/a')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('연결 실패(TypeError)도 재시도, 계속 실패하면 3번 재시도 후 포기', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(createHttpClient('https://x.test').get('/a')).rejects.toThrow('Network request failed');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('POST(주문 등)는 502 여도 다시 보내지 않는다', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(502));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(createHttpClient('https://x.test').post('/orders', { qty: 1 })).rejects.toThrow('HTTP 502');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400·401·500 은 일시 장애가 아니라 재시도하지 않는다', async () => {
    for (const status of [400, 401, 500]) {
      const fetchMock = jest.fn().mockResolvedValue(res(status));
      global.fetch = fetchMock as unknown as typeof fetch;
      await expect(createHttpClient('https://x.test').get('/a')).rejects.toThrow(`HTTP ${status}`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('우리 타임아웃으로 끊은 GET 은 다시 보내지 않는다', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const p = createHttpClient('https://x.test').get('/slow');
    const settled = expect(p).rejects.toThrow('aborted');
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GraphQL 문서 판별 — query 만 재시도 대상', () => {
    expect(isGraphqlQuery('query Chart { a }')).toBe(true);
    expect(isGraphqlQuery('{ searchStocks(query: "삼성") { symbol } }')).toBe(true);
    expect(isGraphqlQuery('  # 주석\n  mutation Buy { b }')).toBe(false);
    expect(isGraphqlQuery('subscription S { c }')).toBe(false);
  });

  it('graphql-request 오류(response.status 502)도 일시 장애로 본다', async () => {
    expect(isTransientError({ response: { status: 502 } })).toBe(true);
    expect(isTransientError({ response: { status: 400 } })).toBe(false);
    let n = 0;
    await expect(withRetry(async () => {
      n += 1;
      if (n < 3) throw { response: { status: 504 } };
      return 'ok';
    })).resolves.toBe('ok');
    expect(n).toBe(3);
  });
});
