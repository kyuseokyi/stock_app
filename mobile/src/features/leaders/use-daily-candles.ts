import { useCallback, useEffect, useState } from 'react';

import { getDailyCandles } from '@/features/game/api';
import type { DailyCandle } from '@/features/game/types';
import { errorCode } from '@/features/market/format';

type State = { rows: DailyCandle[] | null; seq: number; loading: boolean; error: string | null };

/** 종목 일봉 — 점수 조회와 독립(차트만 실패해도 점수표는 보인다). 성공할 때마다 seq 를 올려 차트를 다시 그린다 */
export function useDailyCandles(ticker: string, lookbackDays: number) {
  const [state, setState] = useState<State>({ rows: null, seq: 0, loading: true, error: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const rows = await getDailyCandles(ticker, new Date(), lookbackDays);
      setState((s) => ({ rows, seq: s.seq + 1, loading: false, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorCode(e) }));
    }
  }, [ticker, lookbackDays]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
