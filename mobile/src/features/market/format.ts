import type { CalendarEvent, GroupItem, MarketIndex } from './types';

/** 테마·업종 순위 한 번에 불러오는 개수 */
export const GROUP_PAGE = 30;

export type Tone = 'up' | 'down' | 'flat';

/** 정수 콤마: 3456 → '3,456' (Intl 없이 — 기기·테스트에서 같은 결과) */
function withComma(n: number): string {
  const r = Math.round(n);
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return r < 0 ? `-${s}` : s; // 부호는 반올림한 값으로 — '-0' 방지
}

/** 큰 금액(원) → '1.2조' · '3,456억' · '98,765원' */
export function formatAmount(won: number): string {
  // 억으로 반올림해 1만억(=1조)에 닿으면 조로 넘긴다 — '10,000억' 대신 '1.0조'
  if (Math.abs(Math.round(won / 1e8)) >= 10_000) return `${(won / 1e12).toFixed(1)}조`;
  if (Math.abs(won) >= 1e8) return `${withComma(won / 1e8)}억`;
  return `${withComma(won)}원`;
}

/** 소수 한 자리 반올림(0 기준 대칭: -0.05 → -0.1), -0 은 0 으로 */
function round1(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 10) / 10 || 0;
}

/** 등락률 → '+1.2%' · '-0.1%' · '0.0%', 없으면 '–' */
export function formatChg(n: number | null | undefined): string {
  if (n == null) return '–';
  const r = round1(n);
  if (r === 0) return '0.0%';
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`;
}

/** 등락 색 구분 — 보이는 글자(소수 한 자리 반올림)와 같게, 0·없음은 flat */
export function toneOf(n: number | null | undefined): Tone {
  if (n == null) return 'flat';
  const r = round1(n);
  if (r === 0) return 'flat';
  return r > 0 ? 'up' : 'down';
}

/** 지수 카드 날짜 자리 — 장중이면 '장중 14:32'(live, 화면엔 짧은 label '● 14:32'), 국내 확정이면 없음, 해외·환율은 MM/DD */
export function indexBadge(
  ix: Pick<MarketIndex, 'region' | 'date' | 'live' | 'asOf'>,
): { text: string; label: string; live: boolean } | null {
  if (ix.live && ix.asOf) return { text: `장중 ${ix.asOf}`, label: `● ${ix.asOf}`, live: true };
  if (ix.region === 'KR') return null;
  const md = ix.date.slice(5).replace('-', '/');
  return { text: md, label: md, live: false };
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

/**
 * 거시 지표 직전 대비 → '+1,234' · '-0.13' · '0.00', 없으면 ''.
 * 천 명 단위는 정수, 그 밖은 소수 두 자리. 먼저 반올림 → 그 값으로 부호 결정(0 이면 부호 없음).
 */
export function formatMacroDiff(diff: number | null | undefined, unit: string): string {
  if (diff == null) return '';
  const digits = unit === '천 명' ? 0 : 2;
  const scale = 10 ** digits;
  const r = Math.sign(diff) * Math.round(Math.abs(diff) * scale) / scale || 0; // -0 은 0
  const [int, frac] = Math.abs(r).toFixed(digits).split('.');
  const body = `${withComma(Number(int))}${frac ? `.${frac}` : ''}`;
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${body}`;
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

/**
 * 오류 → 짧은 코드('GRAPHQL' · 'HTTP 502' · 'NETWORK') — 캡처 한 장으로 원인 구분.
 * graphql-request 의 ClientError 는 HTTP 200 이어도 응답에 errors 가 있으면 던진다(서버 리졸버 예외).
 */
export function errorCode(e: unknown): string {
  const res = (e as { response?: { status?: number; errors?: unknown[] } } | null)?.response;
  if (Array.isArray(res?.errors) && res.errors.length > 0) return 'GRAPHQL';
  const status = res?.status;
  if (typeof status === 'number' && (status < 200 || status >= 300)) return `HTTP ${status}`;
  return 'NETWORK';
}
