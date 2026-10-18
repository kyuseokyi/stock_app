import fs from 'fs';
import path from 'path';

import { djb2 } from './hash';
import * as parseModule from './parse';
import {
  fetchReportHtml,
  PARSER_VERSION,
  readValidCache,
  refreshReport,
  type CacheEntry,
  type CachePort,
} from './refresh';
import { fundError, isFundError } from './types';

const HTML = fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'current.html'), 'utf8');
const FUND = { id: 'f1', url: 'https://fund.ivyro.net/dataroom/om_data/x.htm' };

function memoryCache(): CachePort & { store: Map<string, CacheEntry> } {
  const store = new Map<string, CacheEntry>();
  return {
    store,
    read: async (id) => store.get(id) ?? null,
    write: async (id, e) => {
      store.set(id, e);
    },
  };
}

describe('djb2', () => {
  it('알려진 값', () => {
    expect(djb2('')).toBe('1505');
    expect(djb2('a')).toBe('2b606');
  });
});

describe('refreshReport', () => {
  it('처음 가져오면 파싱해 저장하고 changed=true', async () => {
    const cache = memoryCache();
    const res = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 1000 });
    expect(res.changed).toBe(true);
    expect(res.entry).toMatchObject({ v: PARSER_VERSION, fetchedAt: 1000, hash: djb2(HTML), missing: [] });
    expect(res.entry.report.sections.length).toBeGreaterThan(0);
    expect(cache.store.get('f1')).toEqual(res.entry);
  });

  it('내용이 같으면 fetchedAt 만 갱신하고 changed=false', async () => {
    const cache = memoryCache();
    const first = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 1000 });
    const second = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 2000 });
    expect(second.changed).toBe(false);
    expect(second.entry).toEqual({ ...first.entry, fetchedAt: 2000 });
  });

  it('파서 버전이 다른 캐시는 무시한다', async () => {
    const cache = memoryCache();
    const first = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 1000 });
    cache.store.set('f1', { ...first.entry, v: PARSER_VERSION - 1 });
    expect(await readValidCache(cache, 'f1')).toBeNull();
    const res = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 2000 });
    expect(res.changed).toBe(true);
  });

  it('가져오기 실패는 그대로 던지고 캐시를 건드리지 않는다', async () => {
    const cache = memoryCache();
    await expect(
      refreshReport(FUND, { fetchHtml: async () => Promise.reject(fundError('fetch', 'x')), cache, now: () => 1 }),
    ).rejects.toMatchObject({ fundCode: 'fetch' });
    expect(cache.store.size).toBe(0);
  });

  it('형식이 깨지면 format 오류', async () => {
    const cache = memoryCache();
    await expect(
      refreshReport(FUND, { fetchHtml: async () => '<html></html>', cache, now: () => 1 }),
    ).rejects.toMatchObject({ fundCode: 'format' });
  });
});

describe('refreshReport 견고성', () => {
  afterEach(() => jest.restoreAllMocks());

  it('파서가 예상 못한 오류를 던져도 format 오류', async () => {
    jest.spyOn(parseModule, 'parseFundReport').mockImplementation(() => {
      throw new TypeError('x');
    });
    await expect(
      refreshReport(FUND, { fetchHtml: async () => HTML, cache: memoryCache(), now: () => 1 }),
    ).rejects.toMatchObject({ fundCode: 'format' });
  });

  it('캐시 저장이 실패해도 가져온 리포트를 돌려준다', async () => {
    const cache: CachePort = { read: async () => null, write: async () => Promise.reject(new Error('disk')) };
    const res = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 5 });
    expect(res.changed).toBe(true);
    expect(res.entry.fetchedAt).toBe(5);
  });

  it('내용이 같을 때 캐시 저장이 실패해도 돌려준다', async () => {
    const mem = memoryCache();
    const first = await refreshReport(FUND, { fetchHtml: async () => HTML, cache: mem, now: () => 1 });
    const cache: CachePort = { read: mem.read, write: async () => Promise.reject(new Error('disk')) };
    const res = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 9 });
    expect(res).toEqual({ changed: false, entry: { ...first.entry, fetchedAt: 9 } });
  });
});

describe('fetchReportHtml', () => {
  const res = (ok: boolean, status: number, body = '') =>
    ({ ok, status, text: async () => body }) as unknown as Response;

  it('200 이면 본문', async () => {
    await expect(fetchReportHtml(FUND.url, 1000, async () => res(true, 200, 'hi'))).resolves.toBe('hi');
  });

  it('200 이 아니면 fetch 오류', async () => {
    await expect(fetchReportHtml(FUND.url, 1000, async () => res(false, 500))).rejects.toMatchObject({
      fundCode: 'fetch',
    });
  });

  it('네트워크 오류·타임아웃도 fetch 오류', async () => {
    await expect(
      fetchReportHtml(FUND.url, 1000, async () => {
        throw new TypeError('Network request failed');
      }),
    ).rejects.toMatchObject({ fundCode: 'fetch' });
    const hang = (_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const err = await fetchReportHtml(FUND.url, 10, hang).catch((e: unknown) => e);
    expect(isFundError(err, 'fetch')).toBe(true);
  });
});
