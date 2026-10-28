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
  /** 거래량(매물대용, 없으면 0) */
  volume: number;
}
export interface LinePoint {
  time: BarTime;
  value: number;
}
// ma5·ma20·ma60 은 "첫째·둘째·셋째 이동평균 칸" 이름이다(기본 5·20·60일, maPeriods 로 기간을 바꿔도 칸 이름은 그대로)
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
  /** 점선(Dotted) — 마지막 캔들이 닿은 지표 가로선. dashed 보다 우선 */
  dotted?: boolean;
  title: string;
  /**
   * 자동 범위(가격축)에 넣을지 — 'always'=항상(진입가), 'day'=일봉에서만(지지·저항: 분봉은 변동폭이 작아 캔들이 납작해짐),
   * 없음=넣지 않음(손절·익절은 멀 수 있음). lightweight-charts 4 의 가격선은 자동 범위에 들어가지 않는다.
   */
  fit?: 'always' | 'day';
}

export interface TrendLineData {
  color: string;
  points: { time: BarTime; value: number }[];
}

/** 자동 범위에 넣을 가격 — 페이지(chart-page.ts autoscaleInfoProvider)의 같은 규칙 */
export function fitPrices(lines: ChartLine[], mode: ChartMode): number[] {
  return lines
    .filter((l) => l.fit === 'always' || (l.fit === 'day' && mode === 'day'))
    .map((l) => l.price)
    .filter(Number.isFinite);
}
/** 첫 화면 구간 — 논리 인덱스 범위, 'fit' = 전체 맞춤, null = 데이터 없음 */
export type VisibleRange = { from: number; to: number } | 'fit' | null;

export type ChartMessage =
  | { type: 'init'; colors: ChartColors }
  | {
      type: 'load';
      mode: ChartMode;
      bars: Bar[];
      ind: IndicatorData;
      range: VisibleRange;
      keepView: boolean;
      /** 앞에 붙인 과거 캔들 수 — 0 보다 크면 보던 캔들이 그대로 보이게 화면을 그만큼 옮긴다 */
      prepended?: number;
      /** 일봉 왼쪽 끝 과거 이어 받기 — 켜면 페이지가 끝에 닿을 때 {type:'needOlder'} 를 보낸다 */
      history?: boolean;
    }
  /** 과거 요청 결과 — more=false(더 없음)면 왼쪽 끝 고정, true 는 다시 요청 가능(실패 등) */
  | { type: 'older'; more: boolean }
  | { type: 'tick'; bar: Bar; ind: Partial<Record<IndicatorKey, number>> }
  | { type: 'lines'; lines: ChartLine[] }
  /** 지지·저항 수평선(최대 2개, 순서 = 저항·지지). 없는 선은 points 가 빈 배열 */
  | { type: 'trend'; lines: TrendLineData[] }
  | { type: 'vis'; ma: boolean; bb: boolean; vp: boolean };

/** 페이지 → RN 메시지 — 준비됨 / 일봉 왼쪽 끝(과거 요청) / 보이는 구간 매물대 POC 변경(끄면 null) / 처리 중 오류 */
export type PageEvent =
  | { type: 'ready' }
  | { type: 'needOlder' }
  | { type: 'poc'; price: number | null }
  | { type: 'error'; message: string };

/** 이동평균 기간(최대 3칸, 앞에서부터 ma5·ma20·ma60 칸에 들어감). 기본은 게임과 같은 MA_PERIODS(5·20·60) */
export type MaPeriods = readonly number[];
/** 전체 로드 선택 인자 — 종목 상세는 [50]·365일, 게임은 생략(기본값) */
export interface LoadOptions {
  maPeriods?: MaPeriods;
  visibleDays?: number;
  prepended?: number;
  history?: boolean;
}

export const DAILY_VISIBLE_DAYS = 180; // 일봉 첫 화면(앞쪽은 지표 워밍업 — 왼쪽으로 끌면 보임). 웹과 같은 값
export const INTRADAY_VISIBLE_BARS = 120; // 분봉 첫 화면 캔들 수. 웹과 같은 값

export const SUPPORT_COLOR = '#8b5cf6';
export const RESIST_COLOR = '#f59e0b';
export const TAKE_PROFIT_COLOR = '#16a34a';

