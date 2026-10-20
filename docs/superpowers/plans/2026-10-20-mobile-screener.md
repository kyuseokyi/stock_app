# 모바일 스크리너 탭(1차) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **모든 설명·커밋 메시지·코드 주석은 한국어로 쓴다**(루트 `CLAUDE.md` 최우선 규칙).

**목표:** 모바일 앱 하단에 스크리너 탭(시장·테마·업종·일정)과 그룹 상세 화면을 추가한다.

**구조:** 서버(stock_api GraphQL)는 그대로. `mobile/src/features/market/` 에 타입·조회·순수 함수·훅·화면 조각을 두고,
`(tabs)/screener.tsx`(칩으로 4가지 전환)와 `market/[kind]/[id].tsx`(그룹 상세)가 이를 조립한다.
판단이 들어가는 로직은 순수 함수(`format.ts`, `latest.ts`)로 빼서 jest 로 검사한다.

**기술:** Expo SDK 57 · React Native 0.86 · expo-router · react-native-unistyles v3 · graphql-request(`stockRequest`) · react-native-svg(미니 추세선) · jest

**스펙:** [`docs/superpowers/specs/2026-10-20-mobile-screener-design.md`](../specs/2026-10-20-mobile-screener-design.md)

---

## 사전 조건 (사용자가 직접)

작업 규칙상 앱에서 `npm install` 을 하지 않으므로 **Task 6 전에 사용자가** 실행한다:
```bash
cd mobile && npx expo install react-native-svg
```
설치 확인: `ls mobile/node_modules/react-native-svg/package.json` 이 있어야 한다. 없으면 Task 6 에서 멈추고 사용자에게 요청한다.

## 파일 구조

| 파일 | 할 일 |
|---|---|
| `mobile/src/features/market/types.ts` (새) | 응답 타입 |
| `mobile/src/features/market/api.ts` (새) | GraphQL 쿼리 4개 + 조회 함수 |
| `backend/tests/test_market_query.py` (수정) | 웹·모바일 쿼리 문자열을 실제 스키마로 실행하는 계약 테스트 |
| `mobile/src/features/market/format.ts` (새) + `format.test.ts` | 금액·등락률·추세선 좌표·일정 나누기·순위 이어 붙이기·오류 코드 |
| `mobile/src/features/market/latest.ts` (새) + `latest.test.ts` | 늦게 온 옛 응답 무시용 요청 번호 |
| `mobile/src/features/market/use-market-overview.ts` · `use-group-ranking.ts` · `use-group-detail.ts` · `use-calendar.ts` (새) | 화면별 데이터 훅 |
| `mobile/src/features/market/components/*.tsx` (새) | `sparkline` · `index-card` · `breadth-bar` · `group-row` · `event-list` · `basis-note` |
| `mobile/src/features/market/sections/*.tsx` (새) | 칩별 화면 `market-section` · `group-section` · `calendar-section` |
| `mobile/src/app/(tabs)/screener.tsx` (새), `(tabs)/_layout.tsx` (수정) | 스크리너 탭 |
| `mobile/src/app/market/[kind]/[id].tsx` (새), `src/app/_layout.tsx` (수정) | 그룹 상세 |
| `README.md`, `docs/superpowers/specs/2026-10-08-mobile-screen-architecture-design.md` (수정) | 마무리 문서 |

---

### Task 1: 타입 · 조회 함수 · 계약 테스트

**Files:**
- Create: `mobile/src/features/market/types.ts`
- Create: `mobile/src/features/market/api.ts`
- Modify: `backend/tests/test_market_query.py` (`test_web_queries_match_schema` 를 공용 함수로 나누고 모바일 테스트 추가)

- [ ] **Step 1: 타입 작성** — `mobile/src/features/market/types.ts`

```ts
// stock_api GraphQL 스크리너(시장·테마·업종·일정) 응답 타입 — 웹 web_client/src/types/market.ts 와 같다(트리맵 제외).
export type GroupKind = 'theme' | 'sector';
export type Period = '1d' | '5d' | '20d';
export type GroupSort = 'chg' | 'value';

export interface MarketIndex {
  code: string;
  name: string;
  region: string; // KR | US | FX
  date: string;
  close: number;
  chg1d: number | null;
  spark: number[];
}

export interface MacroValue {
  seriesId: string;
  name: string;
  unit: string;
  date: string;
  value: number;
  prev: number | null;
}

export interface MarketOverview {
  indices: MarketIndex[];
  macro: MacroValue[];
}

export interface GroupItem {
  id: string;
  name: string;
  members: number;
  chg: number | null;
  value: number;
  up: number;
  down: number;
  flat: number;
  leader: { ticker: string; name: string; chg: number | null } | null;
  rank: number;
  streak: number;
}

export interface GroupRanking {
  date: string | null;
  total: number;
  items: GroupItem[];
}

export interface GroupStock {
  ticker: string;
  name: string;
  close: number;
  chg1d: number | null;
  chg5d: number | null;
  value: number;
  mcap: number | null;
  isLeader: boolean;
  reason: string | null;
}

export interface GroupDetail {
  kind: GroupKind;
  id: string;
  name: string;
  description: string | null;
  date: string;
  chg1d: number | null;
  chg5d: number | null;
  chg20d: number | null;
  value: number;
  mcap: number;
  up: number;
  down: number;
  flat: number;
  rank: number;
  history: { date: string; chg1d: number | null; rank: number }[];
  stocks: GroupStock[];
}

export interface CalendarEvent {
  date: string;
  title: string;
  category: string; // 공모주 | 경제지표
  ticker: string | null;
  name: string | null;
  detail: string;
}
```

- [ ] **Step 2: 조회 함수 작성** — `mobile/src/features/market/api.ts`
  쿼리 문자열은 `export const X_QUERY = \`...\`` 형식을 지켜야 백엔드 계약 테스트가 읽는다.

```ts
import { stockRequest } from '@/lib/api';

import { GROUP_PAGE } from './format';
import type { CalendarEvent, GroupDetail, GroupKind, GroupRanking, GroupSort, MarketOverview, Period } from './types';

// stock_api GraphQL 스크리너 조회(공개). 쿼리 문자열은 backend/tests/test_market_query.py 계약 테스트가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.

export const OVERVIEW_QUERY = `query MarketOverview {
  marketOverview {
    indices { code name region date close chg1d spark }
    macro { seriesId name unit date value prev }
  }
}`;

export const GROUPS_QUERY = `query MarketGroups($kind: String!, $period: String!, $sort: String!, $limit: Int!, $offset: Int!) {
  marketGroups(kind: $kind, period: $period, sort: $sort, limit: $limit, offset: $offset) {
    date total
    items { id name members chg value up down flat leader { ticker name chg } rank streak }
  }
}`;

export const GROUP_QUERY = `query MarketGroup($kind: String!, $id: String!) {
  marketGroup(kind: $kind, id: $id) {
    kind id name description date chg1d chg5d chg20d value mcap up down flat rank
    history { date chg1d rank }
    stocks { ticker name close chg1d chg5d value mcap isLeader reason }
  }
}`;

export const CALENDAR_QUERY = `query MarketCalendar($start: String!, $end: String!, $category: String) {
  marketCalendar(start: $start, end: $end, category: $category) { date title category ticker name detail }
}`;

export async function fetchMarketOverview(): Promise<MarketOverview> {
  return (await stockRequest<{ marketOverview: MarketOverview }>(OVERVIEW_QUERY)).marketOverview;
}

export async function fetchMarketGroups(
  kind: GroupKind,
  period: Period,
  sort: GroupSort,
  offset = 0,
  limit = GROUP_PAGE,
): Promise<GroupRanking> {
  const vars = { kind, period, sort, limit, offset };
  return (await stockRequest<{ marketGroups: GroupRanking }>(GROUPS_QUERY, vars)).marketGroups;
}

export async function fetchMarketGroup(kind: GroupKind, id: string): Promise<GroupDetail | null> {
  return (await stockRequest<{ marketGroup: GroupDetail | null }>(GROUP_QUERY, { kind, id })).marketGroup;
}

export async function fetchMarketCalendar(start: string, end: string, category?: string): Promise<CalendarEvent[]> {
  const vars = { start, end, category: category ?? null };
  return (await stockRequest<{ marketCalendar: CalendarEvent[] }>(CALENDAR_QUERY, vars)).marketCalendar;
}
```
  (`./format` 의 `GROUP_PAGE` 는 Task 2 에서 만든다 — 타입 검사는 Task 2 뒤에 한다.)

