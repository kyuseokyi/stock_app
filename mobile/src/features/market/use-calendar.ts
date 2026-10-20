import { useCallback, useEffect, useRef, useState } from 'react';

import { kstDateString } from '@/features/game/lib/format';

import { fetchMarketCalendar } from './api';
import { errorCode, shiftDate, splitEvents } from './format';
import { createLatest } from './latest';
import type { CalendarEvent } from './types';

export type CalendarCategory = '전체' | '공모주' | '경제지표';

type State = { past: CalendarEvent[]; upcoming: CalendarEvent[]; loading: boolean; error: string | null };

/** 일정 — 지난 7일 + 앞으로 60일, 분류 칩. 분류를 빠르게 바꿔도 마지막 요청만 반영 */
export function useCalendar() {
  const [category, setCategory] = useState<CalendarCategory>('전체');
  const [state, setState] = useState<State>({ past: [], upcoming: [], loading: true, error: null });
  const gate = useRef(createLatest()).current;
  const today = kstDateString();

  const fetchSplit = useCallback(async () => {
    const events = await fetchMarketCalendar(
      shiftDate(today, -7),
      shiftDate(today, 60),
      category === '전체' ? undefined : category,
    );
    return splitEvents(events, today);
  }, [category, today]);

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fetchSplit();
      if (!gate.isLatest(id)) return;
      setState({ ...r, loading: false, error: null });
    } catch (e) {
      if (!gate.isLatest(id)) return;
      setState({ past: [], upcoming: [], loading: false, error: errorCode(e) });
    }
  }, [fetchSplit, gate]);

  const refresh = useCallback(async () => {
    const id = gate.next();
    let r: Awaited<ReturnType<typeof fetchSplit>>;
    try {
      r = await fetchSplit();
    } catch (e) {
      // 더 새 요청에 밀렸으면 그쪽이 상태를 정한다
      if (!gate.isLatest(id)) return;
      // 무시하게 된 진행 중 reload 를 대신 끝맺을 때는 reload 실패와 같게(옛 분류 일정·빈 상태 문구 방지)
      setState((s) => (s.loading ? { past: [], upcoming: [], loading: false, error: errorCode(e) } : s));
      throw e;
    }
    if (!gate.isLatest(id)) return;
    setState({ ...r, loading: false, error: null });
  }, [fetchSplit, gate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, today, category, setCategory, reload, refresh };
}
