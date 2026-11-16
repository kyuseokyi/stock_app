// stock_api REST — 종목 대차잔고 추이(공개 GET). api.ts(GraphQL 계약, 백엔드 테스트가 읽음)와 분리한다.
import { stockApi } from '@/lib/api';

import { LENDING_DAYS, normalizeLending, type LendingPoint } from './lending';

/** GET /api/v1/stocks/{ticker}/lending?days= → 오래된 순(데이터 없으면 []) */
export async function fetchLending(ticker: string, days = LENDING_DAYS): Promise<LendingPoint[]> {
  return normalizeLending(await stockApi.get<unknown>(`/api/v1/stocks/${encodeURIComponent(ticker)}/lending`, { days }));
}
