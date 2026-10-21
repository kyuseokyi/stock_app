import {
  initialRange,
  lastIndicatorValues,
  loadMessage,
  fitPrices,
  priceLines,
  tickMessage,
  toBars,
  toInjectScript,
  type Bar,
} from './chart-bridge';
import type { Coach, Position } from '../types';

const min = (t: number, close: number) => ({ t, open: close, high: close, low: close, close, volume: 0 });
const day = (date: string, close: number) => ({ date, open: close, high: close, low: close, close });

describe('toBars', () => {
  it('분봉은 같은 t 중복을 마지막 값으로 합치고 오름차순', () => {
    const bars = toBars({ kind: 'min', rows: [min(120, 2), min(60, 1), min(120, 3)] });
    expect(bars.map((b) => [b.time, b.close])).toEqual([
      [60, 1],
      [120, 3],
    ]);
  });
  it('일봉은 date 를 time 으로', () => {
    expect(toBars({ kind: 'day', rows: [day('2026-10-14', 10)] })[0].time).toBe('2026-10-14');
  });
});

describe('initialRange', () => {
  const now = Date.parse('2026-10-15T03:00:00Z');
  it('일봉: 180일 전 이후부터', () => {
    const bars: Bar[] = [
      { time: '2025-01-02', open: 1, high: 1, low: 1, close: 1 },
      { time: '2026-05-01', open: 1, high: 1, low: 1, close: 1 },
      { time: '2026-10-14', open: 1, high: 1, low: 1, close: 1 },
    ];
    expect(initialRange('day', bars, now)).toEqual({ from: 1, to: 2 });
  });
  it('일봉이 모두 최근이면 전체 맞춤', () => {
    expect(initialRange('day', [{ time: '2026-10-14', open: 1, high: 1, low: 1, close: 1 }], now)).toBe('fit');
  });
  it('분봉: 120개 넘으면 최근 120개, 아니면 전체, 없으면 null', () => {
    const many = toBars({ kind: 'min', rows: Array.from({ length: 150 }, (_, i) => min(i * 60, 1)) });
    expect(initialRange('min', many, now)).toEqual({ from: 30, to: 149 });
    expect(initialRange('min', many.slice(0, 10), now)).toBe('fit');
    expect(initialRange('min', [], now)).toBeNull();
  });
});

describe('지표', () => {
  it('load 는 기간 전 구간을 빼고 5일선은 5번째 봉부터', () => {
    const rows = Array.from({ length: 6 }, (_, i) => min(i * 60, i + 1));
    const msg = loadMessage({ kind: 'min', rows }, false);
    if (msg.type !== 'load') throw new Error('load 아님');
    expect(msg.ind.ma5).toEqual([
      { time: 240, value: 3 },
      { time: 300, value: 4 },
    ]);
    expect(msg.ind.ma20).toEqual([]);
    expect(msg.keepView).toBe(false);
  });
  it('lastIndicatorValues 는 계산 가능한 값만', () => {
    const bars = toBars({ kind: 'min', rows: Array.from({ length: 5 }, (_, i) => min(i * 60, 10)) });
    expect(lastIndicatorValues(bars)).toEqual({ ma5: 10 });
  });
  it('tick 은 마지막 막대, 데이터 없으면 null', () => {
    expect(tickMessage({ kind: 'min', rows: [] })).toBeNull();
    const msg = tickMessage({ kind: 'min', rows: [min(60, 1), min(120, 2)] });
    expect(msg).toMatchObject({ type: 'tick', bar: { time: 120, close: 2 } });
  });
});

describe('priceLines', () => {
  const colors = { up: 'U', down: 'D', muted: 'M' };
  it('코치 지지·저항 + 포지션 진입·손절·익절', () => {
    const coach = { support_price: 100, resistance_price: 200 } as Coach;
    const position = { side: 'SHORT', entry_price: 150, stop_loss_price: 160, take_profit_price: null } as unknown as Position;
    const lines = priceLines(coach, position, colors);
    expect(lines.map((l) => [l.title, l.price, l.color, l.width, l.dashed])).toEqual([
      ['지지', 100, '#8b5cf6', 1, true],
      ['저항', 200, '#f59e0b', 1, true],
      ['진입', 150, 'D', 2, false],
      ['손절', 160, 'M', 1, true],
    ]);
  });
  it('없으면 빈 배열', () => {
    expect(priceLines(null, null, colors)).toEqual([]);
  });
});