- [ ] **Step 3: 계약 테스트 확장** — `backend/tests/test_market_query.py`
  기존 `test_web_queries_match_schema` 함수 전체를 아래로 **교체**한다(본문은 같고, 파일 경로·기대 쿼리 이름만 인자로 받는다).

```python
def _run_query_contract(monkeypatch, rel_path: str, expected: set[str]) -> None:
    """프론트 파일의 쿼리 문자열을 그대로 꺼내 실제 스키마로 실행(프론트↔API 계약)."""
    import pathlib
    import re

    from apps.stock_api.graphql.schema import schema

    ts = (pathlib.Path(__file__).resolve().parents[2] / rel_path).read_text(encoding="utf-8")
    queries = dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", ts))
    assert set(queries) == expected

    seen = {}
    monkeypatch.setattr(mq, "overview", lambda: {"indices": [], "macro": []})
    monkeypatch.setattr(mq, "groups", lambda **kw: seen.setdefault("groups", kw) and {
        "date": "2026-10-16", "total": 1, "items": [
            {"id": "7", "name": "반도체", "members": 5, "chg": 3.2, "value": 1e9, "up": 4, "down": 1, "flat": 0,
             "leader": {"ticker": "AAA", "name": "에이", "chg": 5.0}, "rank": 1, "streak": 2}]})
    monkeypatch.setattr(mq, "treemap", lambda **kw: seen.setdefault("treemap", kw) and {"date": None, "groups": []})
    monkeypatch.setattr(mq, "group", lambda kind, gid: {
        "kind": kind, "id": gid, "name": "반도체", "description": None, "date": "2026-10-16", "chg1d": 1.0,
        "chg5d": None, "chg20d": None, "value": 1.0, "mcap": 1.0, "up": 1, "down": 0, "flat": 0, "rank": 1,
        "history": [{"date": "2026-10-16", "chg1d": 1.0, "rank": 1}],
        "stocks": [{"ticker": "AAA", "name": "에이", "close": 1.0, "chg1d": 1.0, "chg5d": None, "value": 1.0,
                    "mcap": None, "is_leader": True, "reason": None}]})
    monkeypatch.setattr(mq, "calendar", lambda s, e, c: seen.setdefault("calendar", (s, e, c)) and [])

    variables = {
        "OVERVIEW_QUERY": {},
        "GROUPS_QUERY": {"kind": "theme", "period": "5d", "sort": "value", "limit": 30, "offset": 0},
        "TREEMAP_QUERY": {"kind": "sector", "size": "mcap", "period": "1d"},
        "GROUP_QUERY": {"kind": "theme", "id": "7"},
        "CALENDAR_QUERY": {"start": "2026-10-16", "end": "2026-12-15", "category": None},
    }
    for name, query in queries.items():
        res = schema.execute_sync(query, variable_values=variables[name])
        assert res.errors is None, (rel_path, name, res.errors)
    assert seen["groups"] == {"kind": "theme", "period": "5d", "sort": "value", "limit": 30, "offset": 0}
    assert seen["calendar"] == ("2026-10-16", "2026-12-15", None)
    if "TREEMAP_QUERY" in expected:
        assert seen["treemap"] == {"kind": "sector", "size": "mcap", "period": "1d"}


def test_web_queries_match_schema(monkeypatch):
    _run_query_contract(monkeypatch, "web_client/src/api/market.ts",
                        {"OVERVIEW_QUERY", "GROUPS_QUERY", "TREEMAP_QUERY", "GROUP_QUERY", "CALENDAR_QUERY"})


def test_mobile_queries_match_schema(monkeypatch):
    # 모바일 스크리너(트리맵 없음)도 같은 계약 — 쿼리를 고치면 여기서 바로 깨진다
    _run_query_contract(monkeypatch, "mobile/src/features/market/api.ts",
                        {"OVERVIEW_QUERY", "GROUPS_QUERY", "GROUP_QUERY", "CALENDAR_QUERY"})
```

- [ ] **Step 4: 계약 테스트 실행**

Run: `cd backend && uv run pytest tests/test_market_query.py 2>&1 | tail -2`
Expected: 모두 passed(웹·모바일 계약 테스트 포함)

- [ ] **Step 5: 커밋**(타입 검사는 Task 2 뒤 — `api.ts` 가 `format.ts` 를 가져옴)

```bash
git add mobile/src/features/market/types.ts mobile/src/features/market/api.ts backend/tests/test_market_query.py
git commit -m "feat(mobile): 스크리너 타입·GraphQL 조회 + 웹·모바일 쿼리 계약 테스트"
```

---

### Task 2: 순수 함수 `format.ts` (TDD)

**Files:**
- Create: `mobile/src/features/market/format.ts`
- Test: `mobile/src/features/market/format.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `format.test.ts`

```ts
import {
  dayLabel,
  errorCode,
  formatAmount,
  formatChg,
  formatIndex,
  formatMacro,
  groupByDate,
  hasMoreGroups,
  mergeGroupPage,
  shiftDate,
  sparkPoints,
  sparkTone,
  splitEvents,
  toneOf,
} from './format';
import type { CalendarEvent, GroupItem } from './types';

const ev = (date: string, title = 't'): CalendarEvent => ({
  date, title, category: '공모주', ticker: null, name: null, detail: '',
});
const gi = (id: string): GroupItem => ({
  id, name: id, members: 1, chg: 0, value: 0, up: 0, down: 0, flat: 0, leader: null, rank: 1, streak: 0,
});

describe('금액·등락률·지수 표시', () => {
  it('금액은 조·억으로 줄이고 그 아래는 원', () => {
    expect(formatAmount(1_234_000_000_000)).toBe('1.2조');
    expect(formatAmount(345_600_000_000)).toBe('3,456억');
    expect(formatAmount(98_765)).toBe('98,765원');
  });
  it('등락률은 소수 한 자리·부호, 없으면 –', () => {
    expect(formatChg(1.234)).toBe('+1.2%');
    expect(formatChg(-0.06)).toBe('-0.1%');
    expect(formatChg(0.04)).toBe('0.0%');
    expect(formatChg(null)).toBe('–');
  });
  it('등락 색 구분', () => {
    expect(toneOf(2)).toBe('up');
    expect(toneOf(-1)).toBe('down');
    expect(toneOf(0)).toBe('flat');
    expect(toneOf(null)).toBe('flat');
  });
  it('지수는 콤마 + 소수 최대 두 자리(뒤 0 생략)', () => {
    expect(formatIndex(2601.5)).toBe('2,601.5');
    expect(formatIndex(808.891)).toBe('808.89');
    expect(formatIndex(1333)).toBe('1,333');
  });
  it('거시 지표 — 천 명 단위는 정수 콤마, 나머지는 소수 두 자리', () => {
    expect(formatMacro(256_123.4, '천 명')).toBe('256,123천 명');
    expect(formatMacro(4.1234, '%')).toBe('4.12%');
  });
});

