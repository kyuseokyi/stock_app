// 게임 차트 RN ↔ WebView(lightweight-charts) 메시지 — 순수 함수.
// 메시지는 "라이브러리 호출"이 아니라 "데이터"(캔들·지표·가격선·표시 여부)만 담는다.
// → 나중에 차트 엔진을 바꿔도(TradingView Advanced Charts 등) WebView 쪽만 갈아 끼우면 된다.
import { kstDateString } from './format';
import { bollinger, MA_PERIODS, sma } from './indicators';
import type { Coach, DailyCandle, IntradayCandle, Position } from '../types';

export type ChartMode = 'day' | 'min';
/** 일봉 = 'YYYY-MM-DD', 분봉 = 버킷 시작 UTC epoch seconds(웹 TradingChart 와 같은 형식) */
export type BarTime = string | number;
export interface Bar {
  time: BarTime;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface LinePoint {
  time: BarTime;
  value: number;
}
export type IndicatorKey = 'ma5' | 'ma20' | 'ma60' | 'bbUpper' | 'bbMiddle' | 'bbLower';
export type IndicatorData = Record<IndicatorKey, LinePoint[]>;

export type ChartRows = { kind: 'day'; rows: DailyCandle[] } | { kind: 'min'; rows: IntradayCandle[] };

export interface ChartColors {
  up: string;
  down: string;
  text: string;
  grid: string;
  border: string;
}
export interface ChartLine {
  price: number;
  color: string;
  width: 1 | 2;
  dashed: boolean;
  title: string;
}
/** 첫 화면 구간 — 논리 인덱스 범위, 'fit' = 전체 맞춤, null = 데이터 없음 */
export type VisibleRange = { from: number; to: number } | 'fit' | null;

export type ChartMessage =
  | { type: 'init'; colors: ChartColors }
  | { type: 'load'; mode: ChartMode; bars: Bar[]; ind: IndicatorData; range: VisibleRange; keepView: boolean }
  | { type: 'tick'; bar: Bar; ind: Partial<Record<IndicatorKey, number>> }
  | { type: 'lines'; lines: ChartLine[] }
  | { type: 'vis'; ma: boolean; bb: boolean };

export const DAILY_VISIBLE_DAYS = 180; // 일봉 첫 화면(앞쪽은 지표 워밍업 — 왼쪽으로 끌면 보임). 웹과 같은 값
export const INTRADAY_VISIBLE_BARS = 120; // 분봉 첫 화면 캔들 수. 웹과 같은 값

export const SUPPORT_COLOR = '#8b5cf6';
export const RESIST_COLOR = '#f59e0b';
export const TAKE_PROFIT_COLOR = '#16a34a';

/** 캔들 → 차트 막대. 분봉은 같은 t 중복 제거 + 오름차순(lightweight-charts 는 엄격 오름차순 요구) */
export function toBars(data: ChartRows): Bar[] {
  if (data.kind === 'day') {
    return data.rows.map((c) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close }));
  }
  const byT = new Map<number, IntradayCandle>();
  for (const c of data.rows) byT.set(c.t, c);
  return [...byT.values()]
    .sort((a, b) => a.t - b.t)
    .map((c) => ({ time: c.t, open: c.open, high: c.high, low: c.low, close: c.close }));
}

/** 종가로 지표 전체 계산(값이 없는 앞 구간은 점을 빼서 선이 그 지점부터 시작) */
export function indicatorData(bars: Bar[]): IndicatorData {
  const closes = bars.map((b) => b.close);
  const line = (values: (number | null)[]): LinePoint[] =>
    values.flatMap((v, i) => (v === null ? [] : [{ time: bars[i].time, value: v }]));
  const bands = bollinger(closes);
  const [p5, p20, p60] = MA_PERIODS;
  return {
    ma5: line(sma(closes, p5)),
    ma20: line(sma(closes, p20)),
    ma60: line(sma(closes, p60)),
    bbUpper: line(bands.map((b) => b?.upper ?? null)),
    bbMiddle: line(bands.map((b) => b?.middle ?? null)),
    bbLower: line(bands.map((b) => b?.lower ?? null)),
  };
}

