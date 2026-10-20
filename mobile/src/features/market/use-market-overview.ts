import { useCallback, useEffect, useState } from 'react';

import { kstDateString } from '@/features/game/lib/format';

import { fetchMarketCalendar, fetchMarketGroups, fetchMarketOverview } from './api';
import { errorCode, shiftDate } from './format';
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

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await fetchAll(), loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: errorCode(e) });
    }
  }, []);

  /** 당겨서 새로고침 — 기존 내용 유지, 성공하면 교체(실패는 throw) */
  const refresh = useCallback(async () => {
    const data = await fetchAll();
    setState({ data, loading: false, error: null });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh };
}
