import { getQueryClient, makeQueryClient } from './query-client';

describe('query-client', () => {
  it('조회 기본값 — 재시도 0(http 재시도와 곱해지지 않게), 포커스·재연결 재조회 끔, 온라인 판정 안 씀', () => {
    const q = makeQueryClient().getDefaultOptions().queries!;
    expect(q.retry).toBe(0);
    expect(q.refetchOnWindowFocus).toBe(false);
    expect(q.refetchOnReconnect).toBe(false);
    expect(q.networkMode).toBe('always');
    expect(q.staleTime).toBe(30_000);
  });

  it('변경(mutation)은 재시도하지 않는다', () => {
    expect(makeQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('getQueryClient 는 앱 전체에서 같은 하나를 돌려준다', () => {
    expect(getQueryClient()).toBe(getQueryClient());
  });
});
