import fs from 'fs';
import path from 'path';

import type { FundEntry } from './funds';
import { PARSER_VERSION, type CacheEntry, type CachePort } from './refresh';
import {
  AUTO_REFRESH_MIN_AGE_MS,
  createAutoRefresher,
  refreshAll,
  type AutoRefreshStatus,
  type RefreshOutcome,
} from './refresh-all';
import { fundError, type FundReport } from './types';

const HTML = fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'current.html'), 'utf8');
const NOW = 1_800_000_000_000;
const EMPTY: FundReport = { title: '', investorNo: '', investorName: '', notice: null, sections: [] };

const fund = (id: string): FundEntry => ({ id, name: id, url: `https://fund.ivyro.net/dataroom/om_data/${id}.htm` });

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

const seed = (cache: ReturnType<typeof memoryCache>, id: string, fetchedAt: number) =>
  cache.store.set(id, { v: PARSER_VERSION, fetchedAt, hash: 'old', report: EMPTY, missing: [] });

describe('refreshAll', () => {
  it('최근(10분 이내) 확인한 펀드는 건너뛰고 나머지는 가져온다', async () => {
    const cache = memoryCache();
    seed(cache, 'a', NOW - 60_000); // 1분 전 → 건너뜀
    seed(cache, 'b', NOW - AUTO_REFRESH_MIN_AGE_MS - 1); // 10분 넘음 → 가져옴
    const urls: string[] = [];
    const r = await refreshAll([fund('a'), fund('b'), fund('c')], {
      fetchHtml: async (u) => {
        urls.push(u);
        return HTML;
      },
      cache,
      now: () => NOW,
    });
    expect(r).toEqual({ refreshed: 2, skipped: 1, failed: 0 });
    expect(urls).toEqual([fund('b').url, fund('c').url]);
    expect(cache.store.get('b')?.fetchedAt).toBe(NOW);
  });

  it('force 면 최근 확인한 펀드도 가져온다', async () => {
    const cache = memoryCache();
    seed(cache, 'a', NOW - 1000);
    const r = await refreshAll([fund('a')], { fetchHtml: async () => HTML, cache, now: () => NOW, force: true });
    expect(r).toEqual({ refreshed: 1, skipped: 0, failed: 0 });
  });

  it('동시에 concurrency(기본 2)개까지만 가져온다', async () => {
    let inflight = 0;
    let max = 0;
    const fetchHtml = async () => {
      inflight++;
      max = Math.max(max, inflight);
      await new Promise((res) => setTimeout(res, 5));
      inflight--;
      return HTML;
    };
    const funds = ['a', 'b', 'c', 'd', 'e'].map(fund);
    const r = await refreshAll(funds, { fetchHtml, cache: memoryCache(), now: () => NOW });
    expect(r.refreshed).toBe(5);
    expect(max).toBe(2);
  });

  it('한 펀드가 실패해도 나머지는 가져오고, 결과를 펀드마다 알려 준다', async () => {
    const results: [string, RefreshOutcome][] = [];
    const r = await refreshAll([fund('a'), fund('b'), fund('c')], {
      fetchHtml: async (u) => {
        if (u === fund('b').url) throw fundError('fetch', '실패');
        return HTML;
      },
      cache: memoryCache(),
      now: () => NOW,
      onResult: (f, out) => results.push([f.id, out]),
    });
    expect(r).toEqual({ refreshed: 2, skipped: 0, failed: 1 });
    const byId = Object.fromEntries(results);
    expect('entry' in byId.a).toBe(true);
    expect(byId.b).toEqual({ error: 'fetch' });
    expect('entry' in byId.c).toBe(true);
  });

  it('onResult 가 던져도 집계와 나머지 펀드에 영향이 없다', async () => {
    const r = await refreshAll([fund('a'), fund('b')], {
      fetchHtml: async () => HTML,
      cache: memoryCache(),
      now: () => NOW,
      onResult: () => {
        throw new Error('boom');
      },
    });
    expect(r).toEqual({ refreshed: 2, skipped: 0, failed: 0 });
  });

  it('펀드가 없으면 아무것도 하지 않는다', async () => {
    const r = await refreshAll([], { fetchHtml: async () => HTML, cache: memoryCache(), now: () => NOW });
    expect(r).toEqual({ refreshed: 0, skipped: 0, failed: 0 });
  });
});

const flush = () => new Promise((res) => setTimeout(res, 0));

describe('createAutoRefresher', () => {
  const setup = (opts: { delayMs?: number; funds?: () => Promise<FundEntry[]> } = {}) => {
    const fetched: string[] = [];
    const refreshedCalls: string[] = [];
    const r = createAutoRefresher({
      loadFunds: opts.funds ?? (async () => [fund('a')]),
      deps: {
        fetchHtml: async (u) => {
          fetched.push(u);
          if (opts.delayMs) await new Promise((res) => setTimeout(res, opts.delayMs));
          return HTML;
        },
        cache: memoryCache(),
        now: () => NOW,
      },
      onRefreshed: (f) => {
        refreshedCalls.push(f.id);
      },
    });
    return { r, fetched, refreshedCalls };
  };

  it('진행 중에 다시 부르면 같은 실행을 돌려준다(single-flight)', async () => {
    const { r, fetched } = setup({ delayMs: 5 });
    const p1 = r.run();
    const p2 = r.run();
    expect(p2).toBe(p1);
    await p1;
    expect(fetched).toHaveLength(1);
  });

  it('진행 중 force 요청은 끝난 뒤 force 로 한 번 더 실행한다', async () => {
    const { r, fetched } = setup({ delayMs: 5 });
    const p = r.run();
    void r.run({ force: true });
    await p;
    expect(fetched).toHaveLength(2); // 두 번째는 방금 확인했어도 force 라 다시 가져옴
  });

  it('진행 중 일반 요청은 추가 실행을 만들지 않는다', async () => {
    const { r, fetched } = setup({ delayMs: 5 });
    const p = r.run();
    void r.run();
    await p;
    await r.run(); // 방금 확인 → 10분 이내라 건너뜀
    expect(fetched).toHaveLength(1);
  });

  it('상태: 실행 중 running, 끝나면 version 증가 + 갱신된 펀드 id', async () => {
    const { r, refreshedCalls } = setup();
    const seen: AutoRefreshStatus[] = [];
    const off = r.subscribe(() => seen.push(r.getStatus()));
    expect(r.getStatus()).toEqual({ running: false, version: 0, refreshedIds: [] });
    await r.run();
    await flush();
    expect(seen[0].running).toBe(true);
    expect(r.getStatus()).toEqual({ running: false, version: 1, refreshedIds: ['a'] });
    expect(refreshedCalls).toEqual(['a']);
    off();
    await r.run({ force: true });
    expect(seen).toHaveLength(2); // 구독 해제 후에는 알림 없음
  });

  it('getStatus 는 바뀌기 전까지 같은 객체를 돌려준다(useSyncExternalStore 요건)', () => {
    const { r } = setup();
    expect(r.getStatus()).toBe(r.getStatus());
  });

  it('목록 읽기가 실패해도 실행이 끝나고 상태가 돌아온다', async () => {
    const { r } = setup({
      funds: async () => {
        throw new Error('read');
      },
    });
    await r.run();
    expect(r.getStatus()).toEqual({ running: false, version: 1, refreshedIds: [] });
  });
});
