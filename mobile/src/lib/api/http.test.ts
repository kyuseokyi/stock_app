import { createHttpClient, REQUEST_TIMEOUT_MS } from './http';

describe('http 클라이언트 타임아웃', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('응답이 없으면 REQUEST_TIMEOUT_MS 뒤 실패(당겨서 새로고침이 끝나지 않던 문제)', async () => {
    jest.useFakeTimers();
    // 연결이 걸려 응답이 안 오는 fetch — abort 신호가 오면 그때 reject
    global.fetch = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const p = createHttpClient('https://x.test').get('/slow');
    const settled = expect(p).rejects.toThrow();
    jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    await settled;
  });

  it('정상 응답은 그대로 반환', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ a: 1 }) })) as unknown as typeof fetch;
    await expect(createHttpClient('https://x.test').get('/ok')).resolves.toEqual({ a: 1 });
  });
});
