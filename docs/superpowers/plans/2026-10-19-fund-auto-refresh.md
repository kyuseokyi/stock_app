# 펀드 리포트 자동 갱신 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 실행·앱 복귀·웹 접속 때 기기에 등록한 펀드 원본을 모두 다시 가져와 캐시(앱은 히스토리도)를 갱신하고, 목록에 기준일·확인 시각을 보여 준다.

**Architecture:** 공용 core(`mobile/src/features/fund/core`, 웹은 복사본 `web_client/src/lib/fundCore`)에 순수 함수 `refreshAll`(건너뛰기·동시 2개·실패 격리)과 `createAutoRefresher`(single-flight·force 재실행·상태 구독)를 둔다. 앱·웹은 이 refresher 하나를 만들어 실행 시점(AppState / visibilitychange)에 `run()` 하고, 화면은 `useAutoRefreshStatus` 로 상태를 구독한다. 앱의 히스토리 기록 규칙은 `record.ts` 로 모아 리포트 화면과 자동 갱신이 함께 쓴다. 서버 변경 없음.

**Tech Stack:** TypeScript, React 19(useSyncExternalStore), Expo Router·React Native AppState, Vite React(web), jest(jest-expo, mobile 에만 존재).

**Spec:** `docs/superpowers/specs/2026-10-19-fund-auto-refresh-design.md`

## 규칙(모든 태스크 공통)
- core 파일은 **상대 import 만**(웹에 그대로 복사됨). core 를 고친 태스크는 끝에 `scripts/check-fund-core-sync.sh --write` 후 `scripts/check-fund-core-sync.sh`(출력 없음·exit 0).
- core 는 세미콜론 스타일(mobile prettier), web_client 파일은 세미콜론 없음 스타일 — 주변 코드에 맞춘다.
- 커밋은 해당 태스크 파일만 `git add <파일>` (다른 세션이 같은 dev 브랜치에서 작업 중. `.serena/project.yml` 은 절대 스테이징 금지). 커밋 메시지 끝에:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T814x7jTTuEcJBrCqKt8Pf
  ```
- 실제 개인 데이터(URL·금액·이름) 금지 — 테스트는 `__fixtures__/current.html`(가린 픽스처)와 가짜 URL 만.

## File Structure
| 파일 | 작업 | 책임 |
|---|---|---|
| `mobile/src/features/fund/core/refresh-all.ts` | 생성 | `refreshAll`, `createAutoRefresher`, 타입 |
| `mobile/src/features/fund/core/refresh-all.test.ts` | 생성 | 위 테스트 |
| `mobile/src/features/fund/core/use-auto-refresh.ts` | 생성 | `useAutoRefreshStatus` 훅 |
| `mobile/src/features/fund/core/display.ts` | 수정 | `fundStatusLine` 추가 |
| `mobile/src/features/fund/core/display.test.ts` | 수정 | `fundStatusLine` 테스트 |
| `mobile/src/features/fund/core/use-fund-report.ts` | 수정 | `reload()` 추가 |
| `mobile/src/features/fund/core/index.ts` | 수정 | export 추가 |
| `web_client/src/lib/fundCore/*` | 동기화 | 스크립트로 복사 |
| `mobile/src/features/fund/record.ts` | 생성 | 히스토리 기록 규칙(중복 방지 + 자동 백업) |
| `mobile/src/features/fund/record.test.ts` | 생성 | 위 테스트 |
| `mobile/src/features/fund/auto-refresh.ts` | 생성 | 앱 refresher + `useFundAutoRefresh` |
| `mobile/src/app/_layout.tsx` | 수정 | 훅 호출 1줄 |
| `mobile/src/app/fund/[id].tsx` | 수정 | `recordFetched` 사용 + 갱신 시 `reload()` |
| `mobile/src/app/fund/index.tsx` | 수정 | 목록 한 줄 + 헤더 로딩 표시 |
| `web_client/src/lib/fundAutoRefresh.ts` | 생성 | 웹 refresher + `useFundAutoRefresh` |
| `web_client/src/components/Layout.tsx` | 수정 | 훅 호출 1줄 |
| `web_client/src/pages/FundListPage.tsx` | 수정 | 목록 한 줄 + 확인 중 표시 |
| `web_client/src/pages/FundReportPage.tsx` | 수정 | 갱신 시 `reload()` |
| `README.md` | 수정 | 자동 갱신 한 단락 |

---

### Task 1: core `refreshAll`

**Files:**
- Create: `mobile/src/features/fund/core/refresh-all.ts`
- Test: `mobile/src/features/fund/core/refresh-all.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `mobile/src/features/fund/core/refresh-all.test.ts`

```ts
import fs from 'fs';
import path from 'path';

import type { FundEntry } from './funds';
import { PARSER_VERSION, type CacheEntry, type CachePort } from './refresh';
import { AUTO_REFRESH_MIN_AGE_MS, refreshAll, type RefreshOutcome } from './refresh-all';
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/refresh-all.test.ts`
Expected: FAIL — `Cannot find module './refresh-all'`

- [ ] **Step 3: 구현** — `mobile/src/features/fund/core/refresh-all.ts`

```ts
// 등록한 펀드 전체 다시 가져오기 — 앱 실행·복귀, 웹 접속 때(자동 갱신). 플랫폼 무관.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import type { FundEntry } from './funds';
import { readValidCache, refreshReport, type CacheEntry, type RefreshDeps } from './refresh';
import { isFundError, type FundErrorCode } from './types';

/** 마지막 확인이 이보다 최근이면 건너뜀 — 앱을 자주 오가도 원본 서버를 반복해서 두드리지 않도록 */
export const AUTO_REFRESH_MIN_AGE_MS = 10 * 60_000;

