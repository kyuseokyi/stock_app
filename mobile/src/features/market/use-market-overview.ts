import { useCallback, useEffect, useRef, useState } from 'react';

import { kstDateString } from '@/features/game/lib/format';

import { fetchMarketCalendar, fetchMarketGroups, fetchMarketOverview } from './api';
import { errorCode, shiftDate } from './format';
import { createLatest } from './latest';
import type { CalendarEvent, GroupItem, MarketOverview } from './types';

type Data = { overview: MarketOverview; themes: GroupItem[]; date: string | null; events: CalendarEvent[] };
type State = { data: Data | null; loading: boolean; error: string | null };

/** 개요·주도 테마 Top 5·다가오는 일정 3건을 따로 불러온다. 개요가 실패하면 오류, 나머지는 실패해도 그 칸만 비운다. */
async function fetchAll(): Promise<Data> {
  const today = kstDateString();
  const [ov, th, ev] = await Promise.allSettled([
    fetchMarketOverview(),
    fetchMarketGroups('theme', '1d', 'chg', 0, 5),
    fetchMarketCalendar(today, shiftDate(today, 60)),
  ]);
  if (ov.status === 'rejected') throw ov.reason;
  return {
    overview: ov.value,
    themes: th.status === 'fulfilled' ? th.value.items : [],
    date: th.status === 'fulfilled' ? th.value.date : null,
    events: ev.status === 'fulfilled' ? ev.value.slice(0, 3) : [],
  };
}

export function useMarketOverview() {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });
  // 요청 번호 — 늦게 도착한 옛 응답(당겨서 새로고침·자동 새로고침)이 새 결과를 덮지 않게
  const [gate] = useState(createLatest);
  // 자동 새로고침이 데이터 유무를 렌더 없이 보기 위한 최신 값
  const hasData = useRef(false);
  hasData.current = state.data != null;

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchAll();
      if (gate.isLatest(id)) setState({ data, loading: false, error: null });
    } catch (e) {
      if (gate.isLatest(id)) setState({ data: null, loading: false, error: errorCode(e) });
    }
  }, [gate]);

  /** 당겨서 새로고침 — 기존 내용 유지, 성공하면 교체(실패는 throw) */
  const refresh = useCallback(async () => {
    const id = gate.next();
    const data = await fetchAll();
    if (gate.isLatest(id)) setState({ data, loading: false, error: null });
  }, [gate]);

  /**
   * 장중 자동 새로고침 — 개요(지수·거시)만 다시 받아 바꾼다(테마·일정은 하루 한 번 바뀌므로 다시 받지 않음).
   * 번호를 올리지 않아 진행 중인 전체 새로고침을 막지 않고, 그 뒤에 시작된 전체 새로고침이 있으면 결과를 버린다.
   * 아직 데이터가 없으면(첫 로딩·오류 화면) 요청도 보내지 않는다(복구는 [다시 시도]·당겨서 새로고침). 실패는 호출한 쪽(createSilentRunner)이 삼킨다.
   */
  const silentRefresh = useCallback(async () => {
    if (!hasData.current) return; // 첫 로딩·오류 화면에서는 요청 자체를 보내지 않는다
    const id = gate.current();
    const overview = await fetchMarketOverview();
    if (!gate.isLatest(id)) return;
    setState((s) => (s.data ? { ...s, data: { ...s.data, overview } } : s));
  }, [gate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh, silentRefresh };
}