describe('미니 추세선', () => {
  it('점이 2개 미만이면 null', () => {
    expect(sparkPoints([])).toBeNull();
    expect(sparkPoints([5])).toBeNull();
  });
  it('최소·최대를 아래·위 끝에 맞춘다(높이 30, 위아래 2 여백)', () => {
    expect(sparkPoints([1, 3])).toBe('0,28 100,2');
  });
  it('평평한 선은 바닥에 가로줄', () => {
    expect(sparkPoints([7, 7, 7])).toBe('0,28 50,28 100,28');
  });
  it('추세 색은 마지막 ≥ 첫 값이면 up', () => {
    expect(sparkTone([1, 2])).toBe('up');
    expect(sparkTone([2, 2])).toBe('up');
    expect(sparkTone([3, 1])).toBe('down');
  });
});

describe('일정', () => {
  it('날짜 더하기·빼기(월 경계 포함)', () => {
    expect(shiftDate('2026-10-20', 60)).toBe('2026-12-19');
    expect(shiftDate('2026-10-03', -7)).toBe('2026-09-26');
  });
  it('오늘 기준으로 지난 일정과 앞으로의 일정을 나눈다(오늘은 앞으로)', () => {
    const { past, upcoming } = splitEvents([ev('2026-10-18'), ev('2026-10-20'), ev('2026-10-25')], '2026-10-20');
    expect(past.map((e) => e.date)).toEqual(['2026-10-18']);
    expect(upcoming.map((e) => e.date)).toEqual(['2026-10-20', '2026-10-25']);
  });
  it('날짜별로 묶되 순서를 유지한다', () => {
    const g = groupByDate([ev('2026-10-20', 'a'), ev('2026-10-20', 'b'), ev('2026-10-21', 'c')]);
    expect(g.map((x) => [x.date, x.events.map((e) => e.title)])).toEqual([
      ['2026-10-20', ['a', 'b']],
      ['2026-10-21', ['c']],
    ]);
  });
  it('날짜 라벨 — 요일, 오늘 표시', () => {
    expect(dayLabel('2026-10-20', '2026-10-20')).toBe('10월 20일 (화) · 오늘');
    expect(dayLabel('2026-10-25', '2026-10-20')).toBe('10월 25일 (일)');
  });
});

describe('순위 더 불러오기', () => {
  it('이어 붙일 때 같은 id 는 한 번만', () => {
    expect(mergeGroupPage([gi('a'), gi('b')], [gi('b'), gi('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('끝 판정 — 받은 수가 한 페이지(30)보다 적거나 total 에 닿으면 끝', () => {
    expect(hasMoreGroups(30, 100, 30)).toBe(true);
    expect(hasMoreGroups(45, 100, 15)).toBe(false);
    expect(hasMoreGroups(60, 60, 30)).toBe(false);
  });
});

describe('오류 코드', () => {
  it('HTTP 상태가 있으면 HTTP nnn, 없으면 NETWORK', () => {
    expect(errorCode({ response: { status: 502 } })).toBe('HTTP 502');
    expect(errorCode(new Error('Network request failed'))).toBe('NETWORK');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/market/format.test.ts 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './format'`

- [ ] **Step 3: 구현** — `format.ts`

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && npx jest src/features/market/format.test.ts 2>&1 | tail -5`
Expected: PASS(테스트 전부 통과)

- [ ] **Step 5: 타입 검사(Task 1 의 `api.ts` 포함)**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5`
Expected: 출력 없음(오류 0)

- [ ] **Step 6: 커밋**

```bash
git add mobile/src/features/market/format.ts mobile/src/features/market/format.test.ts
git commit -m "feat(mobile): 스크리너 순수 함수 — 금액·등락률·추세선 좌표·일정 나누기·순위 이어 붙이기·오류 코드"
```

---

### Task 3: 늦게 온 응답 무시 `latest.ts` (TDD)

**Files:**
- Create: `mobile/src/features/market/latest.ts`
- Test: `mobile/src/features/market/latest.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { createLatest } from './latest';

describe('요청 번호', () => {
  it('마지막으로 시작한 요청만 최신', () => {
    const gate = createLatest();
    const a = gate.next();
    const b = gate.next();
    expect(gate.isLatest(a)).toBe(false);
    expect(gate.isLatest(b)).toBe(true);
  });
  it('current 는 지금 최신 번호(더 불러오기처럼 번호를 올리지 않는 요청용)', () => {
    const gate = createLatest();
    const a = gate.next();
    expect(gate.current()).toBe(a);
    gate.next();
    expect(gate.isLatest(a)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd mobile && npx jest src/features/market/latest.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 구현** — `latest.ts`

```ts
/**
 * 요청 번호 — 조건(기간·정렬·분류)을 빠르게 바꿀 때 늦게 도착한 옛 응답이 새 목록을 덮지 않게 한다.
 * 사용: const id = gate.next(); const r = await fetch(); if (!gate.isLatest(id)) return;
 */
export function createLatest() {
  let seq = 0;
  return {
    next(): number {
      seq += 1;
      return seq;
    },
    current(): number {
      return seq;
    },
    isLatest(id: number): boolean {
      return id === seq;
    },
  };
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS

- [ ] **Step 5: 커밋**

```bash
git add mobile/src/features/market/latest.ts mobile/src/features/market/latest.test.ts
git commit -m "feat(mobile): 스크리너 요청 번호 — 늦게 온 옛 응답 무시"
```

---

### Task 4: 데이터 훅 4개

**Files:**
- Create: `mobile/src/features/market/use-market-overview.ts`
- Create: `mobile/src/features/market/use-group-ranking.ts`
- Create: `mobile/src/features/market/use-group-detail.ts`
- Create: `mobile/src/features/market/use-calendar.ts`

공통 규칙: 처음 불러오기 `reload`(전체 로딩), 당겨서 새로고침 `refresh`(기존 내용 유지, 실패 시 throw → 화면의 `usePullRefresh` 가 알림).
판단 로직은 Task 2·3 의 순수 함수만 쓴다(훅 자체는 화면 연결이라 실기기로 확인).

- [ ] **Step 1: 시장 칩 훅** — `use-market-overview.ts`

```ts
import { useCallback, useEffect, useState } from 'react';

import { kstDateString } from '@/features/game/lib/format';

import { fetchMarketCalendar, fetchMarketGroups, fetchMarketOverview } from './api';
import { errorCode, shiftDate } from './format';
import type { CalendarEvent, GroupItem, MarketOverview } from './types';

type Data = { overview: MarketOverview; themes: GroupItem[]; date: string | null; events: CalendarEvent[] };
type State = { data: Data | null; loading: boolean; error: string | null };

/** 개요·주도 테마 Top 5·다가오는 일정 3건을 따로 불러온다. 개요가 실패하면 오류, 나머지는 실패해도 그 칸만 비운다. */
async function fetchAll(): Promise<Data> {
  const today = kstDateString();
  const [ov, th, ev] = await Promise.allSettled([
    fetchMarketOverview(),
    fetchMarketGroups('theme', '1d', 'chg', 0, 5),
    fetchMarketCalendar(today, shiftDate(today, 60)),
  ]);
  if (ov.status === 'rejected') throw ov.reason;
  return {
    overview: ov.value,
    themes: th.status === 'fulfilled' ? th.value.items : [],
    date: th.status === 'fulfilled' ? th.value.date : null,
    events: ev.status === 'fulfilled' ? ev.value.slice(0, 3) : [],
  };
}

export function useMarketOverview() {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await fetchAll(), loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: errorCode(e) });
    }
  }, []);

  /** 당겨서 새로고침 — 기존 내용 유지, 성공하면 교체(실패는 throw) */
  const refresh = useCallback(async () => {
    const data = await fetchAll();
    setState({ data, loading: false, error: null });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh };
}
```

- [ ] **Step 2: 테마·업종 칩 훅** — `use-group-ranking.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchMarketGroups } from './api';
import { errorCode, GROUP_PAGE, hasMoreGroups, mergeGroupPage } from './format';
import { createLatest } from './latest';
import type { GroupItem, GroupKind, GroupSort, Period } from './types';

type State = {
  items: GroupItem[];
  total: number;
  date: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
};

const INITIAL: State = {
  items: [], total: 0, date: null, hasMore: false, loading: true, error: null, loadingMore: false, moreFailed: false,
};

/** 테마·업종 순위 — 기간·정렬 조건, 30개씩 더 불러오기, 조건을 빠르게 바꿔도 마지막 요청만 반영 */
export function useGroupRanking(kind: GroupKind) {
  const [period, setPeriod] = useState<Period>('1d');
  const [sort, setSort] = useState<GroupSort>('chg');
  const [state, setState] = useState<State>(INITIAL);
  const gate = useRef(createLatest()).current;

  const fetchFirst = useCallback(async () => {
    const r = await fetchMarketGroups(kind, period, sort, 0);
    return {
      items: r.items, total: r.total, date: r.date, hasMore: hasMoreGroups(r.items.length, r.total, r.items.length),
    };
  }, [kind, period, sort]);

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null, moreFailed: false }));
    try {
      const first = await fetchFirst();
      if (!gate.isLatest(id)) return;
      setState({ ...INITIAL, ...first, loading: false });
    } catch (e) {
      if (!gate.isLatest(id)) return;
      setState({ ...INITIAL, loading: false, error: errorCode(e) });
    }
  }, [fetchFirst, gate]);

  /** 당겨서 새로고침 — 기존 목록 유지, 성공하면 첫 페이지로 교체(실패는 throw) */
  const refresh = useCallback(async () => {
    const id = gate.next();
    const first = await fetchFirst();
    if (!gate.isLatest(id)) return;
    setState({ ...INITIAL, ...first, loading: false });
  }, [fetchFirst, gate]);

  /** 목록 끝에서 다음 30개 — 번호를 올리지 않고 지금 조건의 응답일 때만 반영 */
  const loadMore = useCallback(async () => {
    if (state.loading || state.loadingMore || !state.hasMore) return;
    const id = gate.current();
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false }));
    try {
      const r = await fetchMarketGroups(kind, period, sort, state.items.length, GROUP_PAGE);
      if (!gate.isLatest(id)) return;
      setState((s) => {
        const items = mergeGroupPage(s.items, r.items);
        return { ...s, items, total: r.total, hasMore: hasMoreGroups(items.length, r.total, r.items.length), loadingMore: false };
      });
    } catch {
      if (!gate.isLatest(id)) return;
      setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
    }
  }, [gate, kind, period, sort, state.hasMore, state.items.length, state.loading, state.loadingMore]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, period, sort, setPeriod, setSort, reload, refresh, loadMore };
}
```

- [ ] **Step 3: 그룹 상세 훅** — `use-group-detail.ts`

```ts
import { useCallback, useEffect, useState } from 'react';

