import { useCallback } from 'react';

import { fetchHeatmap } from './rest';
import type { HeatmapKind, HeatmapSize } from './rest-types';
import { useRestResource } from './use-rest-resource';

/** 시장 히트맵(업종·테마 × 시총·거래대금, 1일 등락) — 기준을 바꾸면 다시 불러온다(그동안 이전 그림 유지) */
export function useHeatmap(kind: HeatmapKind, size: HeatmapSize) {
  const fetcher = useCallback(() => fetchHeatmap(kind, size), [kind, size]);
  return useRestResource(fetcher);
}
