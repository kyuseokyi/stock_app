// stock_api REST(시황 AI·히트맵) 호출 — 응답은 rest-normalize 로 모양을 맞춰 돌려준다.
// GraphQL 계약 파일(api.ts)과 분리: api.ts 는 백엔드 계약 테스트가 읽으므로 손대지 않는다.
import { stockApi } from '@/lib/api';

import { normalizeHeatmap, normalizeInvestorFlow, normalizeMorningBrief, normalizeMovers } from './rest-normalize';
import type { Heatmap, HeatmapKind, HeatmapSize, InvestorFlow, MorningBrief, Movers } from './rest-types';

export async function fetchMorningBrief(): Promise<MorningBrief | null> {
  return normalizeMorningBrief(await stockApi.get<unknown>('/api/v1/market/morning-brief'));
}

export async function fetchMovers(): Promise<Movers> {
  return normalizeMovers(await stockApi.get<unknown>('/api/v1/market/movers'));
}

export async function fetchInvestorFlow(): Promise<InvestorFlow> {
  return normalizeInvestorFlow(await stockApi.get<unknown>('/api/v1/market/investor-flow'));
}

export async function fetchHeatmap(kind: HeatmapKind, size: HeatmapSize): Promise<Heatmap> {
  return normalizeHeatmap(await stockApi.get<unknown>('/api/v1/market/heatmap', { kind, size, period: '1d' }));
}
