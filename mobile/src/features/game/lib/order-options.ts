// 주문 패널 선택지·라벨(순수 함수 — RN 의존 없음, jest 대상). web_client src/lib/orderOptions.ts 와 동일 규칙.
// 손절/익절 % 는 진입가 대비 '주가' 변동 기준(backend pricing.tp_sl_prices) — 레버리지 반영 수익률이 아니다.
import type { Ratio } from '../types';
import { formatPrice } from './format';

/** 칩으로 노출하는 비중 */
export const RATIO_CHIPS: readonly Ratio[] = [0.25, 0.5, 1.0];
/** '▾ 기타' 로 노출하는 비중 */
export const RATIO_MORE: readonly Ratio[] = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.75, 0.8, 0.9];
/** 손절 — 진입가 대비 주가 불리한 방향 % */
export const STOP_LOSS_PCTS: readonly number[] = [0.03, 0.05, 0.1, 0.15, 0.2];
/** 익절 — 진입가 대비 주가 유리한 방향 % */
export const TAKE_PROFIT_PCTS: readonly number[] = [0.05, 0.1, 0.2, 0.3, 0.5];
/** 강제청산 임계(수익률 -80%, backend MARGIN_CALL_ROI_PCT) */
export const MARGIN_CALL_ROI = 0.8;

const pctNum = (f: number): number => Math.round(f * 100);

export const ratioLabel = (r: Ratio): string => `${pctNum(r)}%`;
export const isChipRatio = (r: Ratio): boolean => RATIO_CHIPS.includes(r);
export const stopLossLabel = (p: number | null): string => (p === null ? '없음' : `-${pctNum(p)}%`);
export const takeProfitLabel = (p: number | null): string => (p === null ? '없음' : `+${pctNum(p)}%`);

/** 손절/익절 보조 문구 한 줄 — 주가 기준임과 배율 반영 수익률(약, 수수료 별도)을 알려준다 */
export function slTpHint(sl: number | null, tp: number | null, leverage: number): string {
  if (sl === null && tp === null) return '손절·익절 %는 진입가 대비 주가 변동 기준이에요';
  if (sl !== null && sl * leverage >= MARGIN_CALL_ROI) {
    return `${leverage}x에선 주가 -${pctNum(sl)}% 전에 강제청산(수익률 -80%)이 먼저 일어나요`;
  }
  const parts: string[] = [];
  if (sl !== null) parts.push(`손절 약 -${pctNum(sl * leverage)}%`);
  if (tp !== null) parts.push(`익절 약 +${pctNum(tp * leverage)}%`);
  return `주가 기준 · ${leverage}x 수익률 ${parts.join(' / ')}`;
}

/** 포지션 카드 한 줄: '손절 67,640원 · 익절 —'. 둘 다 없으면 null */
export function slTpLine(sl: number | null, tp: number | null): string | null {
  if (sl === null && tp === null) return null;
  const fmt = (p: number | null) => (p === null ? '—' : `${formatPrice(p)}원`);
  return `손절 ${fmt(sl)} · 익절 ${fmt(tp)}`;
}
