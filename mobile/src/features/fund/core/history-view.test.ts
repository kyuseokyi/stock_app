import type { FundHistory, HistoryPoint } from './history';
import { toHistoryView } from './history-view';

const p = (date: string, value: number | null, day: number | null = 0, month: number | null = 0): HistoryPoint => ({
  date, value, day, month, recordedAt: 1,
});
const h = (accounts: FundHistory['accounts']): FundHistory => ({ v: 1, url: 'u', accounts });

describe('toHistoryView', () => {
  it('계좌 목록·선택 — 없는 계좌면 첫 계좌', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', 1)], B: [] }), 'Z', 'all');
    expect(v.accounts).toEqual(['A', 'B']);
    expect(v.account).toBe('A');
  });

  it('목록은 최신이 위, B안 포맷(쉼표·원·부호·색)', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', 1000, 0, 5), p('2026-10-02', 12345000, -15000, 410000)] }), 'A', 'all');
    expect(v.rows[0].date).toBe('2026.10.02');
    expect(v.rows[0].value).toMatchObject({ text: '12,345,000', unit: '원', tone: '' });
    expect(v.rows[0].day).toMatchObject({ text: '−15,000', unit: '원', tone: 'down' });
    expect(v.rows[0].month).toMatchObject({ text: '+410,000', tone: 'up' });
    expect(v.rows[1].day).toMatchObject({ text: '0', tone: 'zero' });
    expect(v.total).toBe(2);
  });

  it('값이 없으면 대시', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', null, null, null)] }), 'A', 'all');
    expect(v.rows[0].value.text).toBe('—');
    expect(v.chart).toBeNull();
  });

  it('기간은 마지막 기록 날짜 기준(문자열 비교)', () => {
    const pts = [p('2026-06-01', 1), p('2026-08-15', 2), p('2026-09-20', 3), p('2026-10-19', 4)];
    expect(toHistoryView(h({ A: pts }), 'A', '1m').rows.map((r) => r.date)).toEqual(['2026.10.19', '2026.09.20']);
    expect(toHistoryView(h({ A: pts }), 'A', '3m').rows).toHaveLength(3);
    expect(toHistoryView(h({ A: pts }), 'A', 'all').rows).toHaveLength(4);
  });

  // 당일 손익 막대 — p(date, value, day). 좌표는 0..1(1=위), 0원 기준선 zero
  const days = (...ds: (number | null)[]) => ds.map((d, i) => p(`2026-10-${String(i + 1).padStart(2, '0')}`, 1000, d));

  it('차트 — 당일 손익금 막대(누적 평가금이 아니라), 0원 기준선 위아래', () => {
    const v = toHistoryView(h({ A: days(100, -100, 300, 0, -200) }), 'A', 'all');
    const c = v.chart!;
    expect(c.zero).toBeCloseTo(0.4); // 범위 -200..300 → 0원은 아래에서 40%
    expect(c.bars.map((b) => b.tone)).toEqual(['up', 'down', 'up', 'zero', 'down']);
    expect(c.bars[2]).toMatchObject({ from: c.zero, to: 1 }); // 최고 +300 은 맨 위까지
    expect(c.bars[4].to).toBeCloseTo(0); // 최저 −200 은 맨 아래까지
    expect(c.bars[0].x).toBeCloseTo(0.1); // 5칸의 가운데
    expect(c.bars[4].x).toBeCloseTo(0.9);
    expect(c.max).toMatchObject({ text: '+300', tone: 'up' });
    expect(c.min).toMatchObject({ text: '−200', tone: 'down' });
    expect(c.start).toBe('2026.10.01');
    expect(c.end).toBe('2026.10.05');
    expect(v.chartNeed).toBe(0);
  });

  it('모두 수익이어도 0원 기준선은 맨 아래(막대가 바닥에서 시작)', () => {
    const c = toHistoryView(h({ A: days(10, 20, 30, 40, 50) }), 'A', 'all').chart!;
    expect(c.zero).toBe(0);
    expect(c.bars[4]).toMatchObject({ from: 0, to: 1 });
  });

  it('모두 0원이면 가운데 기준선', () => {
    const c = toHistoryView(h({ A: days(0, 0, 0, 0, 0) }), 'A', 'all').chart!;
    expect(c.zero).toBe(0.5);
    expect(c.bars.every((b) => b.from === 0.5 && b.to === 0.5)).toBe(true);
  });

  it('당일 손익 기록이 5건 미만이면 차트 없음 + 더 필요한 건수', () => {
    const v = toHistoryView(h({ A: days(100, -100, 300) }), 'A', 'all');
    expect(v.chart).toBeNull();
    expect(v.chartNeed).toBe(2);
  });

  it('당일 손익이 빈 기록은 세지 않는다', () => {
    const v = toHistoryView(h({ A: days(100, null, 300, null, 5, 6) }), 'A', 'all');
    expect(v.chart).toBeNull();
    expect(v.chartNeed).toBe(1);
  });

  it('전체로는 충분한데 고른 기간에 적으면 차트 없음, 더 기다릴 건수는 0', () => {
    const pts = [...['06-01', '06-02', '06-03', '06-04'].map((d) => p(`2026-${d}`, 1, 10)), p('2026-10-19', 1, 10)];
    const v = toHistoryView(h({ A: pts }), 'A', '1m');
    expect(v.chart).toBeNull();
    expect(v.chartNeed).toBe(0);
  });

  it('기록이 없으면 빈 화면 모델', () => {
    expect(toHistoryView(h({}), '', '3m')).toMatchObject({ accounts: [], account: '', rows: [], chart: null, chartNeed: 5, total: 0 });
  });
});

describe('가린 날짜 기간 필터', () => {
  it('기준일이 넘치는 가린 날짜면 필터하지 않는다', () => {
    const v = toHistoryView(h({ A: [p('3072-90-98', 1), p('3072-90-99', 2)] }), 'A', '1m');
    expect(v.rows).toHaveLength(2);
  });
});

describe('gapFrom — 빠진 평일 표시', () => {
  const rows = (dates: string[], range: 'all' | '1m' = 'all') =>
    toHistoryView(h({ A: dates.map((d) => p(d, 1000)) }), 'A', range).rows.map((r) => [r.date, r.gapFrom]);

  it('연속 평일이면 표시 없음, 첫 기록도 없음', () => {
    expect(rows(['2026-10-20', '2026-10-21', '2026-10-22'])).toEqual([
      ['2026.10.22', null],
      ['2026.10.21', null],
      ['2026.10.20', null],
    ]);
  });

  it('금 → 월 은 주말만 건너뛴 것이라 표시 없음', () => {
    expect(rows(['2026-10-16', '2026-10-19'])).toEqual([
      ['2026.10.19', null],
      ['2026.10.16', null],
    ]);
  });

  it('평일이 빠지면 바로 이전 기록 날짜(M.D)', () => {
    expect(rows(['2026-10-19', '2026-10-21', '2026-10-23'])).toEqual([
      ['2026.10.23', '10.21'],
      ['2026.10.21', '10.19'],
      ['2026.10.19', null],
    ]);
  });

  it('금 → 화 는 월요일이 빠진 것', () => {
    expect(rows(['2026-10-16', '2026-10-20'])[0]).toEqual(['2026.10.20', '10.16']);
  });

  it('기간 필터로 잘린 맨 아래 행도 범위 밖 이전 기록과 비교한다', () => {
    const r = rows(['2026-08-03', '2026-10-21'], '1m');
    expect(r).toEqual([['2026.10.21', '8.3']]);
  });
});
