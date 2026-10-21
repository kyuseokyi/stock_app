// 히스토리 화면 모델 — 기간 필터·차트 좌표·표시 포맷(B안 규칙, formatValue)을 여기서 끝내고 페이지는 그리기만.
// 기간은 마지막 기록 날짜 기준 문자열 비교(Date.now 에 기대지 않아 결정적).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { own, type FundHistory, type HistoryPoint } from './history';
import { formatValue, type ViewCell } from './view';

export type HistoryRange = '1m' | '3m' | 'all';
// gapFrom: 바로 이전 기록이 '직전 평일'보다 앞이면 그 날짜(M.D) — 그 사이가 빠졌다는 표시(공휴일은 모름)
export type HistoryRowView = { date: string; value: ViewCell; day: ViewCell; month: ViewCell; gapFrom: string | null };
export type HistoryChartView = { points: [number, number][]; min: ViewCell; max: ViewCell; start: string; end: string };
export type HistoryView = {
  accounts: string[];
  account: string;
  range: HistoryRange;
  chart: HistoryChartView | null; // 값 있는 기록 2건 미만이면 null
  rows: HistoryRowView[]; // 최신이 위
  total: number; // 선택 계좌의 전체 기록 수(기간 무관)
};

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

function chartOf(pts: HistoryPoint[]): HistoryChartView | null {
  const vs = pts.filter((p): p is HistoryPoint & { value: number } => p.value !== null);
  if (vs.length < 2) return null;
  const values = vs.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const last = vs.length - 1;
  return {
    points: vs.map((p, i): [number, number] => [i / last, span === 0 ? 0.5 : (p.value - min) / span]), // 가로 = 기록 순번
    min: cell('현재평가금', min),
    max: cell('현재평가금', max),
    start: dot(vs[0].date),
    end: dot(vs[last].date),
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