import { fetchMarketGroup } from './api';
import { errorCode } from './format';
import type { GroupDetail, GroupKind } from './types';

type State = { data: GroupDetail | null; loading: boolean; error: string | null; notFound: boolean };

export function useGroupDetail(kind: GroupKind, id: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null, notFound: false });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchMarketGroup(kind, id);
      setState({ data, loading: false, error: null, notFound: data === null });
    } catch (e) {
      setState({ data: null, loading: false, error: errorCode(e), notFound: false });
    }
  }, [kind, id]);

  /** 당겨서 새로고침 — 기존 내용 유지(실패는 throw) */
  const refresh = useCallback(async () => {
    const data = await fetchMarketGroup(kind, id);
    setState({ data, loading: false, error: null, notFound: data === null });
  }, [kind, id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh };
}
```

- [ ] **Step 4: 일정 칩 훅** — `use-calendar.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { kstDateString } from '@/features/game/lib/format';

import { fetchMarketCalendar } from './api';
import { errorCode, shiftDate, splitEvents } from './format';
import { createLatest } from './latest';
import type { CalendarEvent } from './types';

export type CalendarCategory = '전체' | '공모주' | '경제지표';

type State = { past: CalendarEvent[]; upcoming: CalendarEvent[]; loading: boolean; error: string | null };

