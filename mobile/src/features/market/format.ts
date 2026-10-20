import type { CalendarEvent, GroupItem } from './types';

/** 테마·업종 순위 한 번에 불러오는 개수 */
export const GROUP_PAGE = 30;

export type Tone = 'up' | 'down' | 'flat';

/** 정수 콤마: 3456 → '3,456' (Intl 없이 — 기기·테스트에서 같은 결과) */
function withComma(n: number): string {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${s}` : s;
}

/** 큰 금액(원) → '1.2조' · '3,456억' · '98,765원' */
export function formatAmount(won: number): string {
  if (Math.abs(won) >= 1e12) return `${(won / 1e12).toFixed(1)}조`;
  if (Math.abs(won) >= 1e8) return `${withComma(won / 1e8)}억`;
  return `${withComma(won)}원`;
}

/** 등락률 → '+1.2%' · '-0.1%' · '0.0%', 없으면 '–' */
export function formatChg(n: number | null | undefined): string {
  if (n == null) return '–';
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`;
}

/** 등락 색 구분(0·없음은 flat) */
export function toneOf(n: number | null | undefined): Tone {
  if (n == null || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

/** 지수 종가 → '2,601.5' (소수 최대 두 자리, 뒤 0 생략) */
export function formatIndex(n: number): string {
  const r = Math.round(n * 100) / 100;
  const [int, frac = ''] = Math.abs(r).toFixed(2).split('.');
  const f = frac.replace(/0+$/, '');
  return `${r < 0 ? '-' : ''}${withComma(Number(int))}${f ? `.${f}` : ''}`;
}

/** 거시 지표 값 — 천 명 단위는 정수 콤마, 그 밖은 소수 두 자리 + 단위 */
export function formatMacro(v: number, unit: string): string {
  return unit === '천 명' ? `${withComma(v)}천 명` : `${v.toFixed(2)}${unit}`;
}

/** 미니 추세선 좌표(viewBox 0 0 100 30, 위아래 2 여백). 점 2개 미만이면 null */
export function sparkPoints(values: number[], width = 100, height = 30): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const bottom = height - 2;
  const range = height - 4;
  return values
    .map((v, i) => {
      const x = Math.round((i / (values.length - 1)) * width * 100) / 100;
      const y = Math.round((bottom - ((v - min) / span) * range) * 100) / 100;
      return `${x},${y}`;
    })
    .join(' ');
}

/** 추세 색 — 마지막 값 ≥ 첫 값이면 up */
export function sparkTone(values: number[]): 'up' | 'down' {
  return (values[values.length - 1] ?? 0) >= (values[0] ?? 0) ? 'up' : 'down';
}

/** 'YYYY-MM-DD' 에 days 더하기(음수면 빼기) */
export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 오늘 기준 지난 일정 / 앞으로 일정(오늘 포함) */
export function splitEvents(events: CalendarEvent[], today: string) {
  return {
    past: events.filter((e) => e.date < today),
    upcoming: events.filter((e) => e.date >= today),
  };
}

/** 날짜별 묶음(들어온 순서 유지) */
export function groupByDate(events: CalendarEvent[]): { date: string; events: CalendarEvent[] }[] {
  const out: { date: string; events: CalendarEvent[] }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.date === e.date) last.events.push(e);
    else out.push({ date: e.date, events: [e] });
  }
  return out;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** '10월 20일 (화)' + 오늘이면 ' · 오늘' */
export function dayLabel(iso: string, today: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const base = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DOW[d.getUTCDay()]})`;
  return iso === today ? `${base} · 오늘` : base;
}

/** 다음 페이지 이어 붙이기 — 같은 id 는 한 번만 */
export function mergeGroupPage(prev: GroupItem[], next: GroupItem[]): GroupItem[] {
  const seen = new Set(prev.map((x) => x.id));
  return [...prev, ...next.filter((x) => !seen.has(x.id))];
}

/** 더 불러올 것이 있나 — 마지막으로 받은 수가 한 페이지 미만이거나 total 에 닿으면 끝 */
export function hasMoreGroups(loaded: number, total: number, lastPageSize: number): boolean {
  return lastPageSize >= GROUP_PAGE && loaded < total;
}

/** 오류 → 짧은 코드('HTTP 502' · 'NETWORK') — 캡처 한 장으로 원인 구분 */
export function errorCode(e: unknown): string {
  const status = (e as { response?: { status?: number } } | null)?.response?.status;
  return typeof status === 'number' ? `HTTP ${status}` : 'NETWORK';
}
