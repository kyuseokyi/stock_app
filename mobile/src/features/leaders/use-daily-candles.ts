import { useCallback, useEffect, useRef, useState } from 'react';

import { getDailyCandles, getDailyCandlesBefore } from '@/features/game/api';
import { mergeOlder } from '@/features/game/lib/chart-bridge';
import type { DailyCandle } from '@/features/game/types';
import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

// prepended = 마지막 seq 에서 앞에 붙인 과거 캔들 수(0 = 새로 받음 → 첫 화면부터)
type State = { rows: DailyCandle[] | null; seq: number; loading: boolean; error: string | null; prepended: number };

/** 종목 일봉 — 점수 조회와 독립(차트만 실패해도 점수표는 보인다). 성공할 때마다 seq 를 올려 차트를 다시 그린다 */
export function useDailyCandles(ticker: string, lookbackDays: number) {
  const [state, setState] = useState<State>({ rows: null, seq: 0, loading: true, error: null, prepended: 0 });
  const rowsRef = useRef<DailyCandle[] | null>(null); // 과거 붙이기가 최신 행을 읽도록
  rowsRef.current = state.rows;

  // 늦게 도착한 옛 응답(이전 종목·기간)이 새 결과를 덮지 않게 마지막 요청만 반영한다
  const gate = useRef(createLatest()).current;

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const rows = await getDailyCandles(ticker, new Date(), lookbackDays);
      if (!gate.isLatest(id)) return;
      setState((s) => ({ rows, seq: s.seq + 1, loading: false, error: null, prepended: 0 }));
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
      setState((s) => ({ rows: null, seq: s.seq + 1, loading: true, error: null, prepended: 0 }));
    }
    void reload();
  }, [reload, ticker]);

  // 차트 왼쪽 끝 — 첫 캔들 이전 1년을 받아 앞에 붙인다. 빈 응답 = 저장된 기간의 처음(false). 실패는 throw
  const loadOlder = useCallback(async () => {
    const cur = rowsRef.current;
    const first = cur?.[0]?.date;
    if (!first) return false;
    const got = await getDailyCandlesBefore(ticker, first);
    if (got.length === 0) return false;
    // 그사이 종목이 바뀌었거나 다시 받았으면 붙이지 않는다(새 로드가 차트 상태를 이미 초기화)
    if (rowsRef.current !== cur || shownTicker.current !== ticker) return true;
    const rows = mergeOlder(got, cur);
    setState((s) => ({ ...s, rows, seq: s.seq + 1, prepended: rows.length - cur.length }));
    return true;
  }, [ticker]);

  return { ...state, reload, loadOlder };
}
