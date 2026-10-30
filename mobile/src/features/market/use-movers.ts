import { fetchMovers } from './rest';
import { useRestResource } from './use-rest-resource';

/** 급등·급락 Top 10 + AI 원인·핫 키워드. 장중 자동 갱신은 화면이 silentRefresh 를 useAutoRefresh 에 건다 */
export function useMovers() {
  return useRestResource(fetchMovers);
}

/** 급등락 자동 갱신 주기 — 서버 AI 원인 분석이 몇 분 단위라 지수(30초)보다 느리게 */
export const MOVERS_REFRESH_MS = 60_000;