export type RefreshOutcome = { entry: CacheEntry } | { error: FundErrorCode };

export type RefreshAllDeps = RefreshDeps & {
  minAgeMs?: number;
  concurrency?: number; // 기본 2
  force?: boolean; // true 면 minAgeMs 무시
  onResult?: (fund: FundEntry, r: RefreshOutcome) => void;
};

export type RefreshAllResult = { refreshed: number; skipped: number; failed: number };

export async function refreshAll(funds: FundEntry[], deps: RefreshAllDeps): Promise<RefreshAllResult> {
  const minAge = deps.minAgeMs ?? AUTO_REFRESH_MIN_AGE_MS;
  const result: RefreshAllResult = { refreshed: 0, skipped: 0, failed: 0 };
  const report = (fund: FundEntry, r: RefreshOutcome) => {
    try {
      deps.onResult?.(fund, r);
    } catch {
      // 알림 받는 쪽 오류는 갱신에 영향 없음
    }
  };

  const one = async (fund: FundEntry) => {
    if (!deps.force) {
      const c = await readValidCache(deps.cache, fund.id).catch(() => null);
      if (c && c.fetchedAt >= deps.now() - minAge) {
        result.skipped++;
        return;
      }
    }
    try {
      const { entry } = await refreshReport(fund, deps);
      result.refreshed++;
      report(fund, { entry });
    } catch (e) {
      result.failed++;
      report(fund, { error: isFundError(e) ? e.fundCode : 'fetch' });
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < funds.length) await one(funds[next++]);
  };
  const n = Math.min(Math.max(1, deps.concurrency ?? 2), funds.length);
  await Promise.all(Array.from({ length: n }, worker));
  return result;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && npx jest src/features/fund/core/refresh-all.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add mobile/src/features/fund/core/refresh-all.ts mobile/src/features/fund/core/refresh-all.test.ts
git commit -m "feat(fund): core refreshAll — 등록 펀드 일괄 갱신(10분 이내 건너뜀·동시 2개·실패 격리)"
```
(웹 동기화는 Task 3 에서 한 번에)

---

### Task 2: core `createAutoRefresher` + `useAutoRefreshStatus`

**Files:**
- Modify: `mobile/src/features/fund/core/refresh-all.ts` (아래 코드 추가)
- Create: `mobile/src/features/fund/core/use-auto-refresh.ts`
- Test: `mobile/src/features/fund/core/refresh-all.test.ts` (describe 추가)

- [ ] **Step 1: 실패하는 테스트 추가** — `refresh-all.test.ts` 맨 아래에 붙이고, 상단 import 를 `import { AUTO_REFRESH_MIN_AGE_MS, createAutoRefresher, refreshAll, type AutoRefreshStatus, type RefreshOutcome } from './refresh-all';` 로 바꾼다.

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/refresh-all.test.ts`
Expected: FAIL — `createAutoRefresher is not a function` (TS 오류 포함)

- [ ] **Step 3: 구현** — `refresh-all.ts` 맨 아래에 추가

```ts
export type AutoRefreshStatus = { running: boolean; version: number; refreshedIds: readonly string[] };

export type AutoRefresher = {
  /** 진행 중이면 같은 Promise. 진행 중 force 요청은 끝난 뒤 force 로 한 번 더(신호 유실 방지). */
  run(opts?: { force?: boolean }): Promise<void>;
  subscribe(listener: () => void): () => void;
  /** 바뀌기 전까지 같은 객체 — useSyncExternalStore 의 getSnapshot 으로 쓴다 */
  getStatus(): AutoRefreshStatus;
};

export function createAutoRefresher(cfg: {
  loadFunds: () => Promise<FundEntry[]>;
  deps: Omit<RefreshAllDeps, 'force' | 'onResult'>;
  /** 새로 가져온 펀드마다(앱: 히스토리 기록). 오류는 무시 */
  onRefreshed?: (fund: FundEntry, entry: CacheEntry) => unknown;
}): AutoRefresher {
  let status: AutoRefreshStatus = { running: false, version: 0, refreshedIds: [] };
  const listeners = new Set<() => void>();
  let current: Promise<void> | null = null;
  let pendingForce = false;

  const setStatus = (s: AutoRefreshStatus) => {
    status = s;
    listeners.forEach((l) => l());
  };

  const once = async (force: boolean) => {
    const ids: string[] = [];
    setStatus({ ...status, running: true });
    try {
      const funds = await cfg.loadFunds();
      await refreshAll(funds, {
        ...cfg.deps,
        force,
        onResult: (fund, r) => {
          if (!('entry' in r)) return;
          ids.push(fund.id);
          void Promise.resolve()
            .then(() => cfg.onRefreshed?.(fund, r.entry))
            .catch(() => {});
        },
      });
    } catch {
      // 목록 읽기 실패 — 다음 실행 때 다시
    } finally {
      setStatus({ running: false, version: status.version + 1, refreshedIds: ids });
    }
  };

  return {
    run({ force = false } = {}) {
      if (current) {
        if (force) pendingForce = true;
        return current;
      }
      current = (async () => {
        let f = force;
        do {
          pendingForce = false;
          await once(f);
          f = true;
        } while (pendingForce);
      })().finally(() => {
        current = null;
      });
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getStatus: () => status,
  };
}
```

`mobile/src/features/fund/core/use-auto-refresh.ts` 생성:

```ts
// 자동 갱신 상태 구독 훅(웹·앱 공용). web_client/src/lib/fundCore 와 동일.
import { useSyncExternalStore } from 'react';

import type { AutoRefresher, AutoRefreshStatus } from './refresh-all';

export function useAutoRefreshStatus(r: AutoRefresher): AutoRefreshStatus {
  return useSyncExternalStore(r.subscribe, r.getStatus, r.getStatus);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && npx jest src/features/fund/core/refresh-all.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add mobile/src/features/fund/core/refresh-all.ts mobile/src/features/fund/core/refresh-all.test.ts mobile/src/features/fund/core/use-auto-refresh.ts
git commit -m "feat(fund): core createAutoRefresher — single-flight·force 재실행·상태 구독 + useAutoRefreshStatus"
```

---

### Task 3: core `fundStatusLine` + `useFundReport.reload` + export + 웹 동기화

**Files:**
- Modify: `mobile/src/features/fund/core/display.ts`
- Modify: `mobile/src/features/fund/core/display.test.ts`
- Modify: `mobile/src/features/fund/core/use-fund-report.ts`
- Modify: `mobile/src/features/fund/core/index.ts`
- Sync: `web_client/src/lib/fundCore/`

- [ ] **Step 1: 실패하는 테스트 추가** — `display.test.ts` import 를 `import { evalDateOf, formatChecked, fundStatusLine } from './display';` 로 바꾸고 맨 아래에 추가

```ts
describe('fundStatusLine', () => {
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
  const report = (evalDate: string): FundReport => ({
    title: '',
    investorNo: '',
    investorName: '',
    notice: null,
    sections: evalDate ? [{ kind: 'accounts', title: '', evalDate, group: '', accounts: [], notes: [] }] : [],
  });
  it('캐시가 없으면 빈 문자열', () => {
    expect(fundStatusLine(null, at(19, 9, 0))).toBe('');
  });
  it('기준일 + 확인 시각', () => {
    expect(fundStatusLine({ fetchedAt: at(19, 14, 5), report: report('2026년 10월 19일') }, at(19, 15, 0))).toBe(
      '기준일 2026.10.19 · 14:05 확인',
    );
  });
  it('기준일이 없으면 확인 시각만(다른 날은 월/일)', () => {
    expect(fundStatusLine({ fetchedAt: at(18, 9, 0), report: report('') }, at(19, 9, 0))).toBe('10/18 09:00 확인');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/display.test.ts`
Expected: FAIL — `fundStatusLine is not a function`

- [ ] **Step 3: 구현**

`display.ts` — import 부분을 아래로 바꾸고(view.ts 는 display 를 import 하지 않으므로 순환 없음) 파일 끝에 함수 추가:

```ts
import type { CacheEntry } from './refresh';
import type { FundReport } from './types';
import { formatValue } from './view';
```

```ts
/** 목록 한 줄 — "기준일 2026.10.19 · 14:05 확인". 캐시가 없으면 '' */
export function fundStatusLine(entry: Pick<CacheEntry, 'fetchedAt' | 'report'> | null, now: number): string {
  if (!entry) return '';
  const checked = `${formatChecked(entry.fetchedAt, now)} 확인`;
  const d = evalDateOf(entry.report);
  return d ? `기준일 ${formatValue('', d).text} · ${checked}` : checked;
}
```

`use-fund-report.ts` — 반환 타입과 `reload` 추가:

```ts
export function useFundReport(
  fund: FundEntry | null,
  cache: CachePort,
): ReportState & { refresh: () => void; reload: () => void } {
```

`refresh` useCallback 바로 아래에 추가:

```ts
  // 원본을 가져오지 않고 캐시만 다시 읽는다 — 자동 갱신이 이 펀드를 새로 가져온 뒤 열린 화면이 부른다
  const reload = useCallback(() => {
    if (id === null) return;
    void readValidCache(cache, id)
      .then((c) => {
        if (c && alive.current && currentId.current === id) {
          setState((s) => ({ ...s, entry: c, error: s.refreshing ? s.error : null }));
        }
      })
      .catch(() => {});
  }, [id, cache]);
```

마지막 `return { ...state, refresh };` → `return { ...state, refresh, reload };`

`index.ts` — `export * from './history-view';` 아래에 추가:

```ts
export * from './refresh-all';
export { useAutoRefreshStatus } from './use-auto-refresh';
```

- [ ] **Step 4: 통과 확인 + 전체 core 테스트 + 동기화**

Run:
```bash
cd mobile && npx jest src/features/fund && npx tsc --noEmit
cd .. && scripts/check-fund-core-sync.sh --write && scripts/check-fund-core-sync.sh
cd web_client && npx tsc --noEmit && npm run lint
```
Expected: jest 전부 PASS, tsc 오류 없음, sync 검사 출력 없음(exit 0), web lint 0 errors(기존 warnings 허용).

- [ ] **Step 5: 커밋**

```bash
git add mobile/src/features/fund/core/display.ts mobile/src/features/fund/core/display.test.ts mobile/src/features/fund/core/use-fund-report.ts mobile/src/features/fund/core/index.ts web_client/src/lib/fundCore
git commit -m "feat(fund): core fundStatusLine·useFundReport.reload + 자동 갱신 export, 웹 fundCore 동기화"
```

---

### Task 4: 앱 기록 규칙을 `record.ts` 로 이동

**Files:**
- Create: `mobile/src/features/fund/record.ts`
- Test: `mobile/src/features/fund/record.test.ts`
- Modify: `mobile/src/app/fund/[id].tsx` (3행 import, 8행·21행 import, 50~58행 기록 effect)

- [ ] **Step 1: 실패하는 테스트** — `mobile/src/features/fund/record.test.ts`

```ts
jest.mock('./history-store', () => ({ recordSnapshot: jest.fn() }));
jest.mock('./backup-service', () => ({ maybeAutoBackup: jest.fn(async () => {}) }));

import { maybeAutoBackup } from './backup-service';
import type { CacheEntry, FundEntry } from './core';
import { recordSnapshot } from './history-store';
import { recordFetched, resetRecordedForTest } from './record';

const snap = recordSnapshot as jest.MockedFunction<typeof recordSnapshot>;
const backup = maybeAutoBackup as jest.MockedFunction<typeof maybeAutoBackup>;

const FUND: FundEntry = { id: 'f1', name: '', url: 'https://fund.ivyro.net/dataroom/om_data/x.htm' };
const entry = (fetchedAt: number): CacheEntry => ({
  v: 1,
  fetchedAt,
  hash: 'h',
  report: { title: '', investorNo: '', investorName: '', notice: null, sections: [] },
  missing: [],
});

beforeEach(() => {
  snap.mockReset();
  backup.mockClear();
  resetRecordedForTest();
});

it('같은 (펀드, fetchedAt) 은 한 번만 기록한다', async () => {
  snap.mockResolvedValue(false);
  await recordFetched(FUND, entry(100));
  await recordFetched(FUND, entry(100));
  expect(snap).toHaveBeenCalledTimes(1);
  expect(snap).toHaveBeenCalledWith(FUND, entry(100).report, 100);
  await recordFetched(FUND, entry(200));
  expect(snap).toHaveBeenCalledTimes(2);
});

it('새 날짜가 생겼을 때만 자동 백업을 시도한다', async () => {
  snap.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await recordFetched(FUND, entry(1));
  expect(backup).not.toHaveBeenCalled();
  await recordFetched(FUND, entry(2));
  expect(backup).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/record.test.ts`
Expected: FAIL — `Cannot find module './record'`

- [ ] **Step 3: 구현** — `mobile/src/features/fund/record.ts`

```ts
// 새로 가져온 리포트를 히스토리에 기록 — 리포트 화면·자동 갱신 공용. 같은 (펀드, fetchedAt) 은 한 번만.
// 새 날짜가 생기면 자동 백업(하루 1번 규칙은 maybeAutoBackup 이 판단).
import { maybeAutoBackup } from './backup-service';
import type { CacheEntry, FundEntry } from './core';
import { recordSnapshot } from './history-store';

const recorded = new Map<string, number>(); // 펀드 id → 마지막으로 기록한 fetchedAt

export async function recordFetched(fund: FundEntry, entry: CacheEntry): Promise<void> {
  if (recorded.get(fund.id) === entry.fetchedAt) return;
  recorded.set(fund.id, entry.fetchedAt);
  const added = await recordSnapshot(fund, entry.report, entry.fetchedAt);
  if (added) await maybeAutoBackup();
}

export const resetRecordedForTest = (): void => recorded.clear();
```

`mobile/src/app/fund/[id].tsx` 수정:
- `import { useEffect, useMemo, useRef, useState } from 'react';` → `import { useEffect, useMemo, useState } from 'react';`
- `import { maybeAutoBackup } from '@/features/fund/backup-service';` 삭제
- `import { recordSnapshot } from '@/features/fund/history-store';` → `import { recordFetched } from '@/features/fund/record';`
- 기존 기록 블록(주석 `// 새로 가져오기에 성공한 회차만 기록…` 부터 `const recordedAt = useRef(0);` 와 그 effect 끝까지)을 아래로 교체:

```ts
  // 새로 가져오기에 성공한 회차만 기록(캐시만 보일 때·실패했을 때는 기록하지 않음). 같은 날짜는 덮어쓴다.
  useEffect(() => {
    if (!fund || !entry || refreshing || error) return;
    void recordFetched(fund, entry);
  }, [fund, entry, refreshing, error]);
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && npx jest src/features/fund && npx tsc --noEmit`
Expected: 전부 PASS, tsc 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add mobile/src/features/fund/record.ts mobile/src/features/fund/record.test.ts "mobile/src/app/fund/[id].tsx"
git commit -m "refactor(fund): 히스토리 기록 규칙을 record.ts 로 — 리포트 화면·자동 갱신 공용(동작 동일)"
```

---

### Task 5: 앱 자동 갱신 연결 (`auto-refresh.ts` + `_layout` + 리포트 재읽기)

**Files:**
- Create: `mobile/src/features/fund/auto-refresh.ts`
- Modify: `mobile/src/app/_layout.tsx`
- Modify: `mobile/src/app/fund/[id].tsx`

- [ ] **Step 1: 구현** — `mobile/src/features/fund/auto-refresh.ts`

```ts
// 앱 실행·복귀 때 등록한 펀드를 모두 다시 가져온다(10분 이내 확인한 펀드는 건너뜀). 성공한 펀드는 히스토리에 기록.
// 로직(건너뛰기·동시 2개·single-flight)은 core createAutoRefresher — 여기선 앱 저장소·실행 시점만 연결.
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuthStore } from '@/features/auth/store';