/** 일정 — 지난 7일 + 앞으로 60일, 분류 칩. 분류를 빠르게 바꿔도 마지막 요청만 반영 */
export function useCalendar() {
  const [category, setCategory] = useState<CalendarCategory>('전체');
  const [state, setState] = useState<State>({ past: [], upcoming: [], loading: true, error: null });
  const gate = useRef(createLatest()).current;
  const today = kstDateString();

  const fetchSplit = useCallback(async () => {
    const events = await fetchMarketCalendar(
      shiftDate(today, -7),
      shiftDate(today, 60),
      category === '전체' ? undefined : category,
    );
    return splitEvents(events, today);
  }, [category, today]);

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await fetchSplit();
      if (!gate.isLatest(id)) return;
      setState({ ...r, loading: false, error: null });
    } catch (e) {
      if (!gate.isLatest(id)) return;
      setState({ past: [], upcoming: [], loading: false, error: errorCode(e) });
    }
  }, [fetchSplit, gate]);

  const refresh = useCallback(async () => {
    const id = gate.next();
    const r = await fetchSplit();
    if (!gate.isLatest(id)) return;
    setState({ ...r, loading: false, error: null });
  }, [fetchSplit, gate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, today, category, setCategory, reload, refresh };
}
```

- [ ] **Step 5: 타입 검사** — `cd mobile && npx tsc --noEmit 2>&1 | tail -5` → 오류 0

- [ ] **Step 6: 커밋**

```bash
git add mobile/src/features/market/use-market-overview.ts mobile/src/features/market/use-group-ranking.ts mobile/src/features/market/use-group-detail.ts mobile/src/features/market/use-calendar.ts
git commit -m "feat(mobile): 스크리너 데이터 훅 — 시장 개요·테마/업종 순위(더 불러오기)·그룹 상세·일정"
```

---

### Task 5: 화면 조각(추세선 제외)

**Files:**
- Create: `mobile/src/features/market/components/breadth-bar.tsx`
- Create: `mobile/src/features/market/components/group-row.tsx`
- Create: `mobile/src/features/market/components/event-list.tsx`
- Create: `mobile/src/features/market/components/basis-note.tsx`

- [ ] **Step 1: 상승·하락 막대** — `breadth-bar.tsx`

```tsx
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** 상승·보합·하락 종목 수 비율 막대(가로 64) */
export function BreadthBar({ up, down, flat }: { up: number; down: number; flat: number }) {
  const total = up + down + flat || 1;
  return (
    <View style={styles.bar} accessibilityLabel={`상승 ${up} · 보합 ${flat} · 하락 ${down}`}>
      <View style={[styles.up, { width: `${(up / total) * 100}%` }]} />
      <View style={[styles.flat, { width: `${(flat / total) * 100}%` }]} />
      <View style={[styles.down, { width: `${(down / total) * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: { flexDirection: 'row', width: 64, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: theme.colors.fill },
  up: { backgroundColor: theme.colors.up },
  flat: { backgroundColor: theme.colors.border },
  down: { backgroundColor: theme.colors.down },
}));
```

- [ ] **Step 2: 순위 한 줄** — `group-row.tsx`

```tsx
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, toneOf } from '../format';
import type { GroupItem } from '../types';
import { BreadthBar } from './breadth-bar';

/** 테마·업종 순위 한 줄 — 순위·이름·연속 상위·등락률·상승/하락 막대·대장주. 누르면 onPress */
export function GroupRow({ item, onPress }: { item: GroupItem; onPress: () => void }) {
  const tone = toneOf(item.chg);
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${item.name} 상세`}>
      <Text style={styles.rank}>{item.rank || '–'}</Text>
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          {item.streak >= 2 ? <Text style={styles.streak}>{item.streak}일째 상위</Text> : null}
          <Text style={[styles.chg, styles[tone]]}>{formatChg(item.chg)}</Text>
        </View>
        <View style={styles.line}>
          <BreadthBar up={item.up} down={item.down} flat={item.flat} />
          <Text style={styles.meta}>{item.members}종목</Text>
          {item.leader ? (
            <Text style={styles.meta} numberOfLines={1}>
              대장 {item.leader.name} <Text style={styles[toneOf(item.leader.chg)]}>{formatChg(item.leader.chg)}</Text>
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), paddingVertical: theme.gap(1.25) },
  rank: { width: 24, textAlign: 'center', fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  body: { flex: 1, gap: theme.gap(0.5) },
  line: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  streak: {
    fontSize: 10, fontWeight: '700', color: theme.colors.up, backgroundColor: theme.colors.upSoft,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
  chg: { marginLeft: 'auto', fontSize: 15, fontWeight: '700' },
  meta: { flexShrink: 1, fontSize: 12, color: theme.colors.textSecondary },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
}));
```

- [ ] **Step 3: 일정 목록** — `event-list.tsx`

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { dayLabel, groupByDate } from '../format';
import type { CalendarEvent } from '../types';

/** 날짜별로 묶은 일정. 종목 일정은 "종목명 (티커)" + 서버가 만든 상세 문장 */
export function EventList({ events, today }: { events: CalendarEvent[]; today: string }) {
  return (
    <View style={styles.wrap}>
      {groupByDate(events).map((g) => (
        <View key={g.date} style={styles.day}>
          <Text style={[styles.dayLabel, g.date === today && styles.today]}>{dayLabel(g.date, today)}</Text>
          {g.events.map((e, i) => (
            <View key={`${e.title}-${i}`} style={styles.item}>
              <Text style={[styles.badge, e.category === '공모주' ? styles.ipo : styles.macro]}>{e.category}</Text>
              <View style={styles.text}>
                <Text style={styles.title}>{e.title}</Text>
                {e.ticker || e.detail ? (
                  <Text style={styles.sub}>
                    {[e.name && e.ticker ? `${e.name} (${e.ticker})` : e.ticker, e.detail].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(2) },
  day: { gap: theme.gap(1) },
  dayLabel: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  today: { color: theme.colors.primary },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(1) },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  ipo: { color: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
  macro: { color: theme.colors.up, backgroundColor: theme.colors.upSoft },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  sub: { fontSize: 12, color: theme.colors.textSecondary },
}));
```

- [ ] **Step 4: 기준일 안내** — `basis-note.tsx`

```tsx
import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** 화면 맨 아래 안내 — 기준일·갱신 주기·투자 권유 아님 */
export function BasisNote({ date }: { date: string | null }) {
  return (
    <Text style={styles.note}>
      {date ? `기준일 ${date} · ` : ''}매일 장 마감 후 갱신 · 투자 권유가 아닙니다
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  note: { fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: theme.gap(2) },
}));
```

- [ ] **Step 5: 타입 검사** — `cd mobile && npx tsc --noEmit 2>&1 | tail -5` → 오류 0

- [ ] **Step 6: 커밋**

```bash
git add mobile/src/features/market/components
git commit -m "feat(mobile): 스크리너 화면 조각 — 상승·하락 막대·순위 한 줄·일정 목록·기준일 안내"
```

---

### Task 6: 미니 추세선 · 지수 카드 (svg — 사전 조건 필요)

**Files:**
- Create: `mobile/src/features/market/components/sparkline.tsx`
- Create: `mobile/src/features/market/components/index-card.tsx`

- [ ] **Step 0: svg 설치 확인** — `ls mobile/node_modules/react-native-svg/package.json`
  없으면 **여기서 멈추고** 사용자에게 `cd mobile && npx expo install react-native-svg` 실행을 요청한다(직접 설치 금지).

- [ ] **Step 1: 미니 추세선** — `sparkline.tsx`

```tsx
import Svg, { Polyline } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';

import { sparkPoints, sparkTone } from '../format';

/** 지수 미니 추세선(가로 꽉 참, 높이 32). 점 2개 미만이면 그리지 않는다 */
export function Sparkline({ values }: { values: number[] }) {
  const { theme } = useUnistyles();
  const points = sparkPoints(values);
  if (!points) return null;
  const color = sparkTone(values) === 'up' ? theme.colors.up : theme.colors.down;
  return (
    <Svg width="100%" height={32} viewBox="0 0 100 30" preserveAspectRatio="none" accessibilityElementsHidden>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
```

- [ ] **Step 2: 지수·거시 지표 카드** — `index-card.tsx`

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, formatIndex, formatMacro, toneOf } from '../format';
import type { MacroValue, MarketIndex } from '../types';
import { Sparkline } from './sparkline';

/** 지수 카드 — 이름·(해외면 날짜)·종가·등락률·미니 추세선. 2열 배치용(width 48%) */
export function IndexCard({ index }: { index: MarketIndex }) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>{index.name}</Text>
        {index.region === 'KR' ? null : <Text style={styles.date}>{index.date.slice(5).replace('-', '/')}</Text>}
      </View>
      <Text style={styles.close}>{formatIndex(index.close)}</Text>
      <Text style={[styles.chg, styles[toneOf(index.chg1d)]]}>{formatChg(index.chg1d)}</Text>
      <Sparkline values={index.spark} />
    </View>
  );
}

