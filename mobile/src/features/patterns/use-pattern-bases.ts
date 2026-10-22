import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

import { fetchPatternBases } from './api';
import type { PatternBases } from './types';

type State = { data: PatternBases | null; loading: boolean; error: string | null };

/** 종목 상세 '차트 패턴' — 점수·차트 조회와 독립(실패해도 다른 영역은 그대로). 실패·베이스 없음은 영역 숨김 */
export function usePatternBases(ticker: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });
  const gate = useRef(createLatest()).current;

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchPatternBases(ticker);
      if (!gate.isLatest(id)) return;
      setState({ data, loading: false, error: null });
    } catch (e) {
      if (!gate.isLatest(id)) return;
      setState((s) => ({ data: s.data, loading: false, error: errorCode(e) }));
    }
  }, [ticker, gate]);

  const shownTicker = useRef(ticker);
  useEffect(() => {
    if (shownTicker.current !== ticker) {
      shownTicker.current = ticker;
      setState({ data: null, loading: true, error: null });
    }
    void reload();
  }, [reload, ticker]);

  useEffect(
    () => () => {
      gate.next();
    },
    [gate],
  );

  return { ...state, reload };
}
