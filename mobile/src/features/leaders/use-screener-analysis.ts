import { useEffect, useState } from 'react';

import { isAnalyzableTicker, type ScreenerAnalysis } from './ai-analysis';
import { screenerAnalysisLoader } from './ai-rest';

/**
 * 카드 한 장의 AI 분석 — enabled(목록 상위 N개)일 때만 요청한다.
 * 캐시에 있으면 첫 그리기부터 바로 보여 주고, 없으면 로더(동시성 제한·캐시)에 맡긴다.
 * 로딩·실패·분석 없음은 모두 null — 호출부는 null 이면 AI 영역을 그리지 않는다.
 */
export function useScreenerAnalysis(ticker: string, enabled: boolean): ScreenerAnalysis | null {
  const active = enabled && isAnalyzableTicker(ticker);
  const [state, setState] = useState<{ ticker: string; value: ScreenerAnalysis | null }>(() => ({
    ticker,
    value: active ? (screenerAnalysisLoader.peek(ticker)?.value ?? null) : null,
  }));

  useEffect(() => {
    if (!active) return;
    let alive = true;
    // 캐시에 있으면 즉시 끝나는 프로미스 — 요청은 나가지 않는다
    void screenerAnalysisLoader.load(ticker).then((value) => {
      if (alive) setState({ ticker, value });
    });
    return () => {
      alive = false;
    };
  }, [ticker, active]);

  if (!active) return null;
  // 행이 다른 종목으로 재사용되면 이전 종목 결과 대신 캐시(있으면)를 바로 보여 준다
  return state.ticker === ticker ? state.value : (screenerAnalysisLoader.peek(ticker)?.value ?? null);
}
