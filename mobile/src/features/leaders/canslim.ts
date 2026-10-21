// 주도주(CANSLIM) 화면용 순수 함수 — 웹 web_client/src/lib/canslim.ts 이식(색은 클래스 대신 테마 키) +
// 목록 페이지 병합·화면 상태 판정·점수 추이 좌표.
import type { CanslimHistoryPoint, LetterKey, LetterStatus, ScreenFilters } from './types';

/** 목록 한 번에 받는 개수(서버 MAX_LIMIT 200 이하여야 더 불러오기 판정이 맞다) */
export const LEADERS_PAGE = 50;

export const LETTER_KEYS: LetterKey[] = ['c', 'a', 'n', 's', 'l', 'i', 'm'];

export const LETTER_NAMES: Record<LetterKey, string> = {
  c: '분기 실적',
  a: '연간 실적',
  n: '신고가',
  s: '거래량',
  l: '주도주',
  i: '기관·외국인',
  m: '시장',
};

export const DEFAULT_FILTERS: ScreenFilters = {
  market: 'ALL',
  minPass: 0,
  required: [],
  sort: 'score',
  liquidOnly: true,
};

/** 두 필터 조건이 같은지 — 같으면 다시 조회할 필요가 없다. required 는 순서와 무관 */
export function sameFilters(a: ScreenFilters, b: ScreenFilters): boolean {
  if (a.market !== b.market || a.minPass !== b.minPass || a.sort !== b.sort || a.liquidOnly !== b.liquidOnly) return false;
  if (a.required.length !== b.required.length) return false;
  return a.required.every((k) => b.required.includes(k));
}

const TICKER_PATTERN = /^[A-Za-z0-9.:-]+$/;

/** 라우트 ticker 파라미터 → 조회할 코드. 배열이면 첫 요소, 비었거나 영숫자·. : - 외 문자가 있으면 null(NotFound) */
export function resolveTickerParam(raw: string | string[] | undefined): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const t = typeof first === 'string' ? first.trim() : '';
  return t && TICKER_PATTERN.test(t) ? t : null;
}

/** 배지 색 구분 — pass=primary 바탕, fail=fill 바탕, none(부족·준비 중)=점선 테두리 */
export type LetterTone = 'pass' | 'fail' | 'none';

export function letterTone(status: LetterStatus): LetterTone {
  if (status === 1) return 'pass';
  if (status === 0) return 'fail';
  return 'none';
}

export function letterStatusText(status: LetterStatus): string {
  if (status === 1) return '통과';
  if (status === 0) return '미달';
  if (status === -2) return '준비 중';
  return '데이터 부족';
}

/** 시장 상태 색(국내 관례 — 상승=up 핑크레드, 하락=down 블루, 조정=중립) */
export type MarketTone = 'up' | 'down' | 'flat';

export function marketTone(status: string): MarketTone {
  if (status === '상승 추세') return 'up';
  if (status === '하락') return 'down';
  return 'flat';
}

/** 52주 최고가 — 서버의 '고점 대비 %'(N 항목 value)와 종가로 되돌려 계산 */
export function high52w(close: number, pctFromHigh: number | null): number | null {
  if (pctFromHigh === null || pctFromHigh <= -100) return null;
  return close / (1 + pctFromHigh / 100);
}

/** 꼭 통과할 항목 토글(원본은 그대로 두고 새 배열) */
export function toggleRequired(required: LetterKey[], key: LetterKey): LetterKey[] {
  return required.includes(key) ? required.filter((k) => k !== key) : [...required, key];
}

/** 적용 중인 필터 수 — 시장·최소 통과 수·거래 활발은 기본과 다르면 1씩, 꼭 통과 항목은 고른 개수. 정렬은 세지 않음 */
export function activeFilterCount(f: ScreenFilters): number {
  return (
    (f.market !== DEFAULT_FILTERS.market ? 1 : 0) +
    (f.minPass !== DEFAULT_FILTERS.minPass ? 1 : 0) +
    (f.liquidOnly !== DEFAULT_FILTERS.liquidOnly ? 1 : 0) +
    f.required.length
  );
}

/** 다음 페이지 이어 붙이기 — 같은 티커는 한 번만(순위가 밀려 겹쳐 와도 중복 행 없음). 주도주·조건검색 공용 */
export function mergeLeaderPage<T extends { ticker: string }>(prev: T[], next: T[]): T[] {
  const seen = new Set(prev.map((x) => x.ticker));
  return [...prev, ...next.filter((x) => !seen.has(x.ticker))];
}

/** 더 불러올 것이 있나 — 마지막으로 받은 수가 한 페이지 미만이거나 total 에 닿으면 끝 */
export function hasMoreLeaders(loaded: number, total: number, lastPageSize: number): boolean {
  return lastPageSize >= LEADERS_PAGE && loaded < total;
}

export type ListView = 'loading' | 'error' | 'preparing' | 'empty' | 'list';

/** 목록 화면 상태 — 항목이 있으면 목록 유지, 없으면 로딩 > 오류 > 준비 중(date null) > 0건 */
export function listView(s: { loading: boolean; error: string | null; date: string | null; count: number }): ListView {
  if (s.count > 0) return 'list';
  if (s.loading) return 'loading';
  if (s.error) return 'error';
  if (s.date === null) return 'preparing';
  return 'empty';
}

export type ScoreView = 'loading' | 'error' | 'none' | 'ready';

/** 종목 상세 점수 영역 상태 — 데이터가 있으면 ready, 없으면 로딩 > 오류 > 비대상(서버 null) */
export function scoreView(s: { loading: boolean; error: string | null; data: object | null }): ScoreView {
  if (s.data) return 'ready';
  if (s.loading) return 'loading';
  if (s.error) return 'error';
  return 'none';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 점수 추이 선 좌표(viewBox 0 0 width height) — 0~100점을 아래→위로. 점 2개 미만이면 null */
export function historyPoints(history: CanslimHistoryPoint[], width = 240, height = 40): string | null {
  if (history.length < 2) return null;
  const last = history.length - 1;
  return history
    .map((p, i) => {
      const score = Math.min(100, Math.max(0, p.score));
      return `${round2((i / last) * width)},${round2(height - (score / 100) * height)}`;
    })
    .join(' ');
}