/** 미국 거시 지표 카드 — 값·단위, 직전 대비 */
export function MacroCard({ macro }: { macro: MacroValue }) {
  const diff = macro.prev == null ? null : macro.value - macro.prev;
  return (
    <View style={styles.card}>
      <Text style={styles.name} numberOfLines={1}>{macro.name}</Text>
      <Text style={styles.close}>{formatMacro(macro.value, macro.unit)}</Text>
      <Text style={styles.date}>
        {macro.date.slice(0, 7)}
        {diff == null ? '' : ` · 직전 대비 ${diff >= 0 ? '+' : ''}${macro.unit === '천 명' ? Math.round(diff).toLocaleString('ko-KR') : diff.toFixed(2)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: '48%', backgroundColor: theme.colors.surface, borderRadius: theme.radius.card,
    padding: theme.gap(1.75), gap: 2,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(0.5) },
  name: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: theme.colors.text },
  date: { fontSize: 11, color: theme.colors.textSecondary },
  close: { fontSize: 20, fontWeight: '800', color: theme.colors.text },
  chg: { fontSize: 14, fontWeight: '600' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
}));
```

- [ ] **Step 3: 타입 검사** — `cd mobile && npx tsc --noEmit 2>&1 | tail -5` → 오류 0

- [ ] **Step 4: 커밋** — 사용자가 설치하며 바뀐 `mobile/package.json`·`mobile/package-lock.json` 도 함께 넣는다.

```bash
git add mobile/src/features/market/components/sparkline.tsx mobile/src/features/market/components/index-card.tsx mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): 지수·거시 지표 카드 + 미니 추세선(react-native-svg)"
```

---

### Task 7: 칩별 화면(섹션) 3개

**Files:**
- Create: `mobile/src/features/market/sections/market-section.tsx`
- Create: `mobile/src/features/market/sections/group-section.tsx`
- Create: `mobile/src/features/market/sections/calendar-section.tsx`

- [ ] **Step 1: 시장 섹션** — `market-section.tsx`

```tsx
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { kstDateString } from '@/features/game/lib/format';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { ListState } from '@/ui';

import { BasisNote } from '../components/basis-note';
import { EventList } from '../components/event-list';
import { GroupRow } from '../components/group-row';
import { IndexCard, MacroCard } from '../components/index-card';
import type { GroupKind } from '../types';
import { useMarketOverview } from '../use-market-overview';

type Props = {
  onMore: (tab: 'theme' | 'calendar') => void;
  onOpenGroup: (kind: GroupKind, id: string) => void;
};

/** 시장 칩 — 지수 카드·거시 지표·주도 테마 Top 5·다가오는 일정 3건 */
export function MarketSection({ onMore, onOpenGroup }: Props) {
  const { data, loading, error, reload, refresh } = useMarketOverview();
  const { refreshing, onRefresh } = usePullRefresh(refresh);
  const today = kstDateString();

  if (loading && !data) return <ListState mode="loading" />;

  const indices = data?.overview.indices ?? [];
  const macro = data?.overview.macro ?? [];
  return (
    <ScrollView
      contentContainerStyle={[styles.content, !data && styles.grow]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error ? (
        <ListState mode="error" title="시장 데이터를 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${error})`} onRetry={reload} />
      ) : indices.length === 0 ? (
        <ListState mode="empty" emoji="🛠️" title="시장 데이터를 준비하고 있어요" hint="매일 장 마감 후 갱신돼요" />
      ) : (
        <>
          <View style={styles.grid}>
            {indices.map((ix) => <IndexCard key={ix.code} index={ix} />)}
          </View>
          {macro.length > 0 ? (
            <View style={styles.grid}>
              {macro.map((m) => <MacroCard key={m.seriesId} macro={m} />)}
            </View>
          ) : null}
          {data && data.themes.length > 0 ? (
            <View style={styles.card}>
              <SectionHead title="주도 테마 Top 5" onMore={() => onMore('theme')} />
              {data.themes.map((t) => <GroupRow key={t.id} item={t} onPress={() => onOpenGroup('theme', t.id)} />)}
            </View>
          ) : null}
          {data && data.events.length > 0 ? (
            <View style={styles.card}>
              <SectionHead title="다가오는 일정" onMore={() => onMore('calendar')} />
              <EventList events={data.events} today={today} />
            </View>
          ) : null}
          <BasisNote date={data?.date ?? null} />
        </>
      )}
    </ScrollView>
  );
}

function SectionHead({ title, onMore }: { title: string; onMore: () => void }) {
  return (
    <View style={styles.head}>
      <Text style={styles.headTitle}>{title}</Text>
      <Pressable onPress={onMore} hitSlop={8} accessibilityRole="button">
        <Text style={styles.more}>더 보기</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.gap(2), gap: theme.gap(1.5) },
  grow: { flexGrow: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: theme.gap(1.5) },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2) },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.gap(0.5) },
  headTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  more: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
}));
```

- [ ] **Step 2: 테마·업종 섹션** — `group-section.tsx`

```tsx
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip, ListState } from '@/ui';

import { BasisNote } from '../components/basis-note';
import { GroupRow } from '../components/group-row';
import type { GroupKind, GroupSort, Period } from '../types';
import { useGroupRanking } from '../use-group-ranking';

const PERIODS: [Period, string][] = [['1d', '1일'], ['5d', '5일'], ['20d', '20일']];
const SORTS: [GroupSort, string][] = [['chg', '등락률'], ['value', '거래대금']];

/** 테마·업종 칩 — 기간·정렬 칩, 순위 목록(끝까지 내리면 30개 더), 누르면 그룹 상세 */
export function GroupSection({ kind, onOpenGroup }: { kind: GroupKind; onOpenGroup: (kind: GroupKind, id: string) => void }) {
  const r = useGroupRanking(kind);
  const { refreshing, onRefresh } = usePullRefresh(r.refresh);
  const label = kind === 'theme' ? '테마' : '업종';

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        {PERIODS.map(([v, t]) => <Chip key={v} label={t} selected={r.period === v} onPress={() => r.setPeriod(v)} />)}
        <View style={styles.sep} />
        {SORTS.map(([v, t]) => <Chip key={v} label={t} selected={r.sort === v} onPress={() => r.setSort(v)} />)}
      </View>
      {r.loading && r.items.length === 0 ? (
        <ListState mode="loading" />
      ) : (
        <FlatList
          contentContainerStyle={[styles.list, r.items.length === 0 && styles.grow]}
          data={r.items}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => <GroupRow item={item} onPress={() => onOpenGroup(kind, item.id)} />}
          ItemSeparatorComponent={() => <View style={styles.line} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          onEndReached={() => void r.loadMore()}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            r.error ? (
              <ListState mode="error" title={`${label}를 불러오지 못했어요`} hint={`잠시 후 다시 시도해 주세요 (오류: ${r.error})`} onRetry={r.reload} />
            ) : (
              <ListState mode="empty" emoji="📊" title={`아직 집계된 ${label}가 없어요`} hint="매일 장 마감 후 갱신돼요" />
            )
          }
          ListFooterComponent={
            r.items.length === 0 ? null : (
              <View>
                {r.loadingMore ? <ActivityIndicator style={styles.more} /> : null}
                {r.moreFailed ? (
                  <Pressable onPress={() => void r.loadMore()} style={styles.more} accessibilityRole="button">
                    <Text style={styles.moreText}>더 불러오지 못했어요 · 다시 시도</Text>
                  </Pressable>
                ) : null}
                <BasisNote date={r.date} />
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(1) },
  sep: { width: 1, height: 20, backgroundColor: theme.colors.border, marginHorizontal: theme.gap(0.5) },
  list: { marginHorizontal: theme.gap(2), paddingHorizontal: theme.gap(2), backgroundColor: theme.colors.surface, borderRadius: theme.radius.card },
  grow: { flexGrow: 1, backgroundColor: 'transparent' },
  line: { height: 1, backgroundColor: theme.colors.border },
  more: { paddingVertical: theme.gap(1.5), alignItems: 'center' },
  moreText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
}));
```

- [ ] **Step 3: 일정 섹션** — `calendar-section.tsx`

```tsx
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip, ListState } from '@/ui';

