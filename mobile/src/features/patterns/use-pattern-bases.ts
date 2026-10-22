import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

import { fetchPatternBases } from './api';
import type { PatternBases } from './types';

// ticker = 이 상태가 어느 종목의 것인지(종목이 바뀐 직후 이전 종목 data 를 숨기는 데 쓴다)
type State = { ticker: string; data: PatternBases | null; loading: boolean; error: string | null };

/** 종목 상세 '차트 패턴' — 점수·차트 조회와 독립(실패해도 다른 영역은 그대로). 실패·베이스 없음은 영역 숨김 */
export function usePatternBases(ticker: string) {
  const [state, setState] = useState<State>({ ticker, data: null, loading: true, error: null });
  const gate = useRef(createLatest()).current;

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, ticker, loading: true, error: null }));
    try {
      const data = await fetchPatternBases(ticker);
      if (!gate.isLatest(id)) return;
      setState({ ticker, data, loading: false, error: null });
    } catch (e) {
      if (!gate.isLatest(id)) return;
      // 다시 조회가 실패하면 이전 data 도 비워 영역을 숨긴다
      setState({ ticker, data: null, loading: false, error: errorCode(e) });
    }
  }, [ticker, gate]);

  const shownTicker = useRef(ticker);
  useEffect(() => {
    if (shownTicker.current !== ticker) {
      shownTicker.current = ticker;
      setState({ ticker, data: null, loading: true, error: null });
    }
    void reload();
  }, [reload, ticker]);

  useEffect(
    () => () => {
      gate.next();
    },
    [gate],
  );

  // 종목이 바뀐 직후 한 프레임은 이전 종목 data 를 보이지 않는다(effect 가 상태를 비우기 전)
  const stale = state.ticker !== ticker;
  return { data: stale ? null : state.data, loading: stale ? true : state.loading, error: stale ? null : state.error, reload };
}
