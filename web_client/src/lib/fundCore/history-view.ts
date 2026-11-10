// 히스토리 화면 모델 — 기간 필터·차트 좌표·표시 포맷(B안 규칙, formatValue)을 여기서 끝내고 페이지는 그리기만.
// 기간은 마지막 기록 날짜 기준 문자열 비교(Date.now 에 기대지 않아 결정적).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { own, type FundHistory, type HistoryPoint } from './history';
import { formatValue, type ViewCell } from './view';

export type HistoryRange = '1m' | '3m' | 'all';
// gapFrom: 바로 이전 기록이 '직전 평일'보다 앞이면 그 날짜(M.D) — 그 사이가 빠졌다는 표시(공휴일은 모름)
export type HistoryRowView = { date: string; value: ViewCell; day: ViewCell; month: ViewCell; gapFrom: string | null };
// 당일 손익금 막대 차트 — 누적 평가금은 입금·복리로 늘 우상향이라 흐름이 안 보인다.
// 좌표는 0..1(1=위). x = 막대 가운데, from = 0원 기준선, to = 값. width = 칸 너비 대비 막대 비율.
export type HistoryBar = { x: number; from: number; to: number; tone: 'up' | 'down' | 'zero' };
export type HistoryChartView = { bars: HistoryBar[]; zero: number; width: number; min: ViewCell; max: ViewCell; start: string; end: string };
export type HistoryView = {
  accounts: string[];
  account: string;
  range: HistoryRange;
  chart: HistoryChartView | null; // 고른 기간의 당일 손익 기록이 CHART_MIN 건 미만이면 null
  chartNeed: number; // 차트까지 더 쌓여야 할 기록 수(계좌 전체 기준, 0 = 기다릴 필요 없음)
  rows: HistoryRowView[]; // 최신이 위
  total: number; // 선택 계좌의 전체 기록 수(기간 무관)
};

/** 처음 등록한 펀드는 며칠치만 있어 막대가 몇 개뿐이면 의미가 없다 — 거래일 한 주(5건)부터 그린다 */
export const CHART_MIN = 5;
const BAR_WIDTH = 0.6;

const RANGE_DAYS: Record<HistoryRange, number | null> = { '1m': 31, '3m': 92, all: null };
const DAY_MS = 86_400_000;

const dot = (iso: string) => iso.replace(/-/g, '.');
const cell = (label: string, n: number | null): ViewCell =>
  n === null ? { text: '—', unit: '', tone: '', raw: '' } : formatValue(label, String(n));

/** 'YYYY-MM-DD' 에서 days 일 전 날짜(UTC 성분끼리 계산 — 시간대 영향 없음) */
function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * DAY_MS).toISOString().slice(0, 10);
}

/** UTC 기준 요일로 토·일 판단 */
function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 || w === 6;
}

/** 직전 평일(토·일 건너뜀) */
function prevWeekday(iso: string): string {
  let d = daysBefore(iso, 1);
  while (isWeekend(d)) d = daysBefore(d, 1);
  return d;
}

/** 'YYYY-MM-DD' → 'M.D' */
function md(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}.${Number(d)}`;
}

type DayPoint = HistoryPoint & { day: number };
const hasDay = (p: HistoryPoint): p is DayPoint => p.day !== null;

function chartOf(pts: HistoryPoint[]): HistoryChartView | null {
  const ds = pts.filter(hasDay);
  if (ds.length < CHART_MIN) return null;
  const values = ds.map((p) => p.day);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const lo = Math.min(0, min); // 0원 기준선이 늘 보이게 범위에 0 포함
  const hi = Math.max(0, max);
  const span = hi - lo;
  const y = (n: number) => (span === 0 ? 0.5 : (n - lo) / span);
  const zero = y(0);
  const n = ds.length;
  return {
    bars: ds.map((p, i) => ({
      x: (i + 0.5) / n, // 가로 = 기록 순번(빠진 날은 간격 없이 붙인다)
      from: zero,
      to: y(p.day),
      tone: p.day > 0 ? 'up' : p.day < 0 ? 'down' : 'zero',
    })),
    zero,
    width: BAR_WIDTH,
    min: cell('당일 손익금', min),
    max: cell('당일 손익금', max),
    start: dot(ds[0].date),
    end: dot(ds[n - 1].date),
  };
}

export function toHistoryView(h: FundHistory, account: string, range: HistoryRange): HistoryView {
  const accounts = Object.keys(h.accounts);
  const name = accounts.includes(account) ? account : (accounts[0] ?? '');
  const all = own(h.accounts, name) ?? [];
  const days = RANGE_DAYS[range];
  const from = days === null || all.length === 0 ? '' : daysBefore(all[all.length - 1].date, days);
  const last = all.length ? all[all.length - 1].date : '';
  const pts = from && from <= last ? all.filter((p) => p.date >= from) : all; // 가린 날짜로 from 이 넘치면 필터 안 함
  return {
    accounts,
    account: name,
    range,
    chart: chartOf(pts),
    chartNeed: Math.max(0, CHART_MIN - all.filter(hasDay).length),
    rows: pts
      .map((p, i) => {
        const prev = all[all.length - pts.length + i - 1];
        return {
          date: dot(p.date),
          value: cell('현재평가금', p.value),
          day: cell('당일 손익금', p.day),
          month: cell('월 손익금', p.month),
          gapFrom: prev && prev.date < prevWeekday(p.date) ? md(prev.date) : null,
        };
      })
      .reverse(),
    total: all.length,
  };
}