import { BasisNote } from '../components/basis-note';
import { EventList } from '../components/event-list';
import { type CalendarCategory, useCalendar } from '../use-calendar';

const CATEGORIES: CalendarCategory[] = ['전체', '공모주', '경제지표'];

/** 일정 칩 — 분류 칩, 앞으로 60일(날짜별), 지난 7일은 펼쳐 보기 */
export function CalendarSection() {
  const c = useCalendar();
  const { refreshing, onRefresh } = usePullRefresh(c.refresh);
  const [showPast, setShowPast] = useState(false);

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        {CATEGORIES.map((v) => <Chip key={v} label={v} selected={c.category === v} onPress={() => c.setCategory(v)} />)}
      </View>
      {c.loading && c.upcoming.length === 0 && c.past.length === 0 ? (
        <ListState mode="loading" />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, c.upcoming.length === 0 && styles.grow]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {c.error ? (
            <ListState mode="error" title="일정을 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${c.error})`} onRetry={c.reload} />
          ) : (
            <>
              {c.past.length > 0 ? (
                <View style={styles.card}>
                  <Pressable onPress={() => setShowPast((v) => !v)} accessibilityRole="button">
                    <Text style={styles.toggle}>{showPast ? '지난 일정 접기 ▲' : `지난 7일 일정 ${c.past.length}개 보기 ▼`}</Text>
                  </Pressable>
                  {showPast ? <View style={styles.past}><EventList events={c.past} today={c.today} /></View> : null}
                </View>
              ) : null}
              {c.upcoming.length > 0 ? (
                <View style={styles.card}><EventList events={c.upcoming} today={c.today} /></View>
              ) : (
                <ListState mode="empty" emoji="🗓️" title="앞으로 60일 안에 잡힌 일정이 없어요" hint="새 일정은 매일 아침 수집돼요" />
              )}
              <BasisNote date={null} />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  controls: { flexDirection: 'row', gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(1) },
  content: { padding: theme.gap(2), paddingTop: 0, gap: theme.gap(1.5) },
  grow: { flexGrow: 1 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2) },
  toggle: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  past: { marginTop: theme.gap(1.5), opacity: 0.7 },
}));
```

- [ ] **Step 4: 타입 검사** — `cd mobile && npx tsc --noEmit 2>&1 | tail -5` → 오류 0
  (`@/ui` 에 `Chip`·`ListState`·`Button` 이 export 되어 있음 — `mobile/src/ui/index.ts`)

- [ ] **Step 5: 커밋**

```bash
git add mobile/src/features/market/sections
git commit -m "feat(mobile): 스크리너 칩별 화면 — 시장·테마/업종·일정(당겨서 새로고침·빈 상태·오류)"
```

---

### Task 8: 스크리너 탭 화면 · 탭 등록

**Files:**
- Create: `mobile/src/app/(tabs)/screener.tsx`
- Modify: `mobile/src/app/(tabs)/_layout.tsx` (게임과 내정보 사이에 `screener` 탭)

- [ ] **Step 1: 탭 화면** — `(tabs)/screener.tsx`

```tsx
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { CalendarSection } from '@/features/market/sections/calendar-section';
import { GroupSection } from '@/features/market/sections/group-section';
import { MarketSection } from '@/features/market/sections/market-section';
import type { GroupKind } from '@/features/market/types';
import { Chip } from '@/ui';

type Tab = 'market' | 'theme' | 'sector' | 'calendar';
const TABS: [Tab, string][] = [['market', '시장'], ['theme', '테마'], ['sector', '업종'], ['calendar', '일정']];

/** 스크리너 탭 — 위쪽 칩(시장·테마·업종·일정)으로 아래 내용을 바꾼다. 주도주(CANSLIM)는 2차 */
export default function ScreenerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('market');

  const openGroup = (kind: GroupKind, id: string) =>
    router.push(`/market/${kind}/${encodeURIComponent(id)}` as Href);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsBar}>
        {TABS.map(([v, t]) => <Chip key={v} label={t} selected={tab === v} onPress={() => setTab(v)} />)}
      </ScrollView>
      {tab === 'market' ? <MarketSection onMore={setTab} onOpenGroup={openGroup} /> : null}
      {tab === 'theme' ? <GroupSection key="theme" kind="theme" onOpenGroup={openGroup} /> : null}
      {tab === 'sector' ? <GroupSection key="sector" kind="sector" onOpenGroup={openGroup} /> : null}
      {tab === 'calendar' ? <CalendarSection /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  tabsBar: { flexGrow: 0 },
  tabs: { gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingVertical: theme.gap(1.5) },
}));
```
  (`onMore` 는 `'theme' | 'calendar'` 를 넘기고 `setTab` 은 `Tab` 을 받으므로 타입이 맞는다. `key` 로 테마↔업종 전환 때 상태를 새로 시작한다.)

- [ ] **Step 2: 탭 등록** — `(tabs)/_layout.tsx` 의 `game` `Tabs.Screen` 바로 뒤, `profile` 앞에 추가:

```tsx
      <Tabs.Screen
        name="screener"
        options={{
          title: '스크리너',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" color={color} size={size} />,
        }}
      />
```

- [ ] **Step 3: 타입 검사** — `cd mobile && npx tsc --noEmit 2>&1 | tail -5` → 오류 0

- [ ] **Step 4: 커밋**

```bash
git add "mobile/src/app/(tabs)/screener.tsx" "mobile/src/app/(tabs)/_layout.tsx"
git commit -m "feat(mobile): 하단 스크리너 탭 — 시장·테마·업종·일정 칩"
```

---

### Task 9: 그룹 상세 화면

**Files:**
- Create: `mobile/src/app/market/[kind]/[id].tsx`
- Modify: `mobile/src/app/_layout.tsx` (`fund/backup` 다음 줄에 등록)

- [ ] **Step 1: 상세 화면** — `market/[kind]/[id].tsx`

```tsx
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BasisNote } from '@/features/market/components/basis-note';
import { BreadthBar } from '@/features/market/components/breadth-bar';
import { formatAmount, formatChg, formatIndex, toneOf } from '@/features/market/format';
import type { GroupKind } from '@/features/market/types';
import { useGroupDetail } from '@/features/market/use-group-detail';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Button, ListState } from '@/ui';