import { createAutoRefresher, fetchReportHtml } from './core';
import { fileCache, loadFunds } from './fund-store';
import { recordFetched } from './record';

export const fundRefresher = createAutoRefresher({
  loadFunds,
  deps: { fetchHtml: (u) => fetchReportHtml(u), cache: fileCache, now: Date.now },
  onRefreshed: recordFetched,
});

/** 루트 레이아웃에서 한 번 — 로그인 상태일 때 시작 1회 + 백그라운드에서 돌아올 때마다 */
export function useFundAutoRefresh(): void {
  const loggedIn = useAuthStore((s) => s.user !== null);
  useEffect(() => {
    if (!loggedIn) return;
    void fundRefresher.run();
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (prev !== 'active' && next === 'active') void fundRefresher.run();
      prev = next;
    });
    return () => sub.remove();
  }, [loggedIn]);
}
```

`mobile/src/app/_layout.tsx`:
- import 추가(`useAuthStore` import 아래): `import { useFundAutoRefresh } from '@/features/fund/auto-refresh';`
- `export default function RootLayout() {` 바로 다음 줄에:

```ts
  useFundAutoRefresh(); // 실행·복귀 시 등록 펀드 자동 갱신(로그인 상태일 때만)
```

`mobile/src/app/fund/[id].tsx`:
- import 추가: `import { fundRefresher } from '@/features/fund/auto-refresh';`
- `const { entry, refreshing, error, refresh } = useFundReport(fund ?? null, fileCache);` → `const { entry, refreshing, error, refresh, reload } = useFundReport(fund ?? null, fileCache);`
- Task 4 의 기록 effect 바로 아래에 추가:

```ts
  // 자동 갱신이 이 펀드를 새로 가져왔으면 캐시만 다시 읽어 화면에 반영(다시 가져오지 않음)
  useEffect(
    () =>
      fundRefresher.subscribe(() => {
        const s = fundRefresher.getStatus();
        if (!s.running && fund && s.refreshedIds.includes(fund.id)) reload();
      }),
    [fund, reload],
  );
```

- [ ] **Step 2: 검증**

Run: `cd mobile && npx tsc --noEmit && npx jest src/features/fund && npx expo config --type public >/dev/null && echo CONFIG_OK`
Expected: tsc 오류 없음, jest PASS, `CONFIG_OK`

- [ ] **Step 3: 커밋**

```bash
git add mobile/src/features/fund/auto-refresh.ts mobile/src/app/_layout.tsx "mobile/src/app/fund/[id].tsx"
git commit -m "feat(fund): 앱 실행·복귀 시 등록 펀드 자동 갱신 + 히스토리 기록, 열린 리포트는 캐시 재읽기"
```

---

### Task 6: 앱 목록 한 줄 + 갱신 중 표시

**Files:**
- Modify: `mobile/src/app/fund/index.tsx`

- [ ] **Step 1: 구현**

import 수정:
- `import { useCallback, useState } from 'react';` → `import { useCallback, useEffect, useState } from 'react';`
- `import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';` → `import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';`
- `@/features/fund/core` import 블록에 `fundStatusLine,` `readValidCache,` `useAutoRefreshStatus,` 추가(알파벳 순 유지)
- `import { fundRefresher } from '@/features/fund/auto-refresh';` 추가(`useAuthStore` import 아래)
- `import { deleteCache, loadFunds, saveFunds } from '@/features/fund/fund-store';` → `import { deleteCache, fileCache, loadFunds, saveFunds } from '@/features/fund/fund-store';`

`const [loadError, setLoadError] = useState('');` 아래에 추가:

```ts
  const status = useAutoRefreshStatus(fundRefresher);
  const [lines, setLines] = useState<Record<string, string>>({});

  // 목록 한 줄(기준일·확인 시각) — 목록이 바뀌거나 자동 갱신이 끝날 때마다 캐시를 다시 읽는다
  useEffect(() => {
    if (!funds) return;
    let alive = true;
    const now = Date.now();
    void Promise.all(
      funds.map(
        async (f) => [f.id, fundStatusLine(await readValidCache(fileCache, f.id).catch(() => null), now)] as const,
      ),
    ).then((pairs) => {
      if (alive) setLines(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [funds, status.version]);
```

헤더 `headerRight` 를 아래로 교체:

```tsx
          headerRight: () => (
            <View style={styles.headerActions}>
              {status.running ? <ActivityIndicator /> : null}
              <Pressable
                onPress={() => router.push('/fund/backup')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="기록 백업"
              >
                <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.text} />
              </Pressable>
            </View>
          ),
```

ListRow 의 `subtitle="탭해서 수익 보기"` → `subtitle={lines[f.id] || '탭해서 수익 보기'}`

styles 에 추가(`flex` 아래):

```ts
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(2) },
```

- [ ] **Step 2: 검증**

Run: `cd mobile && npx tsc --noEmit && npx jest src/features/fund`
Expected: 오류 없음, PASS

- [ ] **Step 3: 커밋**

```bash
git add mobile/src/app/fund/index.tsx
git commit -m "feat(fund): 앱 펀드 목록에 기준일·확인 시각 한 줄 + 자동 갱신 중 표시"
```

---

### Task 7: 웹 자동 갱신 + 목록 한 줄 + 리포트 재읽기

**Files:**
- Create: `web_client/src/lib/fundAutoRefresh.ts`
- Modify: `web_client/src/components/Layout.tsx`
- Modify: `web_client/src/pages/FundListPage.tsx`
- Modify: `web_client/src/pages/FundReportPage.tsx`

- [ ] **Step 1: 구현** — `web_client/src/lib/fundAutoRefresh.ts`

```ts
import { useEffect } from 'react'
import { createAutoRefresher, fetchReportHtml } from './fundCore'
import { loadFunds, localCache } from './fundStore'
import { useAuthStore } from '../store/auth'

// 웹 접속·탭 복귀 때 이 브라우저에 등록한 펀드를 모두 다시 가져온다(10분 이내 확인한 펀드는 건너뜀).
// 로직은 core createAutoRefresher(앱과 동일) — 여기선 localStorage 저장소·실행 시점만 연결. 웹은 히스토리 없음.
export const fundRefresher = createAutoRefresher({
  loadFunds: async () => loadFunds(),
  deps: { fetchHtml: (u) => fetchReportHtml(u), cache: localCache, now: Date.now },
})

/** Layout 에서 한 번 — 로그인 상태일 때 시작 1회 + 탭이 다시 보일 때마다 */
export function useFundAutoRefresh(): void {
  const loggedIn = useAuthStore((s) => s.user !== null)
  useEffect(() => {
    if (!loggedIn) return
    void fundRefresher.run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fundRefresher.run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loggedIn])
}
```

`web_client/src/components/Layout.tsx`:
- import 추가(`import { showToast } from '../store/toast'` 아래): `import { useFundAutoRefresh } from '../lib/fundAutoRefresh'`
- `const width = ...` 줄 바로 아래에: `  useFundAutoRefresh() // 접속·탭 복귀 시 등록 펀드 자동 갱신(로그인 상태일 때만)`

`web_client/src/pages/FundListPage.tsx`:
- `import { useState, type FormEvent } from 'react'` → `import { useEffect, useState, type FormEvent } from 'react'`
- `../lib/fundCore` import 에 `fundStatusLine, readValidCache, useAutoRefreshStatus` 추가
- `import { deleteCache, loadFunds, saveFunds } from '../lib/fundStore'` → `import { deleteCache, loadFunds, localCache, saveFunds } from '../lib/fundStore'`
- import 추가: `import { fundRefresher } from '../lib/fundAutoRefresh'`
- `const [error, setError] = useState('')` 아래에(조기 return `if (!user)` 보다 위):

```tsx
  const status = useAutoRefreshStatus(fundRefresher)
  const [lines, setLines] = useState<Record<string, string>>({})

  // 목록 한 줄(기준일·확인 시각) — 목록이 바뀌거나 자동 갱신이 끝날 때마다 캐시를 다시 읽는다
  useEffect(() => {
    let alive = true
    const now = Date.now()
    void Promise.all(
      funds.map(async (f) => [f.id, fundStatusLine(await readValidCache(localCache, f.id), now)] as const),
    ).then((pairs) => {
      if (alive) setLines(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [funds, status.version])
```

- h1 교체:

```tsx
      <h1 className="mb-5 mt-1 text-xl font-bold text-ink">
        내 펀드 수익
        {status.running && <span className="ml-2 text-xs font-normal text-ink-muted">확인 중…</span>}
      </h1>
```

- 목록 항목 `<span>📈 {displayName(f)}</span>` 교체:

```tsx
                <span className="min-w-0">
                  <span className="block">📈 {displayName(f)}</span>
                  {lines[f.id] && (
                    <span className="mt-0.5 block text-xs tabular-nums text-ink-muted">{lines[f.id]}</span>
                  )}
                </span>
```

`web_client/src/pages/FundReportPage.tsx`:
- import 추가: `import { fundRefresher } from '../lib/fundAutoRefresh'`
- `const { entry, refreshing, error, refresh } = useFundReport(fund, localCache)` → `const { entry, refreshing, error, refresh, reload } = useFundReport(fund, localCache)`
- 기본 이름 effect 바로 아래(조기 return 들보다 위)에:

```tsx
  // 자동 갱신이 이 펀드를 새로 가져왔으면 캐시만 다시 읽어 반영(다시 가져오지 않음)
  useEffect(
    () =>
      fundRefresher.subscribe(() => {
        const s = fundRefresher.getStatus()
        if (!s.running && fund && s.refreshedIds.includes(fund.id)) reload()
      }),
    [fund, reload],
  )
```

- [ ] **Step 2: 검증**

Run: `cd web_client && npx tsc --noEmit && npm run lint && cd .. && scripts/check-fund-core-sync.sh`
Expected: tsc 오류 없음, lint 0 errors, sync 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add web_client/src/lib/fundAutoRefresh.ts web_client/src/components/Layout.tsx web_client/src/pages/FundListPage.tsx web_client/src/pages/FundReportPage.tsx
git commit -m "feat(web): 접속·탭 복귀 시 등록 펀드 자동 갱신 + 목록 기준일·확인 시각, 열린 리포트 재읽기"
```

---

### Task 8: README + 전체 검증

**Files:**
- Modify: `README.md` ("### 펀드 수익보기" 단락의 `- 설계: \`docs/superpowers/specs/2026-10-18-fund-report-viewer-design.md\`` 줄 바로 위)

- [ ] **Step 1: README 추가** — 아래 2줄을 해당 위치에 넣는다

```markdown
- **자동 갱신**: 앱 실행·앱 복귀·웹 접속·탭 복귀 때 등록한 펀드를 모두 다시 가져온다(로그인 상태, 10분 이내 확인한 펀드는 건너뜀, 동시 2개). 앱은 리포트를 열지 않아도 히스토리가 쌓인다. 목록에 `기준일 · 확인 시각` 표시.
  설계: `docs/superpowers/specs/2026-10-19-fund-auto-refresh-design.md` (로직은 core `refresh-all.ts`)
```

- [ ] **Step 2: 전체 검증**

Run:
```bash
cd mobile && npx tsc --noEmit && npx jest && npx expo config --type public >/dev/null && echo CONFIG_OK
cd ../web_client && npx tsc --noEmit && npm run lint
cd .. && scripts/check-fund-core-sync.sh && echo SYNC_OK
```
Expected: mobile tsc 오류 없음, jest 전부 PASS(기존 + 신규), `CONFIG_OK`, web tsc·lint 0 errors, `SYNC_OK`

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs(readme): 펀드 리포트 자동 갱신"
```

- [ ] **Step 4: 수동 확인(사용자, dev build·웹)**
  - 앱: 펀드 등록 → 홈 버튼으로 나갔다가 11분 뒤 복귀 → 목록 헤더 로딩 표시 → 한 줄의 확인 시각이 바뀜. 리포트를 열지 않고 수익 히스토리에 오늘 기록이 생김.
  - 웹: `/me/funds` 에서 다른 탭으로 갔다가 11분 뒤 복귀 → "확인 중…" → 확인 시각 갱신.
