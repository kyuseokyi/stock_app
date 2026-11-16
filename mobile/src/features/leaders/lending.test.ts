import { formatChgPct, formatShares, lendingView, normalizeLending } from './lending';

const row = (date: string, balance_qty: unknown, net_qty: unknown = 0, balance_amt: unknown = 0) => ({
  date,
  balance_qty,
  net_qty,
  balance_amt,
});
const p = (date: string, balanceQty: number, netQty = 0) => ({ date, balanceQty, netQty, balanceAmt: 0 });

describe('normalizeLending', () => {
  it('오래된 순·날짜당 1행, 잘못된 행은 버린다', () => {
    const out = normalizeLending([
      row('2026-11-13', 98242435, -1482754, 5452455000000),
      row('2026-11-12', '99725189', '-520696', '5564666000000'),
      row('20261111', 1),
      row('2026-11-10', null),
      'x',
      null,
    ]);
    expect(out).toEqual([
      { date: '2026-11-12', balanceQty: 99725189, netQty: -520696, balanceAmt: 5564666000000 },
      { date: '2026-11-13', balanceQty: 98242435, netQty: -1482754, balanceAmt: 5452455000000 },
    ]);
  });

  it('배열이 아니면 빈 목록', () => {
    expect(normalizeLending(undefined)).toEqual([]);
    expect(normalizeLending({})).toEqual([]);
  });
});

describe('lendingView (섹션 숨김 조건·좌표)', () => {
  it('데이터 없음·1점·잔고 전부 0이면 null(숨김)', () => {
    expect(lendingView([])).toBeNull();
    expect(lendingView([p('2026-11-13', 100)])).toBeNull();
    expect(lendingView([p('2026-11-12', 0), p('2026-11-13', 0)])).toBeNull();
  });

  it('잔고 선·증감 막대·증감률', () => {
    const v = lendingView([p('2026-11-12', 1000, 200), p('2026-11-13', 800, -200)], 240, 64)!;
    expect(v.chgPct).toBeCloseTo(-20);
    const [a, b] = v.line.split(' ').map((s) => s.split(',').map(Number));
    expect(a[0]).toBe(60);
    expect(a[1]).toBeLessThan(b[1]);
    expect(v.bars.map((x) => x.up)).toEqual([true, false]);
    expect(v.bars[1].y).toBeCloseTo(v.zeroY, 0);
  });

  it('첫날 잔고 0이면 증감률 null', () => {
    expect(lendingView([p('2026-11-12', 0), p('2026-11-13', 10)])!.chgPct).toBeNull();
  });
});

describe('표기', () => {
  it('formatShares·formatChgPct', () => {
    expect(formatShares(98242435)).toBe('9,824.2만 주');
    expect(formatShares(123456789)).toBe('1.2억 주');
    expect(formatShares(-1482754)).toBe('-148.3만 주');
    expect(formatChgPct(-20)).toBe('-20.0%');
    expect(formatChgPct(1.25)).toBe('+1.3%');
  });
});
