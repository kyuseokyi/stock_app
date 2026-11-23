// 교육용 종가 게임 화면 순수 함수(RN 의존 없음 — jest 로 검사).
// 손절·익절 미리보기는 서버 edu_game_service.stop_take_prices + edu_synthetic_engine.round_tick 과 같은 규칙.
import { formatPrice } from '@/features/game/lib/format';
import { krxTick } from '@/features/game/lib/krx-tick';

import type { EduAction, EduCandle, EduSide, EduState } from '../types';

/** 의사결정 패널 상태 — 비로그인 / 오늘 제출 완료 / 보유 중 / 미보유 */
export type EduPanelMode = 'guest' | 'submitted' | 'holding' | 'flat';

export function eduPanelMode(state: Pick<EduState, 'logged_in' | 'today_submitted' | 'account'>): EduPanelMode {
  if (!state.logged_in) return 'guest';
  if (state.today_submitted) return 'submitted';
  if (state.account?.position) return 'holding';
  return 'flat';
}

/** 헤더 오른쪽 오늘 참가 상태 칩 문구 — 제출 완료면 다음 정산 시각(HH:mm)을 함께 */
export function statusChipLabel(mode: EduPanelMode, nextIso: string | null): string {
  if (mode === 'guest') return '로그인하고 참가';
  if (mode !== 'submitted') return '오늘 참가 가능 🟢';
  const clock = settleClock(nextIso);
  return clock ? `오늘 참가 완료 ✅ (${clock.split(' ')[1]} 정산)` : '오늘 참가 완료 ✅';
}

/** 참여자 비율 공개 — 아직 고르기 전(미보유·보유)에는 남의 선택에 끌려가지 않게 숨기고, 제출 뒤·비로그인은 보여 준다 */
export function crowdVisible(mode: EduPanelMode): boolean {
  return mode === 'submitted' || mode === 'guest';
}

/** 호가 단위 반올림(최소 1틱, 0.5 는 올림) — 서버 round_tick 과 같다 */
export function eduRoundTick(price: number): number {
  if (!(price > 0)) return 1;
  const t = krxTick(price);
  // 부동소수 오차(47499.99999…) 보정 후 반올림
  const v = Math.floor(Math.round((price / t) * 1e6) / 1e6 + 0.5) * t;
  return Math.max(v, v > 0 ? krxTick(v) : 1, 1);
}

export type StopTake = { stopLoss: number; takeProfit: number };

/** 진입가 기준 % → 손절·익절가. 상승은 손절이 아래·익절이 위, 하락은 반대 */
export function stopTakePreview(side: EduSide, entry: number, slPct: number, tpPct: number): StopTake {
  if (side === 'LONG') {
    return { stopLoss: eduRoundTick(entry * (1 - slPct / 100)), takeProfit: eduRoundTick(entry * (1 + tpPct / 100)) };
  }
  return { stopLoss: eduRoundTick(entry * (1 + slPct / 100)), takeProfit: eduRoundTick(entry * (1 - tpPct / 100)) };
}

/**
 * 포지션 유지 때 손절·익절 재설정 미리보기 — null 이면 지금 값 그대로. valid=false 면 오늘 종가에 바로 닿는 값(서버가 400)
 */
export function keepPreview(
  pos: { side: EduSide; entry_price: number; stop_loss_price: number | null; take_profit_price: number | null },
  close: number,
  slPct: number | null,
  tpPct: number | null,
): { stopLoss: number | null; takeProfit: number | null; valid: boolean } {
  const stopLoss = slPct === null ? pos.stop_loss_price : stopTakePreview(pos.side, pos.entry_price, slPct, 5).stopLoss;
  const takeProfit = tpPct === null ? pos.take_profit_price : stopTakePreview(pos.side, pos.entry_price, 3, tpPct).takeProfit;
  if (slPct === null && tpPct === null) return { stopLoss, takeProfit, valid: true };
  if (stopLoss === null || takeProfit === null) return { stopLoss, takeProfit, valid: false };
  const valid = pos.side === 'LONG' ? stopLoss < close && close < takeProfit : takeProfit < close && close < stopLoss;
  return { stopLoss, takeProfit, valid };
}

/** 진입 금액 = 현금 × 비중(원 미만 버림, 서버는 소수 2자리 버림) */
export function entryAmount(cash: number, ratio: number): number {
  return Math.floor(cash * ratio);
}

/** 0.25 → '25%' */
export const ratioLabel = (r: number): string => `${Math.round(r * 100)}%`;