/** 캔들 → 차트 막대. 분봉은 같은 t 중복 제거 + 오름차순(lightweight-charts 는 엄격 오름차순 요구) */
export function toBars(data: ChartRows): Bar[] {
  if (data.kind === 'day') {
    return data.rows.map((c) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }));
  }
  const byT = new Map<number, IntradayCandle>();
  for (const c of data.rows) byT.set(c.t, c);
  return [...byT.values()]
    .sort((a, b) => a.t - b.t)
    .map((c) => ({ time: c.t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
}

/** 종가로 지표 전체 계산(값이 없는 앞 구간은 점을 빼서 선이 그 지점부터 시작). 기간이 없는 칸은 빈 배열 */
export function indicatorData(bars: Bar[], maPeriods: MaPeriods = MA_PERIODS): IndicatorData {
  const closes = bars.map((b) => b.close);
  const line = (values: (number | null)[]): LinePoint[] =>
    values.flatMap((v, i) => (v === null ? [] : [{ time: bars[i].time, value: v }]));
  const ma = (slot: number): LinePoint[] => {
    const p = maPeriods[slot];
    return p ? line(sma(closes, p)) : [];
  };
  const bands = bollinger(closes);
  return {
    ma5: ma(0),
    ma20: ma(1),
    ma60: ma(2),
    bbUpper: line(bands.map((b) => b?.upper ?? null)),
    bbMiddle: line(bands.map((b) => b?.middle ?? null)),
    bbLower: line(bands.map((b) => b?.lower ?? null)),
  };
}

/** 마지막 막대의 지표 값만(틱마다 전체 setData 대신 update — 스크롤 위치가 흔들리지 않게) */
export function lastIndicatorValues(bars: Bar[], maPeriods: MaPeriods = MA_PERIODS): Partial<Record<IndicatorKey, number>> {
  const n = bars.length;
  if (n === 0) return {};
  const closes = bars.map((b) => b.close);
  const out: Partial<Record<IndicatorKey, number>> = {};
  const pick = (k: IndicatorKey, v: number | null | undefined) => {
    if (v != null) out[k] = v;
  };
  const maAt = (slot: number): number | null => {
    const p = maPeriods[slot];
    return p ? sma(closes, p)[n - 1] : null;
  };
  pick('ma5', maAt(0));
  pick('ma20', maAt(1));
  pick('ma60', maAt(2));
  const b = bollinger(closes)[n - 1];
  pick('bbUpper', b?.upper);
  pick('bbMiddle', b?.middle);
  pick('bbLower', b?.lower);
  return out;
}

/** 첫 화면 구간 — 일봉: 최근 visibleDays 일(기본 180), 분봉: 최근 120개(웹 TradingChart 와 같은 규칙) */
export function initialRange(
  mode: ChartMode,
  bars: Bar[],
  nowMs: number = Date.now(),
  visibleDays: number = DAILY_VISIBLE_DAYS,
): VisibleRange {
  const n = bars.length;
  if (n === 0) return null;
  if (mode === 'day') {
    const from = kstDateString(new Date(nowMs - visibleDays * 86_400_000));
    const hidden = bars.findIndex((b) => String(b.time) >= from);
    return hidden > 0 ? { from: hidden, to: n - 1 } : 'fit';
  }
  return n > INTRADAY_VISIBLE_BARS ? { from: n - INTRADAY_VISIBLE_BARS, to: n - 1 } : 'fit';
}

/** 전체 로드 메시지. keepView=true 면(같은 단위 재조회) 사용자가 보던 위치 유지 */
export function loadMessage(
  data: ChartRows,
  keepView: boolean,
  nowMs: number = Date.now(),
  opts: LoadOptions = {},
): ChartMessage {
  const bars = toBars(data);
  return {
    type: 'load',
    mode: data.kind,
    bars,
    ind: indicatorData(bars, opts.maPeriods),
    range: initialRange(data.kind, bars, nowMs, opts.visibleDays),
    keepView,
    prepended: opts.prepended ?? 0,
    history: opts.history === true && data.kind === 'day',
  };
}

/** 틱 메시지 — 마지막 막대 + 그 지표 값. 데이터가 없으면 null */
export function tickMessage(data: ChartRows, maPeriods: MaPeriods = MA_PERIODS): ChartMessage | null {
  const bars = toBars(data);
  if (bars.length === 0) return null;
  return { type: 'tick', bar: bars[bars.length - 1], ind: lastIndicatorValues(bars, maPeriods) };
}

/** 지지/저항/진입가/손절/익절 가격선(웹 TradingChart 와 같은 색·굵기·점선) */
export function priceLines(
  coach: Coach | null,
  position: Position | null,
  colors: { up: string; down: string; muted: string },
): ChartLine[] {
  const out: ChartLine[] = [];
  if (coach?.support_price != null) {
    out.push({ price: coach.support_price, color: SUPPORT_COLOR, width: 1, dashed: true, title: '지지', fit: 'day' });
  }
  if (coach?.resistance_price != null) {
    out.push({ price: coach.resistance_price, color: RESIST_COLOR, width: 1, dashed: true, title: '저항', fit: 'day' });
  }
  if (position) {
    out.push({
      price: position.entry_price,
      color: position.side === 'LONG' ? colors.up : colors.down,
      width: 2,
      dashed: false,
      title: '진입',
      fit: 'always',
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

/** 과거 행 + 기존 행 — 날짜가 겹치면 기존 것을 남긴다(오름차순 유지). 웹 lib/historyScroll 과 같은 규칙 */
export function mergeOlder<T extends { date: string }>(older: T[], rows: T[]): T[] {
  const first = rows[0]?.date;
  return [...older.filter((c) => first === undefined || c.date < first), ...rows];
}

/** injectJavaScript 로 넣을 코드 — 페이지의 window.__chart 로 전달(끝의 true; 는 Android 경고 방지) */
export const toInjectScript = (msg: ChartMessage): string =>
  `window.__chart&&window.__chart(${JSON.stringify(msg)});true;`;
