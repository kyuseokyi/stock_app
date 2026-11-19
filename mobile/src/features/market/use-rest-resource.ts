import { useCallback, useEffect, useRef, useState } from 'react';

import { stampFetch } from './auto-refresh';
import { errorCode } from './format';
import { createLatest } from './latest';

export type ResourceState<T> = { data: T | null; loading: boolean; error: string | null };

/**
 * REST 한 건을 불러오는 공용 상태(마켓 대시보드 섹션마다 따로 — 하나가 실패해도 나머지는 그대로).
 * - fetcher 가 바뀌면(히트맵 기준 전환 등) 다시 불러온다 — 호출부는 useCallback 으로 고정해 넘긴다
 * - reload: 첫 로딩·[다시 시도]. 실패해도 이전 데이터는 남긴다(오류 코드만 기록)
 * - refresh: 당겨서 새로고침 — 실패하면 throw(호출부가 모아서 판단)
 * - silentRefresh: 자동 새로고침 — 번호를 올리지 않아 진행 중인 전체 새로고침을 막지 않는다
 * - fetchedAt: 마지막 조회가 끝난 시각 — 복귀 재조회(useReturnRefresh) 판정용
 * 요청 번호(createLatest)로 늦게 도착한 옛 응답이 새 결과를 덮지 않게 한다.
 * - enabled: false 면 요청하지 않고 빈 상태(로딩·오류 아님)로 둔다 — 시세 비노출(A안)로 숨긴 섹션이 403 을 부르지 않게.
 *   true 로 바뀌면(로그인 등) 그때 불러온다. 기본 true(지금과 같음)
 */
export function useRestResource<T>(fetcher: () => Promise<T>, enabled = true) {
  const [state, setState] = useState<ResourceState<T>>({ data: null, loading: enabled, error: null });
  const [gate] = useState(createLatest);
  const fetchedAt = useRef<number | null>(null);
  const load = useCallback(() => stampFetch(fetchedAt, fetcher), [fetcher]);

  const reload = useCallback(async () => {
    const id = gate.next();
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await load();
      if (gate.isLatest(id)) setState({ data, loading: false, error: null });
    } catch (e) {
      if (gate.isLatest(id)) setState((s) => ({ data: s.data, loading: false, error: errorCode(e) }));
    }
  }, [load, gate, enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const id = gate.next();
    const data = await load();
    if (gate.isLatest(id)) setState({ data, loading: false, error: null });
  }, [load, gate, enabled]);

  const silentRefresh = useCallback(async () => {
    if (!enabled) return;
    const id = gate.current();
    const data = await load();
    if (gate.isLatest(id)) setState((s) => ({ ...s, data, error: null }));
  }, [load, gate, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh, silentRefresh, fetchedAt };
}
