import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

import { fetchCanslimScore } from './api';
import type { CanslimScore } from './types';

type State = { data: CanslimScore | null; loading: boolean; error: string | null };

/** 종목 점수표 — data null + 오류 없음 = 분석 비대상(scoreView 가 'none'). 차트 조회와는 독립 */
export function useCanslimScore(ticker: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  // 늦게 도착한 옛 응답(이전 종목·이전 요청)이 새 결과를 덮지 않게 마지막 요청만 반영한다
  const gate = useRef(createLatest()).current;

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchCanslimScore(ticker);
      if (!gate.isLatest(id)) return;
      setState({ data, loading: false, error: null });
    } catch (e) {
      if (!gate.isLatest(id)) return;
      // 이미 보이던 점수표는 남긴다(scoreView 는 data 가 있으면 ready)
      setState((s) => ({ data: s.data, loading: false, error: errorCode(e) }));
    }
  }, [ticker, gate]);

  /** 당겨서 새로고침 — 기존 내용 유지(실패는 throw → 토스트) */
  const refresh = useCallback(async () => {
    const id = gate.next();
    const data = await fetchCanslimScore(ticker);
    if (!gate.isLatest(id)) return;
    setState({ data, loading: false, error: null });
  }, [ticker, gate]);

  // 종목이 바뀌면 이전 종목 데이터를 비우고 새로 조회한다
  const shownTicker = useRef(ticker);
  useEffect(() => {
    if (shownTicker.current !== ticker) {
      shownTicker.current = ticker;
      setState({ data: null, loading: true, error: null });
    }
    void reload();
  }, [reload, ticker]);

  return { ...state, reload, refresh };
}