/** 다음 정산까지 남은 시간 문구 — 시각이 없거나 지났으면 '곧' */
export function remainingText(nextIso: string | null, nowMs: number): string {
  if (!nextIso) return '다음 정산 시각을 확인하고 있어요';
  const at = Date.parse(nextIso);
  if (Number.isNaN(at)) return '다음 정산 시각을 확인하고 있어요';
  const diff = at - nowMs;
  if (diff <= 0) return '곧 새 종가 캔들이 열려요';
  const totalMin = Math.max(1, Math.ceil(diff / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts = d > 0 ? [`${d}일`, h > 0 ? `${h}시간` : ''] : h > 0 ? [`${h}시간`, m > 0 ? `${m}분` : ''] : [`${m}분`];
  return `다음 정산까지 ${parts.filter(Boolean).join(' ')}`;
}

/** 정산 시각 표시(KST 'M/D HH:mm') — +09:00 문자열을 그대로 읽어 기기 시간대와 무관하게 */
export function settleClock(nextIso: string | null): string | null {
  if (!nextIso) return null;
  const at = Date.parse(nextIso);
  if (Number.isNaN(at)) return null;
  const k = new Date(at + 9 * 3_600_000);
  const hh = String(k.getUTCHours()).padStart(2, '0');
  const mm = String(k.getUTCMinutes()).padStart(2, '0');
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${hh}:${mm}`;
}

const signedWon = (n: number): string => `${n > 0 ? '+' : n < 0 ? '-' : ''}${formatPrice(Math.abs(n))}원`;

/** 오늘 제출한 결정 한 줄 요약 */
export function actionSummary(a: EduAction): string {
  const levels =
    a.stop_loss_price !== null || a.take_profit_price !== null
      ? ` · 손절 ${a.stop_loss_price !== null ? formatPrice(a.stop_loss_price) : '-'} / 익절 ${a.take_profit_price !== null ? formatPrice(a.take_profit_price) : '-'}`
      : '';
  switch (a.action_type) {
    case 'ENTER_LONG':
    case 'ENTER_SHORT': {
      const side = a.action_type === 'ENTER_LONG' ? '상승' : '하락';
      const ratio = a.ratio !== null ? ` · 비중 ${ratioLabel(a.ratio)}` : '';
      return `${side} 진입${ratio} · ${a.leverage}배 · ${formatPrice(a.execution_price)}원${levels}`;
    }
    case 'HOLD_WATCH':
      return '오늘 하루 관망';
    case 'KEEP_POS':
      return `포지션 유지${levels}`;
    case 'PARTIAL_CLOSE':
      return `50% 부분 청산 · ${formatPrice(a.execution_price)}원${a.realized_pnl !== null ? ` · 실현 ${signedWon(a.realized_pnl)}` : ''}`;
    case 'FULL_CLOSE':
      return `전량 청산 · ${formatPrice(a.execution_price)}원${a.realized_pnl !== null ? ` · 실현 ${signedWon(a.realized_pnl)}` : ''}`;
    default:
      return '오늘의 결정을 제출했어요';
  }
}

export type EduErrorInfo = {
  message: string;
  /** 403 edu_game_disabled — 교육 게임이 꺼짐(화면을 다시 받아 닫는다) */
  disabled: boolean;
  /** 409 등 서버가 상태를 거절 — 상태를 다시 받아 맞춘다 */
  stale: boolean;
  unauthorized: boolean;
};

/** ApiError(status, body) → 화면 문구. 서버 detail.message 는 그대로 보여 준다 */
export function eduErrorInfo(err: unknown): EduErrorInfo {
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : null;
  const detail = (err as { body?: { detail?: unknown } })?.body?.detail;
  if (detail === 'edu_game_disabled') {
    return { message: '지금은 종가 게임이 열려 있지 않아요.', disabled: true, stale: true, unauthorized: false };
  }
  const msg = typeof (detail as { message?: unknown })?.message === 'string' ? (detail as { message: string }).message : null;
  if (status === 401) {
    return { message: msg ?? '로그인이 필요해요. 다시 로그인해 주세요.', disabled: false, stale: false, unauthorized: true };
  }
  if (msg) return { message: msg, disabled: false, stale: status === 409, unauthorized: false };
  if (status !== null) return { message: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.', disabled: false, stale: status === 409, unauthorized: false };
  return { message: '게임 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.', disabled: false, stale: false, unauthorized: false };
}

/** 합성 캔들 → 차트 행(날짜 오름차순·중복 제거 — lightweight-charts 는 엄격 오름차순을 요구) */
export function eduChartRows(candles: EduCandle[]): { date: string; open: number; high: number; low: number; close: number; volume: number }[] {
  const byDate = new Map<string, EduCandle>();
  for (const c of [...candles].sort((a, b) => a.day_index - b.day_index)) byDate.set(c.date, c);
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((c) => ({ date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
}