/** 테마·업종 상세 — 요약(1·5·20일 등락·거래대금·시총·상승/하락·순위) + 구성 종목 */
export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ kind: string; id: string }>();
  const kind: GroupKind = params.kind === 'sector' ? 'sector' : 'theme';
  const id = String(params.id ?? '');
  const router = useRouter();
  const { data, loading, error, notFound, reload, refresh } = useGroupDetail(kind, id);
  const { refreshing, onRefresh } = usePullRefresh(refresh);

  if (loading && !data) return <ListState mode="loading" />;
  if (notFound) {
    return (
      <View style={styles.center}>
        <ListState mode="empty" emoji="🔍" title="이 그룹 정보를 찾을 수 없어요" hint="목록이 바뀌었을 수 있어요" />
        <Button label="뒤로 가기" variant="secondary" fullWidth={false} onPress={() => router.back()} />
      </View>
    );
  }
  if (error || !data) {
    return <ListState mode="error" title="상세를 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${error ?? 'NETWORK'})`} onRetry={reload} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Stack.Screen options={{ title: data.name }} />
      <View style={styles.card}>
        <Text style={styles.kind}>{kind === 'theme' ? '테마' : '업종'} · {data.rank ? `${data.rank}위` : '순위 없음'}</Text>
        {data.description ? <Text style={styles.desc}>{data.description}</Text> : null}
        <View style={styles.chgRow}>
          {([['1일', data.chg1d], ['5일', data.chg5d], ['20일', data.chg20d]] as const).map(([t, v]) => (
            <View key={t} style={styles.chgBox}>
              <Text style={styles.label}>{t}</Text>
              <Text style={[styles.chg, styles[toneOf(v)]]}>{formatChg(v)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.meta}>거래대금 {formatAmount(data.value)} · 시가총액 {formatAmount(data.mcap)}</Text>
        <View style={styles.breadth}>
          <BreadthBar up={data.up} down={data.down} flat={data.flat} />
          <Text style={styles.meta}>상승 {data.up} · 보합 {data.flat} · 하락 {data.down}</Text>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>구성 종목 {data.stocks.length}</Text>
        {data.stocks.map((s) => (
          <View key={s.ticker} style={styles.stock}>
            <View style={styles.stockMain}>
              <Text style={styles.stockName} numberOfLines={1}>
                {s.name}{s.isLeader ? <Text style={styles.leader}>  대장주</Text> : null}
              </Text>
              {s.reason ? <Text style={styles.reason} numberOfLines={2}>{s.reason}</Text> : null}
            </View>
            <View style={styles.stockNums}>
              <Text style={styles.price}>{formatIndex(s.close)}</Text>
              <Text style={[styles.small, styles[toneOf(s.chg1d)]]}>1일 {formatChg(s.chg1d)}</Text>
              <Text style={[styles.small, styles[toneOf(s.chg5d)]]}>5일 {formatChg(s.chg5d)}</Text>
            </View>
          </View>
        ))}
      </View>
      <BasisNote date={data.date} />
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.gap(2), backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2), gap: theme.gap(1.5), backgroundColor: theme.colors.background },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  kind: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  desc: { fontSize: 14, color: theme.colors.text },
  chgRow: { flexDirection: 'row', gap: theme.gap(1) },
  chgBox: { flex: 1, backgroundColor: theme.colors.fill, borderRadius: 12, padding: theme.gap(1), alignItems: 'center', gap: 2 },
  label: { fontSize: 12, color: theme.colors.textSecondary },
  chg: { fontSize: 16, fontWeight: '800' },
  meta: { fontSize: 13, color: theme.colors.textSecondary },
  breadth: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  section: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  stock: { flexDirection: 'row', gap: theme.gap(1), paddingVertical: theme.gap(1), borderTopWidth: 1, borderTopColor: theme.colors.border },
  stockMain: { flex: 1, gap: 2 },
  stockName: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  leader: { fontSize: 11, fontWeight: '700', color: theme.colors.up },
  reason: { fontSize: 12, color: theme.colors.textSecondary },
  stockNums: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  small: { fontSize: 12, fontWeight: '600' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
}));
```
  (`Button` 의 props 는 `label`·`variant`·`fullWidth`·`onPress` — `ListState` 가 이미 같은 방식으로 쓰고 있다.)

- [ ] **Step 2: 루트 등록** — `src/app/_layout.tsx` 의 `fund/backup` `Stack.Screen` 다음 줄:

```tsx
        <Stack.Screen name="market/[kind]/[id]" options={{ headerShown: true, title: '그룹 상세' }} />
```

- [ ] **Step 3: 타입 검사 + 전체 테스트**

Run: `cd mobile && npx tsc --noEmit 2>&1 | tail -5 && npx jest 2>&1 | tail -4`
Expected: 타입 오류 0, 전체 테스트 통과(기존 366 + format·latest 새 테스트)

- [ ] **Step 4: 커밋**

```bash
git add "mobile/src/app/market/[kind]/[id].tsx" mobile/src/app/_layout.tsx
git commit -m "feat(mobile): 테마·업종 그룹 상세 화면 — 요약·구성 종목"
```

---

### Task 10: 재빌드 · 실기기 확인

- [ ] **Step 1: 개발용 앱 재빌드(svg 네이티브)** — Metro 가 떠 있으면 먼저 끈다.

```bash
cd mobile && APP_ENV=development npx expo run:android --port 8082
```
Expected: `BUILD SUCCESSFUL` → 설치 → 앱 실행.

- [ ] **Step 2: 실기기 확인(SM-A536N, 화면 캡처 `adb exec-out screencap -p`)**
  1. 하단 탭 5개(홈·커뮤니티·게임·스크리너·내정보)
  2. 시장 칩: 지수 카드 2열 + 미니 추세선 색(상승 핑크레드·하락 블루), 주도 테마 Top 5, 다가오는 일정
  3. "더 보기" → 테마 칩·일정 칩으로 전환
  4. 테마 칩: 기간·정렬 칩 전환, 끝까지 내려 30개 더, 줄 누르면 그룹 상세(제목 = 그룹 이름)
  5. 업종 칩 동일
  6. 일정 칩: 분류 칩, 지난 7일 펼치기, 공모주 "종목명 (티커)"
  7. 각 화면 당겨서 새로고침
  8. 다크 모드(기기 설정)에서 글자·막대 색이 보이는지

- [ ] **Step 3: 문제가 있으면 고친 뒤 해당 파일만 새 커밋**

---

### Task 11: 마무리 문서

**Files:**
- Modify: `README.md` (모바일 섹션 첫 줄)
- Modify: `docs/superpowers/specs/2026-10-08-mobile-screen-architecture-design.md` (끝에 메모)

- [ ] **Step 1: README** — `expo-router(하단 4탭: 홈/블로그/게임/내정보 — 스크리너·관심종목 탭은 제거됨)` 를 아래로 바꾼다:

```
expo-router(하단 5탭: 홈/커뮤니티/게임/스크리너/내정보 — 스크리너는 시장·테마·업종·일정, 설계 `docs/superpowers/specs/2026-10-20-mobile-screener-design.md`)
```

- [ ] **Step 2: 10-08 설계 문서 끝에 추가**

```markdown

---
**2026-10-20 갱신 — 스크리너 탭 부활:** 하단 5탭(홈·커뮤니티·게임·**스크리너**·내정보). 시장·테마·업종·일정 1차 —
[`2026-10-20-mobile-screener-design.md`](2026-10-20-mobile-screener-design.md). 관심종목 탭은 여전히 없음.
```

- [ ] **Step 3: 커밋**

```bash
git add README.md docs/superpowers/specs/2026-10-08-mobile-screen-architecture-design.md
git commit -m "docs: 모바일 하단 5탭(스크리너 부활) — README·10-08 화면 구조 문서 갱신"
```
