import { CHART_PAD_Y, layoutCandles, niceTicks, priceRange, priceToY } from './chart-layout';

const k = (open: number, high: number, low: number, close: number) => ({ open, high, low, close });

describe('priceRange', () => {
  test('저가 최소~고가 최대', () => {
    expect(priceRange([k(100, 110, 90, 105), k(105, 120, 100, 101)], [])).toEqual({ min: 90, max: 120 });
  });
  test('가격선(지지/저항/진입)이 범위 밖이면 포함하도록 확장, null 은 무시', () => {
    expect(priceRange([k(100, 110, 90, 105)], [80, null, 130])).toEqual({ min: 80, max: 130 });
  });
  test('NaN/Infinity 가격선은 무시', () => {
    expect(priceRange([k(100, 110, 90, 105)], [Number.NaN, Number.POSITIVE_INFINITY])).toEqual({ min: 90, max: 110 });
  });
  test('평평한 차트(min=max) → ±1 확장(0 나누기 방지)', () => {
    expect(priceRange([k(100, 100, 100, 100)], [])).toEqual({ min: 99, max: 101 });
  });
  test('캔들 없음 → null(가격선만 있어도 null)', () => {
    expect(priceRange([], [])).toBeNull();
    expect(priceRange([], [100])).toBeNull();
  });
});

describe('priceToY', () => {
  const range = { min: 100, max: 200 };
  test('max → 위쪽 패딩, min → 아래쪽 패딩', () => {
    expect(priceToY(200, range, 216)).toBe(CHART_PAD_Y);
    expect(priceToY(100, range, 216)).toBe(216 - CHART_PAD_Y);
  });
  test('중간 가격 → 가운데(선형)', () => {
    expect(priceToY(150, range, 216)).toBe(108);
  });
  test('패딩 지정', () => {
    expect(priceToY(200, range, 100, 0)).toBe(0);
    expect(priceToY(100, range, 100, 0)).toBe(100);
  });
});

describe('layoutCandles', () => {
  test('빈 입력 또는 폭/높이 0 이하 → null', () => {
    expect(layoutCandles([], 300, 200)).toBeNull();
    expect(layoutCandles([k(1, 2, 0, 1)], 0, 200)).toBeNull();
    expect(layoutCandles([k(1, 2, 0, 1)], 300, 0)).toBeNull();
  });
  test('슬롯 폭 = width / n, 몸통은 슬롯 중앙 60%, 꼬리는 1px 중앙', () => {
    const out = layoutCandles([k(100, 110, 90, 105), k(105, 110, 90, 95)], 200, 216);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.slot).toBe(100);
    const [a, b] = out.bars;
    expect(a.bodyWidth).toBe(60);
    expect(a.bodyLeft).toBe(20);
    expect(b.bodyLeft).toBe(120);
    expect(a.wickLeft).toBe(49.5);
    expect(b.wickLeft).toBe(149.5);
  });
  test('상승(close>=open)/하락 판정과 y 좌표(몸통=open·close, 꼬리=high·low)', () => {
    // range 90~110, height 216, pad 8 → 1원 = 10px, y(110)=8, y(90)=208
    const out = layoutCandles([k(100, 110, 90, 105), k(105, 110, 90, 95), k(100, 100, 100, 100)], 300, 216);
    if (out === null) throw new Error('layout null');
    const [up, down, flat] = out.bars;
    expect(up.rising).toBe(true);
    expect(up.bodyTop).toBe(58); // y(105)
    expect(up.bodyHeight).toBe(50); // y(100)-y(105)
    expect(up.wickTop).toBe(8);
    expect(up.wickHeight).toBe(200);
    expect(down.rising).toBe(false);
    expect(down.bodyTop).toBe(58); // y(105) — 하락은 open 이 위
    expect(down.bodyHeight).toBe(100); // y(95)-y(105)
    expect(flat.rising).toBe(true);
    expect(flat.bodyHeight).toBe(1); // 시가=종가여도 최소 1px
  });
  test('슬롯이 좁아도 몸통 최소 1px', () => {
    const many = Array.from({ length: 60 }, () => k(100, 110, 90, 105));
    const out = layoutCandles(many, 30, 100);
    if (out === null) throw new Error('layout null');
    expect(out.bars).toHaveLength(60);
    expect(out.bars[0].bodyWidth).toBe(1);
  });
  test('가격선 포함 범위가 결과 range 에 반영', () => {
    const out = layoutCandles([k(100, 110, 90, 105)], 100, 100, [150]);
    expect(out?.range).toEqual({ min: 90, max: 150 });
  });
});

describe('niceTicks — 오른쪽 가격축 눈금', () => {
  test('1·2·2.5·5 ×10ⁿ 간격, 범위 안 값만', () => {
    expect(niceTicks(189_200, 372_427)).toEqual([200_000, 250_000, 300_000, 350_000]);
    expect(niceTicks(209_000, 236_000)).toEqual([210_000, 215_000, 220_000, 225_000, 230_000, 235_000]);
  });

  test('범위가 0 이하·뒤집힘이면 빈 배열', () => {
    expect(niceTicks(100, 100)).toEqual([]);
    expect(niceTicks(200, 100)).toEqual([]);
  });

  test('작은 가격대도 정수 눈금', () => {
    expect(niceTicks(1_020, 1_180)).toEqual([1_050, 1_100, 1_150]);
  });
});
