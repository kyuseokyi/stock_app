// 게임 화면 전용 표시 함수(가격 콤마·KST 날짜·D-day·손익 톤).
// 원화/퍼센트는 공용 @/ui 의 formatWon/formatSignedWon/formatPct 를 쓴다.

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** 가격(원 단위 콤마): 71200 → '71,200'. Hermes Intl 로케일 차이를 피하려고 @/ui 처럼 en-US 콤마 사용 */
export const formatPrice = (n: number): string => Math.round(n).toLocaleString('en-US');

/** 손익 톤 — 양수 up(빨강) / 음수 down(파랑) / 0·없음 neutral. 색 매핑은 컴포넌트(theme.colors)에서 */
export type PnlTone = 'up' | 'down' | 'neutral';
export const pnlTone = (n: number | null | undefined): PnlTone =>
  n == null || n === 0 ? 'neutral' : n > 0 ? 'up' : 'down';

/** KST 기준 날짜 'YYYY-MM-DD' */
export function kstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 종료 시각까지 남은 일수(KST 날짜 차). end 없음 → null, 지남 → 0 */
export function daysUntil(endIso: string | null, now: Date = new Date()): number | null {
  if (!endIso) return null;
  const end = Date.parse(kstDateString(new Date(endIso)));
  const today = Date.parse(kstDateString(now));
  return Math.max(0, Math.round((end - today) / DAY_MS));
}