/** 마지막 막대의 지표 값만(틱마다 전체 setData 대신 update — 스크롤 위치가 흔들리지 않게) */
export function lastIndicatorValues(bars: Bar[]): Partial<Record<IndicatorKey, number>> {
  const n = bars.length;
  if (n === 0) return {};
  const closes = bars.map((b) => b.close);
  const out: Partial<Record<IndicatorKey, number>> = {};
  const [p5, p20, p60] = MA_PERIODS;
  const pick = (k: IndicatorKey, v: number | null | undefined) => {
    if (v != null) out[k] = v;
  };
  pick('ma5', sma(closes, p5)[n - 1]);
  pick('ma20', sma(closes, p20)[n - 1]);
  pick('ma60', sma(closes, p60)[n - 1]);
  const b = bollinger(closes)[n - 1];
  pick('bbUpper', b?.upper);
  pick('bbMiddle', b?.middle);
  pick('bbLower', b?.lower);
  return out;
}

/** 첫 화면 구간 — 일봉: 최근 180일, 분봉: 최근 120개(웹 TradingChart 와 같은 규칙) */
export function initialRange(mode: ChartMode, bars: Bar[], nowMs: number = Date.now()): VisibleRange {
  const n = bars.length;
  if (n === 0) return null;
  if (mode === 'day') {
    const from = kstDateString(new Date(nowMs - DAILY_VISIBLE_DAYS * 86_400_000));
    const hidden = bars.findIndex((b) => String(b.time) >= from);
    return hidden > 0 ? { from: hidden, to: n - 1 } : 'fit';
  }
  return n > INTRADAY_VISIBLE_BARS ? { from: n - INTRADAY_VISIBLE_BARS, to: n - 1 } : 'fit';
}

/** 전체 로드 메시지. keepView=true 면(같은 단위 재조회) 사용자가 보던 위치 유지 */
export function loadMessage(data: ChartRows, keepView: boolean, nowMs: number = Date.now()): ChartMessage {
  const bars = toBars(data);
  return { type: 'load', mode: data.kind, bars, ind: indicatorData(bars), range: initialRange(data.kind, bars, nowMs), keepView };
}

/** 틱 메시지 — 마지막 막대 + 그 지표 값. 데이터가 없으면 null */
export function tickMessage(data: ChartRows): ChartMessage | null {
  const bars = toBars(data);
  if (bars.length === 0) return null;
  return { type: 'tick', bar: bars[bars.length - 1], ind: lastIndicatorValues(bars) };
}

/** 지지/저항/진입가/손절/익절 가격선(웹 TradingChart 와 같은 색·굵기·점선) */
export function priceLines(
  coach: Coach | null,
  position: Position | null,
  colors: { up: string; down: string; muted: string },
): ChartLine[] {
  const out: ChartLine[] = [];
  if (coach?.support_price != null) {
    out.push({ price: coach.support_price, color: SUPPORT_COLOR, width: 1, dashed: true, title: '지지' });
  }
  if (coach?.resistance_price != null) {
    out.push({ price: coach.resistance_price, color: RESIST_COLOR, width: 1, dashed: true, title: '저항' });
  }
  if (position) {
    out.push({
      price: position.entry_price,
      color: position.side === 'LONG' ? colors.up : colors.down,
      width: 2,
      dashed: false,
      title: '진입',
    });
    if (position.stop_loss_price != null) {
      out.push({ price: position.stop_loss_price, color: colors.muted, width: 1, dashed: true, title: '손절' });
    }
    if (position.take_profit_price != null) {
      out.push({ price: position.take_profit_price, color: TAKE_PROFIT_COLOR, width: 1, dashed: true, title: '익절' });
    }
  }
  return out;
}

/** injectJavaScript 로 넣을 코드 — 페이지의 window.__chart 로 전달(끝의 true; 는 Android 경고 방지) */
export const toInjectScript = (msg: ChartMessage): string =>
  `window.__chart&&window.__chart(${JSON.stringify(msg)});true;`;