it('toInjectScript 는 window.__chart 호출 + true;', () => {
  expect(toInjectScript({ type: 'vis', ma: true, bb: false })).toBe(
    'window.__chart&&window.__chart({"type":"vis","ma":true,"bb":false});true;',
  );
});

describe('fitPrices', () => {
  const colors = { up: 'U', down: 'D', muted: 'M' };
  const coach = { support_price: 100, resistance_price: 200 } as Coach;
  const position = { side: 'LONG', entry_price: 150, stop_loss_price: 50, take_profit_price: 400 } as unknown as Position;
  const lines = priceLines(coach, position, colors);

  it('일봉은 지지·저항·진입, 분봉은 진입만(손절·익절은 항상 제외)', () => {
    expect(fitPrices(lines, 'day')).toEqual([100, 200, 150]);
    expect(fitPrices(lines, 'min')).toEqual([150]);
  });
  it('가격선이 없으면 빈 배열', () => {
    expect(fitPrices([], 'day')).toEqual([]);
  });
});

describe('이동평균 기간·첫 화면 일수 인자(종목 상세용)', () => {
  // 2026-01-01 부터 60일, 종가 1..60
  const iso = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
  const rows = Array.from({ length: 60 }, (_, i) => day(iso(i), i + 1));
  const NOW = Date.UTC(2026, 2, 1, 3); // KST 2026-03-01 12:00 = 마지막 봉 날짜

  it('기본값은 5·20·60 을 명시한 것과 같다(게임 화면 그대로)', () => {
    expect(loadMessage({ kind: 'day', rows }, false, NOW)).toEqual(
      loadMessage({ kind: 'day', rows }, false, NOW, { maPeriods: [5, 20, 60] }),
    );
  });
  it('[50] 이면 첫째 칸(ma5)에 50일선만, 둘째·셋째 칸은 빈 배열', () => {
    const msg = loadMessage({ kind: 'day', rows }, false, NOW, { maPeriods: [50] });
    if (msg.type !== 'load') throw new Error('load 아님');
    expect(msg.ind.ma5).toHaveLength(11);
    expect(msg.ind.ma5[0]).toEqual({ time: iso(49), value: 25.5 });
    expect(msg.ind.ma5[10]).toEqual({ time: iso(59), value: 35.5 });
    expect(msg.ind.ma20).toEqual([]);
    expect(msg.ind.ma60).toEqual([]);
    expect(msg.ind.bbUpper.length).toBeGreaterThan(0); // 볼린저는 그대로 계산(표시는 vis 로 끔)
  });
  it('마지막 값·틱도 같은 기간을 쓴다', () => {
    const bars = toBars({ kind: 'day', rows });
    const v = lastIndicatorValues(bars, [50]);
    expect(v.ma5).toBe(35.5);
    expect(v).not.toHaveProperty('ma20');
    expect(v).not.toHaveProperty('ma60');
    const tick = tickMessage({ kind: 'day', rows }, [50]);
    if (tick?.type !== 'tick') throw new Error('tick 아님');
    expect(tick.ind.ma5).toBe(35.5);
  });
  it('첫 화면 일수 — 기본 180일이면 전체 맞춤, 10일이면 최근 10일부터', () => {
    const bars = toBars({ kind: 'day', rows });
    expect(initialRange('day', bars, NOW)).toBe('fit');
    expect(initialRange('day', bars, NOW, 10)).toEqual({ from: 49, to: 59 }); // 2026-02-19 부터
  });
  it('loadMessage 도 visibleDays 를 첫 화면에 쓴다', () => {
    const msg = loadMessage({ kind: 'day', rows }, false, NOW, { visibleDays: 10 });
    if (msg.type !== 'load') throw new Error('load 아님');
    expect(msg.range).toEqual({ from: 49, to: 59 });
  });
});
