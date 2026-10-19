// 펀드 히스토리(계좌별 날짜 기록) — 순수 함수. 파일 저장은 앱 history-store 가 한다.
// 날짜 키는 원본 '최종평가일'을 YYYY-MM-DD 로 바꾼 문자열(모양만 검사 — Date 로 해석하지 않는다).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import type { FundReport, Pair } from './types';
import { parseAmount } from './view';

export type HistoryPoint = {
  date: string;
  value: number | null; // 현재평가금
  day: number | null; // 당일 손익금
  month: number | null; // 월 손익금
  recordedAt: number;
};
export type HistoryAccounts = Record<string, HistoryPoint[]>; // 계좌명 → 날짜 오름차순
export type FundHistory = { v: 1; url: string; accounts: HistoryAccounts };
export type Snapshot = { date: string; points: Record<string, HistoryPoint> };

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const RE_KO_DATE = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/;
/** 상속 속성(toString 등)을 읽지 않는 자기 속성 읽기 */
export const own = <T>(o: Record<string, T>, k: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const emptyHistory = (url: string): FundHistory => ({ v: 1, url, accounts: {} });

export function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (RE_ISO.test(s)) return s;
  const m = RE_KO_DATE.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

const pick = (pairs: Pair[], key: string): number | null => {
  const hit = pairs.find(([k]) => k.replace(/\s/g, '') === key);
  return hit ? parseAmount(hit[1]) : null;
};

/** 리포트 → 오늘 기록. 첫 accounts 섹션(최종평가일 있는 것, evalDateOf 와 같은 기준), 같은 계좌명은 첫 번째만. */
export function snapshotOf(report: FundReport, recordedAt: number): Snapshot | null {
  const sec = report.sections.find((s) => s.kind === 'accounts' && s.evalDate);
  if (!sec || sec.kind !== 'accounts') return null;
  const date = toIsoDate(sec.evalDate);
  if (!date) return null;
  const points: Record<string, HistoryPoint> = {};
  const seen = new Set<string>();
  for (const a of sec.accounts) {
    if (BAD_KEYS.has(a.name) || seen.has(a.name)) continue;
    seen.add(a.name);
    const pairs = [...a.values, ...a.remarks];
    const p: HistoryPoint = {
      date,
      value: pick(pairs, '현재평가금'),
      day: pick(pairs, '당일손익금'),
      month: pick(pairs, '월손익금'),
      recordedAt,
    };
    if (p.value !== null || p.day !== null || p.month !== null) points[a.name] = p;
  }
  return Object.keys(points).length ? { date, points } : null;
}

const byDate = (a: HistoryPoint, b: HistoryPoint) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** 점 하나 넣기 — 같은 날짜는 force 거나 recordedAt 이 더 늦을 때만 교체 */
function upsert(
  list: HistoryPoint[],
  p: HistoryPoint,
  force: boolean,
): { list: HistoryPoint[]; change: 'added' | 'replaced' | null } {
  const i = list.findIndex((x) => x.date === p.date);
  if (i >= 0) {
    if (!force && list[i].recordedAt >= p.recordedAt) return { list, change: null };
    const next = list.slice();
    next[i] = p;
    return { list: next, change: 'replaced' };
  }
  return { list: [...list, p].sort(byDate), change: 'added' };
}

/** 새로 가져온 기록 반영(같은 날짜는 무조건 새 값). added = 새 날짜가 생겼는지(자동 백업 신호) */
export function mergePoint(h: FundHistory, snap: Snapshot): { history: FundHistory; added: boolean } {
  let added = false;
  const accounts: HistoryAccounts = { ...h.accounts };
  for (const [name, p] of Object.entries(snap.points)) {
    if (BAD_KEYS.has(name)) continue;
    const r = upsert(own(accounts, name) ?? [], p, true);
    accounts[name] = r.list;
    if (r.change === 'added') added = true;
  }
  return { history: { ...h, accounts }, added };
}

/** 두 기록 합치기(복원·백업 합본) — 합집합, 같은 날짜는 recordedAt 늦은 쪽. changed = 추가·교체된 점 수 */
export function mergeAccounts(
  base: HistoryAccounts,
  extra: HistoryAccounts,
): { accounts: HistoryAccounts; changed: number } {
  let changed = 0;
  const accounts: HistoryAccounts = { ...base };
  for (const [name, pts] of Object.entries(extra)) {
    if (BAD_KEYS.has(name)) continue;
    let list = own(accounts, name) ?? [];
    for (const p of pts) {
      const r = upsert(list, p, false);
      list = r.list;
      if (r.change) changed++;
    }
    accounts[name] = list;
  }
  return { accounts, changed };
}

const numOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

export function isHistoryPoint(p: unknown): p is HistoryPoint {
  const o = p as Partial<HistoryPoint> | null;
  return (
    !!o &&
    typeof o.date === 'string' &&
    RE_ISO.test(o.date) &&
    numOrNull(o.value) &&
    numOrNull(o.day) &&
    numOrNull(o.month) &&
    typeof o.recordedAt === 'number' &&
    Number.isFinite(o.recordedAt)
  );
}

/** 저장·백업된 계좌별 기록 검증 — 잘못된 점·계좌는 버리고 날짜순·날짜 중복 제거 */
export function parseAccounts(raw: unknown): HistoryAccounts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: HistoryAccounts = {};
  for (const [name, pts] of Object.entries(raw as Record<string, unknown>)) {
    if (BAD_KEYS.has(name) || !Array.isArray(pts)) continue;
    const accs = mergeAccounts({}, { [name]: pts.filter(isHistoryPoint) }).accounts;
    const list = own(accs, name) ?? [];
    if (list.length) out[name] = list;
  }
  return out;
}

export function parseHistory(raw: string | null, url: string): FundHistory {
  if (!raw) return emptyHistory(url);
  try {
    const d = JSON.parse(raw) as { v?: unknown; accounts?: unknown } | null;
    if (!d || d.v !== 1) return emptyHistory(url);
    return { v: 1, url, accounts: parseAccounts(d.accounts) };
  } catch {
    return emptyHistory(url);
  }
}
