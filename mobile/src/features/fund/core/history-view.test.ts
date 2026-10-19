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

  it('차트 — 2건 이상일 때 0..1 좌표, 최고·최저·시작·끝', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', 100), p('2026-10-02', 300), p('2026-10-03', 200)] }), 'A', 'all');
    expect(v.chart?.points).toEqual([[0, 0], [0.5, 1], [1, 0.5]]);
    expect(v.chart?.max.text).toBe('300');
    expect(v.chart?.min.text).toBe('100');
    expect(v.chart?.start).toBe('2026.10.01');
    expect(v.chart?.end).toBe('2026.10.03');
  });

  it('값이 모두 같으면 가운데 선', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', 5), p('2026-10-02', 5)] }), 'A', 'all');
    expect(v.chart?.points).toEqual([[0, 0.5], [1, 0.5]]);
  });

  it('기록이 없으면 빈 화면 모델', () => {
    expect(toHistoryView(h({}), '', '3m')).toMatchObject({ accounts: [], account: '', rows: [], chart: null, total: 0 });
  });
});

describe('가린 날짜 기간 필터', () => {
  it('기준일이 넘치는 가린 날짜면 필터하지 않는다', () => {
    const v = toHistoryView(h({ A: [p('3072-90-98', 1), p('3072-90-99', 2)] }), 'A', '1m');
    expect(v.rows).toHaveLength(2);
  });
});
