import { fetchInvestorFlow } from './rest';
import { useRestResource } from './use-rest-resource';

/** 투자자별 수급 전광판(외국인·기관·연기금 Top 10, 쌍끌이, AI 해설) — 하루 몇 번 갱신이라 자동 갱신 없음 */
export function useInvestorFlow() {
  return useRestResource(fetchInvestorFlow);
}
