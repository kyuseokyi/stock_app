// 주간 랭킹 표시 함수(KST 기간 표기·보상 금액·토스트 문구). 보상 금액은 "N원" 표기로 통일.
import type { WeeklyReward } from '../types';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const KST_OFFSET_MS = 9 * 3_600_000;

/** ISO 시각 → KST "10/12(월) 09:00" (기기 시간대 무관) */
export function formatKstShort(iso: string): string {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]}) ${hh}:${mm}`;
}

/** 주간 기간 "10/12(월) 09:00 ~ 10/19(월) 09:00" */
export const formatWeekRange = (startIso: string, endIso: string): string =>
  `${formatKstShort(startIso)} ~ ${formatKstShort(endIso)}`;

// Hermes 의 toLocaleString 지역화가 빌드마다 달라 정규식 천 단위 구분 사용
/** 주간 보상 금액 "500,000원" — 지난주 Top 3·토스트 공통 표기 */
export const formatRewardWon = (n: number): string =>
  `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;

export const rewardToastMessage = (r: WeeklyReward): string =>
  `지난주 주간 랭킹 ${r.rank}위! 보상 ${formatRewardWon(r.reward_amount)}이 지급됐어요`;

export const WEEKLY_RULE = '1~3위 50만·30만·20만 원 · 그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만';
