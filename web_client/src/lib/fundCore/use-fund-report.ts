// 리포트 화면 훅(웹·앱 공용) — 캐시를 먼저 보여주고, 열 때마다 원본을 다시 가져온다.
// cache 는 모듈 상수로 넘길 것(참조가 바뀌면 다시 가져온다). web_client/src/lib/fundCore 와 동일.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { FundEntry } from './funds';
import { fetchReportHtml, readValidCache, refreshReport, type CacheEntry, type CachePort } from './refresh';
import { isFundError, type FundErrorCode } from './types';

export type ReportState = { entry: CacheEntry | null; refreshing: boolean; error: FundErrorCode | null };

export function useFundReport(
  fund: FundEntry | null,
  cache: CachePort,
): ReportState & { refresh: () => void; reload: () => void } {
  const id = fund?.id ?? null;
  const url = fund?.url ?? null;
  const [state, setState] = useState<ReportState>({ entry: null, refreshing: id !== null, error: null });
  const alive = useRef(true);
  const currentId = useRef(id); // 펀드가 바뀐 뒤 도착한 이전 펀드의 응답은 버린다

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (id === null || url === null) return;
    const isCurrent = () => alive.current && currentId.current === id;
    setState((s) => ({ ...s, refreshing: true, error: null }));
    refreshReport({ id, url }, { fetchHtml: (u) => fetchReportHtml(u), cache, now: Date.now })
      .then(({ entry }) => {
        if (isCurrent()) setState({ entry, refreshing: false, error: null });
      })
      .catch((e: unknown) => {
        if (isCurrent()) {
          setState((s) => ({ ...s, refreshing: false, error: isFundError(e) ? e.fundCode : 'fetch' }));
        }
      });
  }, [id, url, cache]);

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

  useEffect(() => {
    if (currentId.current !== id) {
      currentId.current = id;
      setState({ entry: null, refreshing: id !== null, error: null });
    }
    if (id === null) return;
    void readValidCache(cache, id)
      .then((c) => {
        if (alive.current && currentId.current === id && c) setState((s) => (s.entry ? s : { ...s, entry: c }));
      })
      .catch(() => {});
    refresh();
  }, [id, cache, refresh]);

  return { ...state, refresh, reload };
}
