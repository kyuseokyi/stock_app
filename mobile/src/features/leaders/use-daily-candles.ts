import { useCallback, useEffect, useRef, useState } from 'react';

import { getDailyCandles } from '@/features/game/api';
import type { DailyCandle } from '@/features/game/types';
import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

type State = { rows: DailyCandle[] | null; seq: number; loading: boolean; error: string | null };

/** 종목 일봉 — 점수 조회와 독립(차트만 실패해도 점수표는 보인다). 성공할 때마다 seq 를 올려 차트를 다시 그린다 */
export function useDailyCandles(ticker: string, lookbackDays: number) {
  const [state, setState] = useState<State>({ rows: null, seq: 0, loading: true, error: null });

  // 늦게 도착한 옛 응답(이전 종목·기간)이 새 결과를 덮지 않게 마지막 요청만 반영한다
  const gate = useRef(createLatest()).current;

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const rows = await getDailyCandles(ticker, new Date(), lookbackDays);
      if (!gate.isLatest(id)) return;
      setState((s) => ({ rows, seq: s.seq + 1, loading: false, error: null }));
    } catch (e) {
      if (!gate.isLatest(id)) return;
      setState((s) => ({ ...s, loading: false, error: errorCode(e) }));
    }
  }, [ticker, lookbackDays, gate]);

  // 종목이 바뀌면 이전 종목 캔들을 비우고 새로 조회한다(seq 는 올려 차트를 다시 그린다)
  const shownTicker = useRef(ticker);
  useEffect(() => {
    if (shownTicker.current !== ticker) {
      shownTicker.current = ticker;
      setState((s) => ({ rows: null, seq: s.seq + 1, loading: true, error: null }));
    }
    void reload();
  }, [reload, ticker]);

  return { ...state, reload };
}
