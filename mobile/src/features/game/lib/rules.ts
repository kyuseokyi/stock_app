// 게임 규칙 화면(rules-sheet)·주문 패널 안내용 순수 함수. 숫자는 모두 GET /api/game/rules 값에서 만든다(하드코딩 금지).
import type { GameRules, Season } from '../types';
import { isChartInterval } from './intraday';
import { normalizeRewardConfig } from './ranking-period';
import { formatKstShort, formatRewardWon } from './weekly';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isHm = (v: unknown): v is string => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

/** 응답 검증 — 핵심 숫자가 빠지거나 틀리면 throw(화면은 "불러오지 못했어요" + 다시 시도). 보상은 필드별 기본값 */
export function normalizeGameRules(raw: unknown): GameRules {
  if (!isObj(raw)) throw new Error('규칙 응답 형식 오류');
  const req = (k: string): number => {
    const n = num(raw[k]);
    if (n === null) throw new Error(`규칙 응답 형식 오류: ${k}`);
    return n;
  };
  const windows = Array.isArray(raw.trading_windows)
    ? raw.trading_windows.filter(
        (w): w is [string, string] => Array.isArray(w) && w.length === 2 && isHm(w[0]) && isHm(w[1]),
      )
    : [];
  const leverages = Array.isArray(raw.leverages)
    ? raw.leverages.filter((l): l is number => num(l) !== null && (l as number) > 0)
    : [];
  if (leverages.length === 0) throw new Error('규칙 응답 형식 오류: leverages');
  const unlock: Record<string, string> = {};
  if (isObj(raw.leverage_unlock)) {
    for (const [k, v] of Object.entries(raw.leverage_unlock)) if (typeof v === 'string') unlock[k] = v;
  }
  // 차트 단위(선택 필드) — 모르는 값은 버린다. 기본값이 없거나 틀리면 화면이 일봉으로 시작
  const intervals = Array.isArray(raw.chart_intervals) ? raw.chart_intervals.filter(isChartInterval) : null;
  const chartDefault = isChartInterval(raw.chart_interval_default) ? raw.chart_interval_default : null;
  return {
    ...(chartDefault ? { chart_interval_default: chartDefault } : {}),
    ...(intervals ? { chart_intervals: intervals } : {}),
    ...(raw.partial_close === true ? { partial_close: true } : {}),
    initial_cash: req('initial_cash'),
    min_order_amount: req('min_order_amount'),
    max_open_positions: req('max_open_positions'),
    trading_windows: windows,
    leverages,
    leverage_unlock: unlock,
    fee_roundtrip_pct: req('fee_roundtrip_pct'),
    margin_call_roi_pct: req('margin_call_roi_pct'),
    sentiment_interval_sec: req('sentiment_interval_sec'),
    rewards: normalizeRewardConfig(raw.rewards),
  };
}

/** 퍼센트 숫자 — 소수 최대 2자리, 끝의 0 제거. 음수는 '−'(U+2212). 예: 0.03 → "0.03", -16 → "−16", 2.5 → "2.5" */
export function pctText(n: number): string {
  const abs = Math.abs(Math.round(n * 100) / 100);
  const s = String(abs);
  return n < 0 && abs !== 0 ? `−${s}` : s;
}

/** 부호 있는 퍼센트 — 예: 2 → "+2%", -5 → "−5%" */
export const signedPctText = (n: number): string => (n > 0 ? `+${pctText(n)}%` : `${pctText(n)}%`);

/** 수수료 — "0.03%" */
export const feeText = (rules: Pick<GameRules, 'fee_roundtrip_pct'>): string => `${pctText(rules.fee_roundtrip_pct)}%`;

/** 주문 패널 안내 줄 — "수수료 0.03% 포함 · 규칙 보기". 규칙 로드 전이면 "규칙 보기" */
export const orderRulesHint = (rules: Pick<GameRules, 'fee_roundtrip_pct'> | null): string =>
  rules ? `수수료 ${feeText(rules)} 포함 · 규칙 보기` : '규칙 보기';

/** 거래 시간 — "09:00~15:30 · 16:00~20:00" (없으면 '—') */
export const tradingWindowsText = (windows: [string, string][]): string =>
  windows.length === 0
    ? '—'
    : `평일 ${windows.map(([s, e]) => `${s}~${e}`).join(' · ')} (공휴일·대체공휴일·연말 휴장 제외)`; // 서버 거래일 달력과 같은 기준

/** 배율 표기 — [1,2,5] → "1배·2배·5배" */
export const leveragesText = (leverages: number[]): string => leverages.map((l) => `${l}배`).join('·');

/** 배율별 자동 청산되는 주가 변동 = margin_call_roi_pct / 배율 → "1배 약 −80% · 2배 −40% · 5배 −16%" */
export function liquidationMovesText(rules: Pick<GameRules, 'leverages' | 'margin_call_roi_pct'>): string {
  return rules.leverages
    .map((l, i) => `${l}배 ${i === 0 ? '약 ' : ''}${pctText(rules.margin_call_roi_pct / l)}%`)
    .join(' · ');
}

/** 예시 표 — 주가 move% 움직일 때 배율별 손익(수수료 제외). 예: move=1 → [{1,'+1%'},{2,'+2%'},{5,'+5%'}] */
export function leverageExampleRows(leverages: number[], move: number): { leverage: number; pnl: string }[] {
  return leverages.map((l) => ({ leverage: l, pnl: signedPctText(move * l) }));
}

/** 해금 조건이 있는 배율 안내 — {"5":"academy"} → "5배는 아카데미 통과 후 쓸 수 있어요" (없으면 null) */
export function leverageUnlockText(unlock: Record<string, string>): string | null {
  const names: Record<string, string> = { academy: '아카데미 통과' };
  const parts = Object.entries(unlock).map(([l, cond]) => `${l}배는 ${names[cond] ?? cond} 후`);
  return parts.length === 0 ? null : `${parts.join(', ')} 쓸 수 있어요`;
}

/** 손절이 자동 청산보다 늦는 조합(주가 sl × 배율 ≥ |자동 청산 수익률|) — "5배 손절 −20%" (없으면 null). sl 은 분수(0.2=20%) */
export function slPreemptedText(
  rules: Pick<GameRules, 'leverages' | 'margin_call_roi_pct'>,
  stopLossPcts: readonly number[],
): string | null {
  const limit = Math.abs(rules.margin_call_roi_pct);
  const parts: string[] = [];
  for (const l of rules.leverages) {
    const sls = stopLossPcts.filter((sl) => Math.round(sl * 100 * l * 100) / 100 >= limit);
    if (sls.length > 0) parts.push(`${l}배 손절 ${sls.map((sl) => `${pctText(-sl * 100)}%`).join('·')}`);
  }
  return parts.length === 0 ? null : parts.join(', ');
}

/** 시즌 기간 — "월간 시즌 · 10/31(토) 15:30 종료" (종료일 없으면 기간만). period 없으면 월간 */
export function seasonPeriodText(season: Pick<Season, 'period' | 'end_at'>): string {
  const kind = season.period === 'quarter' ? '분기 시즌(3개월)' : '월간 시즌(1개월)';
  return season.end_at ? `${kind} · ${formatKstShort(season.end_at)} 종료` : kind;
}

/** 연속 출석 보상 — "3일 100,000원 · 7일 300,000원 …" (일수 오름차순) */
export function streakRewardsText(streak: Record<string, number>): string {
  return Object.entries(streak)
    .filter(([d]) => Number.isFinite(Number(d)))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, amt]) => `${d}일 ${formatRewardWon(amt)}`)
    .join(' · ');
}
