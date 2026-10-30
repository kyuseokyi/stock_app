// stock_api REST — 주도주 AI 정성 분석 조회. api.ts(GraphQL 계약, 백엔드 테스트가 읽음)와 분리한다.
import { stockApi } from '@/lib/api';

import { createAnalysisLoader, normalizeScreenerAnalysis, type ScreenerAnalysis } from './ai-analysis';

/** GET /api/v1/ai/screener-analysis/{ticker} → 분석(키 없음·데이터 없음이면 null) */
export async function fetchScreenerAnalysis(ticker: string): Promise<ScreenerAnalysis | null> {
  return normalizeScreenerAnalysis(
    await stockApi.get<unknown>(`/api/v1/ai/screener-analysis/${encodeURIComponent(ticker)}`),
  );
}

/** 목록 상위 몇 개까지 분석을 요청할지 — 백엔드 평가 대상(주도주 상위 30종목)과 같은 범위 */
export const AI_ANALYSIS_TOP_N = 30;

/**
 * 앱 세션 공용 로더 — 동시 4개, 결과(null 포함) 10분 캐시, 실패는 1분 뒤 다시 시도.
 * 목록을 다시 그리거나 정렬을 바꿔도 같은 종목은 다시 요청하지 않는다.
 */
export const screenerAnalysisLoader = createAnalysisLoader({
  fetcher: fetchScreenerAnalysis,
  ttlMs: 10 * 60_000,
  failTtlMs: 60_000,
  maxConcurrent: 4,
  onError: (ticker, e) => console.warn(`[ai-analysis] ${ticker} 분석을 불러오지 못했어요`, e),
});
