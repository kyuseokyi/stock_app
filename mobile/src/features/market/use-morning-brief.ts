import { fetchMorningBrief } from './rest';
import { useRestResource } from './use-rest-resource';

/** AI 장전 브리핑(08:30 발행) — 없으면 data 가 null(카드 숨김) */
export function useMorningBrief() {
  return useRestResource(fetchMorningBrief);
}
