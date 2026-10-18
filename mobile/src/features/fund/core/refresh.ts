// 원본 가져오기 + 캐시 갱신. 저장소는 CachePort 로 주입(앱: 파일, 웹: localStorage).
// 원본에 ETag/Last-Modified 가 없어 매번 가져오고 원본 HTML 해시로 변경을 판단한다.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { djb2 } from './hash';
import { parseFundReport } from './parse';
import { fundError, isFundError, type FundReport } from './types';

/** 파서 결과 JSON 모양을 바꾸면 올린다 → 옛 캐시를 버리고 다시 파싱 */
export const PARSER_VERSION = 1;

export type CacheEntry = { v: number; fetchedAt: number; hash: string; report: FundReport; missing: string[] };

export type CachePort = {
  read(id: string): Promise<CacheEntry | null>;
  write(id: string, entry: CacheEntry): Promise<void>;
};

export type RefreshDeps = {
  fetchHtml: (url: string) => Promise<string>;
  cache: CachePort;
  now: () => number;
};

export async function fetchReportHtml(
  url: string,
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw fundError('fetch', `원본 응답 ${res.status}`);
    return await res.text();
  } catch (e) {
    if (isFundError(e)) throw e;
    throw fundError('fetch', '원본을 가져오지 못했습니다'); // URL·원인 메시지는 남기지 않는다
  } finally {
    clearTimeout(timer);
  }
}

export async function readValidCache(cache: CachePort, id: string): Promise<CacheEntry | null> {
  const c = await cache.read(id);
  return c && c.v === PARSER_VERSION ? c : null;
}

export async function refreshReport(
  fund: { id: string; url: string },
  deps: RefreshDeps,
): Promise<{ changed: boolean; entry: CacheEntry }> {
  const html = await deps.fetchHtml(fund.url);
  const hash = djb2(html);
  const prev = await readValidCache(deps.cache, fund.id);
  if (prev && prev.hash === hash) {
    const entry = { ...prev, fetchedAt: deps.now() };
    await deps.cache.write(fund.id, entry).catch(() => {}); // 캐시 저장 실패는 결과를 막지 않는다
    return { changed: false, entry };
  }
  const { report, missing } = parseOrFormatError(html);
  const entry: CacheEntry = { v: PARSER_VERSION, fetchedAt: deps.now(), hash, report, missing };
  await deps.cache.write(fund.id, entry).catch(() => {});
  return { changed: true, entry };
}

function parseOrFormatError(html: string): ReturnType<typeof parseFundReport> {
  try {
    return parseFundReport(html);
  } catch (e) {
    if (isFundError(e)) throw e;
    throw fundError('format', '원본 형식을 읽지 못했습니다');
  }
}
