# 모바일 주도주(CANSLIM) 탭 + 범용 종목 상세 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬 — superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans 로 작업 단위 실행. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 모바일 스크리너 탭에 '주도주' 칩(시장 방향·정렬·필터 바텀시트·무한 스크롤 목록)을 더하고, 범용 종목 상세 `/stock/[ticker]`(점수표·일봉 차트·점수 추이)를 만들어 주도주 목록과 테마·업종 상세의 구성 종목에서 들어가게 한다.

**구조:** 서버는 그대로 둔다(공개 GraphQL `canslimMarket`·`canslimScreen`·`canslimScore`·`getChartData`). `mobile/src/features/leaders/` 에 타입·쿼리·순수 함수·훅·화면 조각을 두고, 판단 로직(상태 글자·52주 고점·필터 수·페이지 병합·화면 상태·추이 좌표·차트 가격선)은 순수 함수로 빼서 jest 로 검사한다. 차트는 게임의 lightweight-charts WebView(`TvChart` + `chart-bridge`)를 옮기지 않고 import 한다. 이동평균 기간·첫 화면 일수는 선택 인자로 열고, 기본값은 지금과 같다(게임 영향 없음). 라우트 `app/stock/[ticker].tsx` 가 점수 조회와 차트 조회를 서로 독립으로 조립한다.

**기술:** Expo SDK 57 · React Native 0.86 · expo-router(typedRoutes) · react-native-unistyles v3 · graphql-request(`stockRequest`) · react-native-svg(점수 추이) · react-native-webview(lightweight-charts 4.2.3) · jest(jest-expo, `*.test.ts` 순수 로직만) · pytest(계약 테스트)

**설계:** [`docs/superpowers/specs/2026-10-21-mobile-leaders-design.md`](../specs/2026-10-21-mobile-leaders-design.md) · **선행:** 웹·서버 CANSLIM [`2026-10-18-canslim-design.md`](../specs/2026-10-18-canslim-design.md), 모바일 스크리너 계획 [`2026-10-20-mobile-screener.md`](2026-10-20-mobile-screener.md)

---

## 설계와 다르게 정한 것 (코드 조사 결과 반영)

| 설계 | 실제 코드 | 이 계획 |
|---|---|---|
| §4 "계약 테스트 `test_market_query.py` 에 모바일 주도주 쿼리 파일 경로를 추가" | 공용 헬퍼 `_run_query_contract` 는 시장 탭 전용이다. `market_query` 함수만 바꿔 끼우고, `variables` 사전에 주도주 쿼리 키가 없으며, `seen["groups"]`·`seen["calendar"]` 를 항상 단정한다 | 같은 파일에 **별도 함수** `test_mobile_leaders_queries_match_schema` 를 추가한다. 같은 정규식으로 `mobile/src/features/leaders/api.ts` 를 읽고, `canslim_query` 의 `markets`·`screen`·`score` 를 바꿔 끼운다. 서버로 넘어간 인자와 `canslimScore` null 응답까지 확인한다. 백엔드 테스트는 1개 늘어난다 |
| §4 `api.ts`(`export const ..._QUERY`) | 계약 테스트 정규식은 ``export const (\w+_QUERY) = `([^`]+)` `` 이다. 웹 `screener.ts` 처럼 `${ITEM_FIELDS}` 를 끼워 넣으면 `${...}` 글자가 그대로 GraphQL 로 넘어가 실패한다 | 필드를 **문자열 안에 그대로** 쓴다. `${}`·백틱·타입 주석(`: string`)을 쓰지 않는다 |
| §3 "이동평균 기간을 선택 인자로(기본 5·20·60)" | 기간은 `chart-bridge` 의 `indicatorData`·`lastIndicatorValues` 에서만 쓴다. `chart-page.ts` 는 시리즈 3칸(`ma5`·`ma20`·`ma60`)을 색만 정해 둘 뿐, 기간 숫자를 모른다 | `chart-bridge` 에 `maPeriods`(기본 `MA_PERIODS`)를 받게 하고, `TvChart` prop `maPeriods`·`visibleDays` 로 `loadMessage`·`tickMessage` 둘 다에 넘긴다. 칸 이름 `ma5`·`ma20`·`ma60` 은 "첫째·둘째·셋째 이동평균 칸"으로 그대로 둔다(기존 테스트·`candle-chart.tsx` 무수정). **`chart-page.ts` 는 바꾸지 않는다** → `gen-lwc-bundle.js` 재생성도 필요 없다(이 스크립트는 `web_client/node_modules` 의 LWC 원본만 묶는다) |
| §3 주도주 상세 이동평균 `[50]` | 첫째 칸 색은 `chart-page` 의 `MA.ma5 = '#14b8a6'`(청록). 웹 스크리너의 50일선은 주황 `#f97316` | 50일선은 **청록**으로 보인다(페이지 스크립트를 안 고치려고). 범례 글자도 같은 색(`MA50_COLOR`) |
| §2.2 "일봉 차트: 최근 약 1년" | 게임 `getDailyCandles` 는 `LOOKBACK_DAYS = 180` 고정이고, `initialRange` 는 일봉 첫 화면을 180일로 잡는다 | `getDailyCandles(ticker, now, lookbackDays = 180)` 로 선택 인자를 더한다(게임 호출 무수정). 종목 상세는 **440일**(1년 + 50일선 워밍업 50거래일 ≈ 달력 75일)을 받고, `visibleDays = 365` 로 첫 화면에 1년을 보여 준다 |
| 52주 고점 점선 | 웹은 가격선을 자동 범위에 넣지 않는다 | `fit: 'day'` 로 자동 범위에 넣는다. 고점이 화면 밖으로 사라지지 않게 하려는 것이다(lightweight-charts 4 가격선은 자동 범위에 안 들어감) |
| §2.1 칩 순서·행 누르면 `/stock/[ticker]`(작업 순서상 칩 등록은 작업 3) | `typedRoutes: true` 다. 라우트 타입 `.expo/types/router.d.ts` 는 gitignore 대상이고 dev 서버가 만든다. 라우트 파일이 생기고 타입이 다시 만들어지기 전에는 `router.push({ pathname: '/stock/[ticker]' })` 가 `npm run typecheck` 에서 실패한다 | 작업 3 의 `LeadersSection` 은 `onOpenStock(ticker, name)` 콜백만 받는다(`GroupSection` 의 `onOpenGroup` 과 같은 방식). **스크리너 칩 등록과 이동 배선은 작업 5** 로 옮긴다. 작업 5 는 라우트 파일 → 라우트 타입 재생성 → 이동 배선 순서로 진행한다. 작업 6(그룹 상세)도 작업 5 뒤에 둔다 |
| §2.2 "헤더: 종목명(없으면 티커)" | 비대상(ETF 등)은 `canslimScore` 가 null 이라 이름을 얻을 곳이 없다 | 목록·그룹 상세 둘 다 이름을 알고 있다. 그래서 라우트 파라미터로 `name` 을 같이 넘긴다(`/stock/[ticker]?name=…`). 제목은 `점수표 이름 → name 파라미터 → 티커` 순서로 정한다 |
| §2.1 "[필터] 버튼(적용 중인 필터 수 배지)" — 세는 법 미정 | — | 시장(전체 아님)·최소 통과 수(0 아님)·거래 활발(끔)은 각각 1, 꼭 통과 항목은 **고른 개수만큼** 센다. 정렬은 칩으로 밖에 보이므로 세지 않는다(`activeFilterCount`) |
| 필터 바텀시트 [초기화] | — | 시트 안 초안(draft)만 `DEFAULT_FILTERS` 로 되돌린다(정렬은 유지). [적용]을 눌러야 목록에 반영되고, 닫기(배경·✕·뒤로)는 버린다 |
| 종목 상세 당겨서 새로고침(설계 미정) | — | 점수표만 다시 받는다(실패는 토스트). 차트는 실패했을 때 차트 자리의 "다시 시도"로 따로 다시 받는다(서로 독립 조회) |
| 목록 "총 n개" | `toLocaleString('ko-KR')` 는 기기·테스트마다 결과가 다를 수 있어, market `format.ts` 는 Intl 을 쓰지 않는다 | `formatIndex(total)`(콤마 정수)로 표시한다. 종가도 `formatIndex`, 고점 대비 %는 `formatChg` 를 쓴다(market `format.ts` 재사용) |
| §5 "화면 상태 판정(준비 중·0건·비대상)" | — | `listView`(로딩·오류·준비 중·0건·목록)와 `scoreView`(로딩·오류·비대상·정상)를 순수 함수로 두고 jest 로 고정한다. 항목이 있으면 다시 불러오는 중이어도 목록을 유지한다 |

## 상시 규칙 (모든 작업)

- 모든 커밋은 `dev` 브랜치에 한다. `git add -A`·`git add .` 는 금지 — 파일을 **하나씩** 지정한다. `.serena/project.yml` 은 절대 스테이징하지 않는다(작업 트리에 수정분이 있음).
- 커밋 메시지는 한국어로 쓴다. 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- **테스트가 실패하면 커밋하지 않는다.** 타입 오류가 있어도 커밋하지 않는다.
- 검증 명령(작업 끝마다 해당하는 것):
  - 모바일: `cd mobile && npx jest` 와 `npm run typecheck` — 기준 **529개**, 실패 0, 타입 오류 0. 작업별 예상 누적: 작업 1 → 546, 작업 4 → 553(나머지 작업은 그대로)
  - 백엔드 계약: `cd backend && uv run pytest -p no:warnings tests/test_market_query.py` — 기준 43개 → 작업 1 뒤 44개
  - 백엔드 전체: `cd backend && uv run pytest -p no:warnings` — 기준 **1356개** → 작업 1 뒤 1357개. (`pyproject.toml` 의 `addopts = "-q"` 때문에 명령에 `-q` 를 또 붙이면 마지막 요약 줄 "N passed" 가 사라진다. 개수를 보려면 `-q` 없이 실행한다)
- 패키지 설치(`npm install`·`npx expo install`·`uv add`)는 하지 않는다. 이 계획은 새 패키지가 필요 없다(react-native-svg·react-native-webview 는 이미 있음, `Switch` 는 react-native 내장).
- 실제 env 파일(`.env.development`·`.env.production`·`.env.*.local` 등)은 **수정하지도 출력하지도 않는다**.
- KIS API 를 호출하지 않는다(수집 태스크도 실행하지 않는다). 서버 코드(`backend/apps/**`)는 바꾸지 않는다 — 백엔드는 테스트 파일 1개만 고친다.
- 모바일 jest 는 순수 로직(`*.test.ts`)만 대상이다(`jest.config.js` 의 `testMatch`). 컴포넌트·훅 렌더 테스트(`.test.tsx`)는 만들지 않는다. 화면은 타입 검사와 작업 8(실기기)로 확인한다.
- 디자인은 `docs/mobile_design_language.md`(토스식, 파스텔 C안)를 따른다. 색은 테마 토큰(`theme.colors.*`)으로만 쓴다. 상승 = `up`(핑크레드), 하락 = `down`(블루). 카드 = `surface`, 칩 = `Chip`(선택 `primarySoft`), 모달은 바텀시트(`BottomSheet`). 예외는 차트 선 색이다(게임 차트와 같은 고정 색).
- `mobile/src/features/game/chart-web/chart-page.ts`·`lwc-bundle.generated.ts`·`components/candle-chart.tsx` 는 수정하지 않는다(게임 회귀 방지).
- Metro 포트: 사용자의 dev 서버는 8082 를 쓴다(8081 은 다른 앱). 라우트 타입 재생성용 임시 서버는 **8083** 으로 띄우고 끝나면 반드시 종료한다.
- 하위 에이전트 지시에 넣을 것: 보고·커밋 메시지는 한국어만 / Fact-Forcing Gate 훅이 파일 첫 수정마다 거부하면 요구 사실을 제시하고 같은 호출을 다시 할 것(훅 설정·env 변경 금지) / 패키지 설치 명령 직접 실행 금지 / dev 브랜치·파일 개별 add·끝 두 줄.

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `mobile/src/features/leaders/types.ts` (새) | CANSLIM 응답·필터 타입(웹 `types/screener.ts` 와 같음) | 1 |
| `mobile/src/features/leaders/canslim.ts` (새) + `canslim.test.ts` | 항목 순서·이름·기본 필터·배지/시장 색 구분(테마 키)·상태 글자·52주 고점·필수 항목 토글·적용 필터 수·페이지 병합·더 불러오기 판정·목록/상세 화면 상태·점수 추이 좌표 | 1 |
| `mobile/src/features/leaders/api.ts` (새) | `SCREEN_QUERY`·`SCORE_QUERY`(계약 테스트 대상) + 조회 함수 | 1 |
| `backend/tests/test_market_query.py` (수정, 파일 끝에 추가) | 모바일 주도주 쿼리를 실제 스키마로 실행하는 계약 테스트 | 1 |
| `mobile/src/features/leaders/use-canslim-screen.ts` (새) | 필터·정렬 상태, 첫 페이지·당겨서 새로고침·50개씩 더 불러오기, 늦게 온 옛 응답 무시 | 2 |
| `mobile/src/features/leaders/use-canslim-score.ts` (새) | 종목 점수표 조회(null = 비대상)·다시 시도·새로고침 | 2 |
| `mobile/src/features/leaders/components/letter-badges.tsx` (새) | C~M 배지 1개(`LetterBadge`)·7개 줄(`LetterBadges`) | 3 |
| `mobile/src/features/leaders/components/market-strip.tsx` (새) | 시장 방향 줄(KOSPI·KOSDAQ 상태·분산일·기준일 안내) | 3 |
| `mobile/src/features/leaders/components/leader-row.tsx` (새) | 목록 한 줄(점수 상자·이름/티커·배지·업종·RS·종가·고점 대비) | 3 |
| `mobile/src/features/leaders/components/filter-sheet.tsx` (새) | 필터 바텀시트(초안 편집·적용·초기화) | 3 |
| `mobile/src/features/leaders/sections/leaders-section.tsx` (새) | '주도주' 칩 화면 조립(정렬 칩·필터 버튼·시장 줄·목록·상태) | 3 |
| `mobile/src/features/game/lib/chart-bridge.ts` (수정) + `chart-bridge.test.ts` (테스트 추가) | 이동평균 기간·첫 화면 일수 선택 인자 | 4 |
| `mobile/src/features/game/components/tv-chart.tsx` (수정) | `maPeriods`·`visibleDays` prop(기본값 = 지금) | 4 |
| `mobile/src/features/game/api.ts` (수정) | `getDailyCandles` 의 `lookbackDays` 선택 인자 | 4 |
| `mobile/src/features/leaders/stock-chart.ts` (새) + `stock-chart.test.ts` | 종목 차트 설정 상수·52주 고점 가격선 | 4 |
| `mobile/src/features/leaders/use-daily-candles.ts` (새) | 종목 일봉 조회(점수와 독립)·다시 시도 | 4 |
| `mobile/src/features/leaders/components/stock-daily-chart.tsx` (새) | 일봉 차트 래퍼(50일선·52주 고점·범례·로딩/오류 덮개) | 4 |
| `mobile/src/features/leaders/components/score-table.tsx` (새) | 7항목 점수표 | 5 |
| `mobile/src/features/leaders/components/score-history.tsx` (새) | 점수 추이 미니 그래프(svg) | 5 |
| `mobile/src/app/stock/[ticker].tsx` (새) | 범용 종목 상세 라우트 | 5 |
| `mobile/src/app/_layout.tsx` (수정) | `stock/[ticker]` Stack 화면 등록 | 5 |
| `mobile/src/app/(tabs)/screener.tsx` (수정) | '주도주' 칩 + 종목 상세 이동 | 5 |
| `mobile/src/app/market/[kind]/[id].tsx` (수정) | 구성 종목 행 → 종목 상세 | 6 |
| `README.md`, `docs/ROADMAP.md` (수정) | 모바일 절·CANSLIM 절·로드맵 반영 | 7 |

---

### 작업 1: 순수 로직 · 타입 · 쿼리 문자열 + 계약 테스트

**파일:**
- 생성: `mobile/src/features/leaders/types.ts`
- 생성: `mobile/src/features/leaders/canslim.ts`
- 생성: `mobile/src/features/leaders/canslim.test.ts`
- 생성: `mobile/src/features/leaders/api.ts`
- 수정: `backend/tests/test_market_query.py`(파일 끝에 함수 1개 추가)

- [ ] **1-1. 타입 작성** — `mobile/src/features/leaders/types.ts`

```ts
// 주도주(CANSLIM, stock_api GraphQL canslim*) 응답 타입 — 웹 web_client/src/types/screener.ts 와 같다.
// 항목 상태: 1 통과 · 0 미달 · -1 데이터 부족 · -2 준비 중

export type LetterKey = 'c' | 'a' | 'n' | 's' | 'l' | 'i' | 'm';
export type LetterStatus = 1 | 0 | -1 | -2;

export type CanslimSort = 'score' | 'rs' | 'passCount';
export type MarketFilter = 'ALL' | 'KOSPI' | 'KOSDAQ';

export interface CanslimMarket {
  market: string;
  date: string;
  status: string; // 상승 추세 | 조정 | 하락
  close: number;
  ma50: number;
  ma200: number;
  distributionDays: number;
}

export type CanslimLetters = Record<LetterKey, LetterStatus>;

export interface CanslimItem {
  ticker: string;
  name: string;
  market: string;
  sectorName: string | null;
  close: number;
  score: number;
  passCount: number;
  liquid: boolean;
  letters: CanslimLetters;
  rs: number | null;
  pctFromHigh: number | null;
}

export interface CanslimScreen {
  date: string | null; // null 이면 아직 계산 전(준비 중)
  total: number;
  items: CanslimItem[];
}

export interface CanslimLetter {
  key: LetterKey;
  status: LetterStatus;
  value: number | null;
  display: string;
  threshold: string;
  label: string;
  explanation: string;
}

export interface CanslimHistoryPoint {
  date: string;
  score: number;
  passCount: number;
}

export interface CanslimScore {
  date: string;
  ticker: string;
  name: string;
  market: string;
  sectorName: string | null;
  close: number;
  score: number;
  passCount: number;
  letters: CanslimLetter[];
  history: CanslimHistoryPoint[];
  marketStatus: string | null;
}

export interface ScreenFilters {
  market: MarketFilter;
  minPass: number;
  required: LetterKey[];
  sort: CanslimSort;
  liquidOnly: boolean;
}
```

- [ ] **1-2. 실패하는 테스트 작성** — `mobile/src/features/leaders/canslim.test.ts`

```ts
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  hasMoreLeaders,
  high52w,
  historyPoints,
  LETTER_KEYS,
  letterStatusText,
  letterTone,
  listView,
  marketTone,
  mergeLeaderPage,
  scoreView,
  toggleRequired,
} from './canslim';
import type { CanslimItem } from './types';

const item = (ticker: string): CanslimItem => ({
  ticker,
  name: ticker,
  market: 'KOSPI',
  sectorName: null,
  close: 1000,
  score: 50,
  passCount: 3,
  liquid: true,
  letters: { c: 1, a: 1, n: 0, s: 0, l: 1, i: -1, m: -2 },
  rs: 80,
  pctFromHigh: -3.5,
});

describe('항목 표시', () => {
  it('항목 순서는 C A N S L I M', () => {
    expect(LETTER_KEYS.join('')).toBe('canslim');
  });
  it('상태 글자 — 통과·미달·준비 중·데이터 부족', () => {
    expect(letterStatusText(1)).toBe('통과');
    expect(letterStatusText(0)).toBe('미달');
    expect(letterStatusText(-2)).toBe('준비 중');
    expect(letterStatusText(-1)).toBe('데이터 부족');
  });
  it('배지 색 구분 — 통과 pass, 미달 fail, 부족·준비 중 none', () => {
    expect(letterTone(1)).toBe('pass');
    expect(letterTone(0)).toBe('fail');
    expect(letterTone(-1)).toBe('none');
    expect(letterTone(-2)).toBe('none');
  });
  it('시장 상태 색 — 상승 추세=up, 하락=down, 그 밖=flat', () => {
    expect(marketTone('상승 추세')).toBe('up');
    expect(marketTone('하락')).toBe('down');
    expect(marketTone('조정')).toBe('flat');
    expect(marketTone('')).toBe('flat');
  });
});

describe('52주 고점', () => {
  it('종가와 고점 대비 %로 되돌려 계산', () => {
    expect(high52w(90, -10)).toBeCloseTo(100);
    expect(high52w(100, 0)).toBe(100);
  });
  it('값이 없거나 -100% 이하면 null', () => {
    expect(high52w(100, null)).toBeNull();
    expect(high52w(100, -100)).toBeNull();
    expect(high52w(100, -150)).toBeNull();
  });
});

describe('필터', () => {
  it('기본값은 웹 DEFAULT_FILTERS 와 같다', () => {
    expect(DEFAULT_FILTERS).toEqual({ market: 'ALL', minPass: 0, required: [], sort: 'score', liquidOnly: true });
  });
  it('꼭 통과 항목 토글 — 없으면 뒤에 추가, 있으면 제거(원본 불변)', () => {
    const base = ['c' as const];
    expect(toggleRequired(base, 'l')).toEqual(['c', 'l']);
    expect(toggleRequired(base, 'c')).toEqual([]);
    expect(base).toEqual(['c']);
  });
  it('적용 중인 필터 수 — 기본은 0, 정렬은 세지 않는다', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, sort: 'rs' })).toBe(0);
  });
  it('적용 중인 필터 수 — 시장·최소 통과·거래 활발은 1씩, 꼭 통과는 고른 개수만큼', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, market: 'KOSDAQ' })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, minPass: 5 })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, liquidOnly: false })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, required: ['c', 'a', 'l'] })).toBe(3);
    expect(
      activeFilterCount({ market: 'KOSPI', minPass: 3, required: ['n'], sort: 'passCount', liquidOnly: false }),
    ).toBe(4);
  });
});

describe('목록 페이지', () => {
  it('이어 붙일 때 같은 티커는 한 번만(앞 페이지 것을 유지)', () => {
    const merged = mergeLeaderPage([item('A'), item('B')], [item('B'), item('C')]);
    expect(merged.map((x) => x.ticker)).toEqual(['A', 'B', 'C']);
  });
  it('더 불러오기 — 마지막 페이지가 50개로 꽉 찼고 total 보다 적을 때만', () => {
    expect(hasMoreLeaders(50, 120, 50)).toBe(true);
    expect(hasMoreLeaders(100, 100, 50)).toBe(false);
    expect(hasMoreLeaders(70, 120, 20)).toBe(false);
    expect(hasMoreLeaders(0, 0, 0)).toBe(false);
  });
});

describe('화면 상태', () => {
  it('목록 — 항목이 있으면 다시 불러오는 중·오류여도 목록', () => {
    expect(listView({ loading: true, error: null, date: '2026-10-20', count: 3 })).toBe('list');
    expect(listView({ loading: false, error: 'NETWORK', date: '2026-10-20', count: 3 })).toBe('list');
  });
  it('목록 — 항목이 없으면 로딩 > 오류 > 준비 중(date null) > 0건', () => {
    expect(listView({ loading: true, error: null, date: null, count: 0 })).toBe('loading');
    expect(listView({ loading: false, error: 'NETWORK', date: null, count: 0 })).toBe('error');
    expect(listView({ loading: false, error: null, date: null, count: 0 })).toBe('preparing');
    expect(listView({ loading: false, error: null, date: '2026-10-20', count: 0 })).toBe('empty');
  });
  it('상세 점수 — 데이터가 있으면 ready, 없으면 로딩·오류·비대상(null)', () => {
    expect(scoreView({ loading: false, error: 'NETWORK', data: { score: 1 } })).toBe('ready');
    expect(scoreView({ loading: true, error: null, data: null })).toBe('loading');
    expect(scoreView({ loading: false, error: 'GRAPHQL', data: null })).toBe('error');
    expect(scoreView({ loading: false, error: null, data: null })).toBe('none');
  });
});

describe('점수 추이 좌표', () => {
  it('0~100점을 높이에 맞춰 위아래 반전(기본 240×40)', () => {
    const h = [0, 50, 100].map((score, i) => ({ date: `d${i}`, score, passCount: 0 }));
    expect(historyPoints(h)).toBe('0,40 120,20 240,0');
  });
  it('점이 2개 미만이면 null', () => {
    expect(historyPoints([])).toBeNull();
    expect(historyPoints([{ date: 'd', score: 10, passCount: 1 }])).toBeNull();
  });
});
```

- [ ] **1-3. 실패 확인**

Run: `cd mobile && npx jest src/features/leaders/canslim.test.ts`
Expected: FAIL — `Cannot find module './canslim'`

- [ ] **1-4. 구현** — `mobile/src/features/leaders/canslim.ts`

```ts
// 주도주(CANSLIM) 화면용 순수 함수 — 웹 web_client/src/lib/canslim.ts 이식(색은 클래스 대신 테마 키) +
// 목록 페이지 병합·화면 상태 판정·점수 추이 좌표.
import type { CanslimHistoryPoint, CanslimItem, LetterKey, LetterStatus, ScreenFilters } from './types';

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

/** 다음 페이지 이어 붙이기 — 같은 티커는 한 번만(순위가 밀려 겹쳐 와도 중복 행 없음) */
export function mergeLeaderPage(prev: CanslimItem[], next: CanslimItem[]): CanslimItem[] {
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
```

- [ ] **1-5. 통과 확인**

Run: `cd mobile && npx jest src/features/leaders/canslim.test.ts`
Expected: PASS — 17 tests

- [ ] **1-6. 조회 함수·쿼리 작성** — `mobile/src/features/leaders/api.ts`

```ts
import { stockRequest } from '@/lib/api';

import { LEADERS_PAGE } from './canslim';
import type { CanslimMarket, CanslimScore, CanslimScreen, ScreenFilters } from './types';

// stock_api GraphQL 주도주(CANSLIM) 조회(공개). 쿼리 문자열은 backend/tests/test_market_query.py 계약 테스트가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.
// 문자열 안에 ${...} 끼워 넣기·백틱을 쓰지 말 것(테스트가 글자 그대로 실행한다).

export const SCREEN_QUERY = `query CanslimScreen($market: String!, $minPass: Int!, $required: [String!], $sort: String!,
  $liquidOnly: Boolean!, $limit: Int!, $offset: Int!) {
  canslimMarket { market date status close ma50 ma200 distributionDays }
  canslimScreen(market: $market, minPass: $minPass, required: $required, sort: $sort, liquidOnly: $liquidOnly,
    limit: $limit, offset: $offset) {
    date total
    items { ticker name market sectorName close score passCount liquid rs pctFromHigh letters { c a n s l i m } }
  }
}`;

export const SCORE_QUERY = `query CanslimScore($ticker: String!) {
  canslimScore(ticker: $ticker) {
    date ticker name market sectorName close score passCount marketStatus
    letters { key status value display threshold label explanation }
    history { date score passCount }
  }
}`;

/** 시장 방향 + 목록(offset 부터 50개) */
export async function fetchCanslimScreen(
  f: ScreenFilters,
  offset = 0,
): Promise<{ markets: CanslimMarket[]; screen: CanslimScreen }> {
  const vars = {
    market: f.market,
    minPass: f.minPass,
    required: f.required,
    sort: f.sort,
    liquidOnly: f.liquidOnly,
    limit: LEADERS_PAGE,
    offset,
  };
  const r = await stockRequest<{ canslimMarket: CanslimMarket[]; canslimScreen: CanslimScreen }>(SCREEN_QUERY, vars);
  return { markets: r.canslimMarket, screen: r.canslimScreen };
}

/** 종목 점수표 — 분석 대상이 아니면(ETF·우선주 등) null */
export async function fetchCanslimScore(ticker: string): Promise<CanslimScore | null> {
  return (await stockRequest<{ canslimScore: CanslimScore | null }>(SCORE_QUERY, { ticker })).canslimScore;
}
```

- [ ] **1-7. 계약 테스트 작성** — `backend/tests/test_market_query.py` 파일 **끝에** 추가(이 파일 맨 위에서 이미 `asyncio`·`pytest` 를 가져오고 있다. 나머지 import 는 함수 안에서 한다 — 기존 `_run_query_contract` 와 같은 방식)

```python
def test_mobile_leaders_queries_match_schema(monkeypatch):
    """모바일 주도주(mobile/src/features/leaders/api.ts) 쿼리를 그대로 꺼내 실제 스키마로 실행(앱↔API 계약)."""
    import pathlib
    import re

    from apps.stock_api.graphql.schema import schema
    from apps.stock_api.services import canslim_query as cq

    ts = (pathlib.Path(__file__).resolve().parents[2] / "mobile/src/features/leaders/api.ts").read_text(encoding="utf-8")
    queries = dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", ts))
    assert set(queries) == {"SCREEN_QUERY", "SCORE_QUERY"}
    assert "${" not in queries["SCREEN_QUERY"] and "${" not in queries["SCORE_QUERY"]

    seen = {}

    def fake_screen(**kw):
        seen.update(kw)
        return {"date": "2026-10-16", "total": 1, "items": [
            {"ticker": "AAA", "name": "에이", "market": "KOSDAQ", "sector_name": None, "close": 1.0, "score": 70,
             "pass_count": 5, "liquid": False, "letters": {k: 1 for k in "canslim"}, "rs": None,
             "pct_from_high": None}]}

    monkeypatch.setattr(cq, "markets", lambda: [{"market": "KOSPI", "date": "2026-10-16", "status": "조정", "close": 1.0,
                                                 "ma50": 1.0, "ma200": 1.0, "distribution_days": 4}])
    monkeypatch.setattr(cq, "screen", fake_screen)
    variables = {"market": "KOSDAQ", "minPass": 3, "required": ["c", "l"], "sort": "rs", "liquidOnly": False,
                 "limit": 50, "offset": 50}
    res = asyncio.run(schema.execute(queries["SCREEN_QUERY"], variable_values=variables))
    assert res.errors is None, res.errors
    assert res.data["canslimMarket"][0]["distributionDays"] == 4
    assert res.data["canslimScreen"]["items"][0]["letters"] == {k: 1 for k in "canslim"}
    assert res.data["canslimScreen"]["items"][0]["pctFromHigh"] is None
    assert seen == {"market": "KOSDAQ", "min_pass": 3, "required": ["c", "l"], "sort": "rs", "liquid_only": False,
                    "limit": 50, "offset": 50}

    monkeypatch.setattr(cq, "score", lambda ticker: None if ticker == "ETF1" else {
        "date": "2026-10-16", "ticker": ticker, "name": "에이", "market": "KOSPI", "sector_name": "전기·전자",
        "close": 1.0, "score": 80, "pass_count": 6, "market_status": "상승 추세",
        "letters": [{"key": "n", "status": 1, "value": -3.5, "display": "고점 대비 -3.5%", "threshold": "t",
                     "label": "신고가", "explanation": "e"}],
        "history": [{"date": "2026-10-16", "score": 80, "pass_count": 6}]})
    res = asyncio.run(schema.execute(queries["SCORE_QUERY"], variable_values={"ticker": "AAA"}))
    assert res.errors is None, res.errors
    assert res.data["canslimScore"]["letters"][0] == {"key": "n", "status": 1, "value": -3.5,
                                                      "display": "고점 대비 -3.5%", "threshold": "t",
                                                      "label": "신고가", "explanation": "e"}
    assert res.data["canslimScore"]["history"][0]["passCount"] == 6
    res = asyncio.run(schema.execute(queries["SCORE_QUERY"], variable_values={"ticker": "ETF1"}))
    assert res.errors is None and res.data["canslimScore"] is None  # 비대상은 null(앱이 "분석 대상 아님" 표시)
```

- [ ] **1-8. 계약 테스트 실행**

Run: `cd backend && uv run pytest -p no:warnings tests/test_market_query.py`
Expected: `44 passed`(기준 43 + 1). 실패하면 모바일 `api.ts` 의 쿼리 글자를 고친다(서버 코드는 고치지 않는다).

- [ ] **1-9. 전체 검증**

Run: `cd mobile && npx jest && npm run typecheck`
Expected: `Tests: 546 passed`(529 + 17), 타입 오류 0

Run: `cd backend && uv run pytest -p no:warnings`
Expected: `1357 passed`

- [ ] **1-10. 커밋**

```bash
git add mobile/src/features/leaders/types.ts
git add mobile/src/features/leaders/canslim.ts
git add mobile/src/features/leaders/canslim.test.ts
git add mobile/src/features/leaders/api.ts
git add backend/tests/test_market_query.py
git commit -m "$(cat <<'EOF'
feat(mobile): 주도주 타입·순수 로직·GraphQL 쿼리 + 모바일 쿼리 계약 테스트

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 2: 데이터 훅 — 목록(필터·페이지·새로고침) · 점수 조회

**파일:**
- 생성: `mobile/src/features/leaders/use-canslim-screen.ts`
- 생성: `mobile/src/features/leaders/use-canslim-score.ts`

훅은 렌더 테스트 대상이 아니다(관례). 판단 로직(병합·더 불러오기·상태)은 작업 1 에서 이미 테스트했다. 구조는 `mobile/src/features/market/use-group-ranking.ts` 를 그대로 본뜬다. `createLatest`·`errorCode` 는 market 에서 가져오고 복제하지 않는다.

- [ ] **2-1. 목록 훅** — `mobile/src/features/leaders/use-canslim-screen.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

import { fetchCanslimScreen } from './api';
import { DEFAULT_FILTERS, hasMoreLeaders, mergeLeaderPage } from './canslim';
import type { CanslimItem, CanslimMarket, CanslimSort, ScreenFilters } from './types';

type State = {
  markets: CanslimMarket[];
  items: CanslimItem[];
  total: number;
  date: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
};

const INITIAL: State = {
  markets: [], items: [], total: 0, date: null, hasMore: false,
  loading: true, error: null, loadingMore: false, moreFailed: false,
};

/** 주도주 목록 — 필터·정렬 조건, 50개씩 더 불러오기, 조건을 빠르게 바꿔도 마지막 요청만 반영(useGroupRanking 과 같은 구조) */
export function useCanslimScreen() {
  const [filters, setFilters] = useState<ScreenFilters>(DEFAULT_FILTERS);
  const [state, setState] = useState<State>(INITIAL);
  const gate = useRef(createLatest()).current;

  const fetchFirst = useCallback(async () => {
    const { markets, screen } = await fetchCanslimScreen(filters, 0);
    return {
      markets,
      items: screen.items,
      total: screen.total,
      date: screen.date,
      hasMore: hasMoreLeaders(screen.items.length, screen.total, screen.items.length),
    };
  }, [filters]);

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

  /** 당겨서 새로고침 — 기존 목록 유지, 성공하면 첫 페이지로 교체(실패는 throw → usePullRefresh 가 토스트) */
  const refresh = useCallback(async () => {
    const id = gate.next();
    let first: Awaited<ReturnType<typeof fetchFirst>>;
    try {
      first = await fetchFirst();
    } catch (e) {
      // 더 새 요청에 밀렸으면 그쪽이 상태를 정한다
      if (!gate.isLatest(id)) return;
      // 진행 중이던 reload 를 대신 끝맺을 때는 reload 실패와 같게, loadMore 만 밀어냈으면 목록은 두고 표시만 끈다
      setState((s) =>
        s.loading ? { ...INITIAL, loading: false, error: errorCode(e) } : { ...s, loadingMore: false },
      );
      throw e;
    }
    if (!gate.isLatest(id)) return;
    setState({ ...INITIAL, ...first, loading: false });
  }, [fetchFirst, gate]);

  /** 목록 끝에서 다음 50개 — 번호를 올리지 않고 지금 조건의 응답일 때만 반영 */
  const loadMore = useCallback(async () => {
    if (state.loading || state.loadingMore || !state.hasMore) return;
    const id = gate.current();
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false }));
    try {
      const { screen } = await fetchCanslimScreen(filters, state.items.length);
      if (!gate.isLatest(id)) return;
      setState((s) => {
        const items = mergeLeaderPage(s.items, screen.items);
        return {
          ...s,
          items,
          total: screen.total,
          hasMore: hasMoreLeaders(items.length, screen.total, screen.items.length),
          loadingMore: false,
        };
      });
    } catch {
      if (!gate.isLatest(id)) return;
      setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
    }
  }, [filters, gate, state.hasMore, state.items.length, state.loading, state.loadingMore]);

  const setSort = useCallback((sort: CanslimSort) => setFilters((f) => ({ ...f, sort })), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, filters, setFilters, setSort, reload, refresh, loadMore };
}
```

- [ ] **2-2. 점수 훅** — `mobile/src/features/leaders/use-canslim-score.ts`

```ts
import { useCallback, useEffect, useState } from 'react';

import { errorCode } from '@/features/market/format';

import { fetchCanslimScore } from './api';
import type { CanslimScore } from './types';

type State = { data: CanslimScore | null; loading: boolean; error: string | null };

/** 종목 점수표 — data null + 오류 없음 = 분석 비대상(scoreView 가 'none'). 차트 조회와는 독립 */
export function useCanslimScore(ticker: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchCanslimScore(ticker);
      setState({ data, loading: false, error: null });
    } catch (e) {
      // 이미 보이던 점수표는 남긴다(scoreView 는 data 가 있으면 ready)
      setState((s) => ({ data: s.data, loading: false, error: errorCode(e) }));
    }
  }, [ticker]);

  /** 당겨서 새로고침 — 기존 내용 유지(실패는 throw → 토스트) */
  const refresh = useCallback(async () => {
    const data = await fetchCanslimScore(ticker);
    setState({ data, loading: false, error: null });
  }, [ticker]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh };
}
```

- [ ] **2-3. 검증**

Run: `cd mobile && npm run typecheck && npx jest`
Expected: 타입 오류 0, `Tests: 546 passed`

- [ ] **2-4. 커밋**

```bash
git add mobile/src/features/leaders/use-canslim-screen.ts
git add mobile/src/features/leaders/use-canslim-score.ts
git commit -m "$(cat <<'EOF'
feat(mobile): 주도주 데이터 훅 — 필터·정렬·50개씩 더 불러오기·당겨서 새로고침, 종목 점수 조회

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 3: 목록 컴포넌트 — 배지 · 시장 줄 · 행 · 필터 시트 · LeadersSection

**파일:**
- 생성: `mobile/src/features/leaders/components/letter-badges.tsx`
- 생성: `mobile/src/features/leaders/components/market-strip.tsx`
- 생성: `mobile/src/features/leaders/components/leader-row.tsx`
- 생성: `mobile/src/features/leaders/components/filter-sheet.tsx`
- 생성: `mobile/src/features/leaders/sections/leaders-section.tsx`

스크리너 칩 등록과 화면 이동은 **작업 5** 에서 한다(typedRoutes — "설계와 다르게 정한 것" 표). 이 작업의 `LeadersSection` 은 `onOpenStock(ticker, name)` 콜백만 받는다.

- [ ] **3-1. 배지** — `mobile/src/features/leaders/components/letter-badges.tsx`

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { LETTER_KEYS, LETTER_NAMES, letterStatusText, letterTone } from '../canslim';
import type { CanslimLetters, LetterKey, LetterStatus } from '../types';

type Size = 'sm' | 'lg';

/** C~M 배지 하나 — 통과=primary 바탕 흰 글자, 미달=fill 바탕, 부족·준비 중=점선 테두리 */
export function LetterBadge({ letter, status, size = 'sm' }: { letter: LetterKey; status: LetterStatus; size?: Size }) {
  const tone = letterTone(status);
  return (
    <View
      style={[styles.badge, styles[size], styles[tone]]}
      accessible
      accessibilityLabel={`${letter.toUpperCase()} ${LETTER_NAMES[letter]} ${letterStatusText(status)}`}
    >
      <Text style={[styles.text, styles[`${size}Text`], styles[`${tone}Text`]]} allowFontScaling={false}>
        {letter.toUpperCase()}
      </Text>
    </View>
  );
}

/** 목록 행의 배지 7개(C A N S L I M 순서) */
export function LetterBadges({ letters }: { letters: CanslimLetters }) {
  return (
    <View style={styles.row}>
      {LETTER_KEYS.map((k) => (
        <LetterBadge key={k} letter={k} status={letters[k]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', gap: 3 },
  badge: { alignItems: 'center', justifyContent: 'center' },
  sm: { width: 18, height: 18, borderRadius: 5 },
  lg: { width: 32, height: 32, borderRadius: 8 },
  text: { fontWeight: '800' },
  smText: { fontSize: 10 },
  lgText: { fontSize: 15 },
  pass: { backgroundColor: theme.colors.primary },
  fail: { backgroundColor: theme.colors.fill },
  none: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.textSecondary },
  passText: { color: '#ffffff' },
  failText: { color: theme.colors.textSecondary },
  noneText: { color: theme.colors.textSecondary },
}));
```

- [ ] **3-2. 시장 방향 줄** — `mobile/src/features/leaders/components/market-strip.tsx`

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { marketTone } from '../canslim';
import type { CanslimMarket } from '../types';

/** 시장 방향(CANSLIM 의 M) — KOSPI·KOSDAQ 상태·분산일 + 기준일·갱신·투자 권유 아님 안내 */
export function MarketStrip({ markets, date }: { markets: CanslimMarket[]; date: string | null }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>시장 방향</Text>
        {markets.length === 0 ? <Text style={styles.muted}>지수 데이터를 모으고 있어요</Text> : null}
        {markets.map((m) => {
          const tone = marketTone(m.status);
          return (
            <View key={m.market} style={[styles.pill, styles[`${tone}Bg`]]}>
              <Text style={[styles.pillText, styles[tone]]}>
                {m.market} {m.status}
                <Text style={styles.days}> · 분산일 {m.distributionDays}일</Text>
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.note}>
        {date ? `${date} 종가 기준` : '분석 데이터를 준비하고 있어요'} · 매일 20:30 갱신 · 투자 권유가 아닙니다
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap(1) },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  muted: { fontSize: 13, color: theme.colors.textSecondary },
  pill: { borderRadius: theme.radius.chip, paddingHorizontal: theme.gap(1.25), paddingVertical: theme.gap(0.5) },
  pillText: { fontSize: 13, fontWeight: '700' },
  days: { fontSize: 12, fontWeight: '500' },
  upBg: { backgroundColor: theme.colors.upSoft },
  downBg: { backgroundColor: theme.colors.downSoft },
  flatBg: { backgroundColor: theme.colors.fill },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  note: { fontSize: 12, color: theme.colors.textSecondary },
}));
```

- [ ] **3-3. 목록 행** — `mobile/src/features/leaders/components/leader-row.tsx`

```tsx
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, formatIndex } from '@/features/market/format';

import type { CanslimItem } from '../types';
import { LetterBadges } from './letter-badges';

/** 주도주 목록 한 줄 — 점수 상자·종목명/티커·C~M 배지·업종(없으면 시장)·RS·종가·고점 대비. 누르면 onPress */
export function LeaderRow({ item, onPress }: { item: CanslimItem; onPress: () => void }) {
  // 라벨이 자식 글자를 덮으므로 화면 낭독기가 들을 값을 모두 담는다
  const label = [
    `${item.name} ${item.ticker}`,
    `${item.score}점`,
    `7개 중 ${item.passCount}개 통과`,
    item.sectorName ?? item.market,
    item.rs !== null ? `RS ${item.rs}` : '',
    `종가 ${formatIndex(item.close)}원`,
    item.pctFromHigh !== null ? `고점 대비 ${formatChg(item.pctFromHigh)}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="종목 상세 보기"
    >
      <View style={styles.scoreBox}>
        <Text style={styles.score}>{item.score}</Text>
        <Text style={styles.unit}>점</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.ticker}>{item.ticker}</Text>
        </View>
        <LetterBadges letters={item.letters} />
        <Text style={styles.meta} numberOfLines={1}>
          {item.sectorName ?? item.market}
          {item.rs !== null ? ` · RS ${item.rs}` : ''}
        </Text>
      </View>
      <View style={styles.nums}>
        <Text style={styles.price}>{formatIndex(item.close)}</Text>
        {item.pctFromHigh !== null ? <Text style={styles.meta}>고점 {formatChg(item.pctFromHigh)}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), paddingVertical: theme.gap(1.25) },
  pressed: { opacity: 0.6 },
  scoreBox: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.fill,
    alignItems: 'center', justifyContent: 'center',
  },
  score: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  unit: { fontSize: 10, color: theme.colors.textSecondary },
  body: { flex: 1, gap: theme.gap(0.5) },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75) },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  ticker: { fontSize: 12, color: theme.colors.textSecondary },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  nums: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
}));
```

- [ ] **3-4. 필터 바텀시트** — `mobile/src/features/leaders/components/filter-sheet.tsx`

```tsx
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { BottomSheet, Button, Chip } from '@/ui';

import { DEFAULT_FILTERS, LETTER_KEYS, LETTER_NAMES, toggleRequired } from '../canslim';
import type { MarketFilter, ScreenFilters } from '../types';

const MARKETS: [MarketFilter, string][] = [['ALL', '전체'], ['KOSPI', 'KOSPI'], ['KOSDAQ', 'KOSDAQ']];
const MIN_PASS = [0, 3, 4, 5, 6, 7];

type Props = { value: ScreenFilters; onApply: (f: ScreenFilters) => void; onClose: () => void };

/**
 * 필터 바텀시트 — 시장·최소 통과 수·꼭 통과할 항목·거래 활발 종목만. 시트 안에서는 초안만 바꾸고 [적용]에서 반영.
 * [초기화]는 초안을 기본값으로(정렬은 시트 밖 칩이라 유지). 닫으면 초안은 버린다. 호출부가 열 때 마운트한다.
 */
export function FilterSheet({ value, onApply, onClose }: Props) {
  const { theme } = useUnistyles();
  const [draft, setDraft] = useState<ScreenFilters>(value);
  const set = (patch: Partial<ScreenFilters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <BottomSheet title="필터" onClose={onClose}>
      <Text style={styles.label}>시장</Text>
      <View style={styles.chips}>
        {MARKETS.map(([v, t]) => (
          <Chip key={v} label={t} selected={draft.market === v} onPress={() => set({ market: v })} />
        ))}
      </View>
      <Text style={styles.label}>최소 통과 수</Text>
      <View style={styles.chips}>
        {MIN_PASS.map((n) => (
          <Chip key={n} label={n === 0 ? '전부' : `${n}개 이상`} selected={draft.minPass === n} onPress={() => set({ minPass: n })} />
        ))}
      </View>
      <Text style={styles.label}>꼭 통과할 항목</Text>
      <View style={styles.chips}>
        {LETTER_KEYS.map((k) => (
          <Chip
            key={k}
            label={`${k.toUpperCase()} ${LETTER_NAMES[k]}`}
            selected={draft.required.includes(k)}
            onPress={() => set({ required: toggleRequired(draft.required, k) })}
          />
        ))}
      </View>
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text style={styles.switchTitle}>거래 활발 종목만</Text>
          <Text style={styles.hint}>하루 평균 거래대금 10억 원·주가 1,000원 이상</Text>
        </View>
        <Switch
          value={draft.liquidOnly}
          onValueChange={(v) => set({ liquidOnly: v })}
          trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
          accessibilityLabel="거래 활발 종목만"
        />
      </View>
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button label="초기화" variant="secondary" onPress={() => setDraft({ ...DEFAULT_FILTERS, sort: value.sort })} />
        </View>
        <View style={styles.flex}>
          <Button label="적용" onPress={() => onApply({ ...draft, sort: value.sort })} />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  label: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5) },
  flex: { flex: 1 },
  switchTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  hint: { fontSize: 12, color: theme.colors.textSecondary },
  buttons: { flexDirection: 'row', gap: theme.gap(1), marginTop: theme.gap(1) },
}));
```

- [ ] **3-5. 칩 화면 조립** — `mobile/src/features/leaders/sections/leaders-section.tsx`

```tsx
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatIndex } from '@/features/market/format';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip, ListState } from '@/ui';

import { activeFilterCount, listView } from '../canslim';
import { FilterSheet } from '../components/filter-sheet';
import { LeaderRow } from '../components/leader-row';
import { MarketStrip } from '../components/market-strip';
import type { CanslimSort } from '../types';
import { useCanslimScreen } from '../use-canslim-screen';

const SORTS: [CanslimSort, string][] = [['score', '점수'], ['rs', 'RS'], ['passCount', '통과 수']];

/** 주도주 칩 — 정렬 칩·[필터]·시장 방향 줄·목록(끝까지 내리면 50개 더). 행을 누르면 onOpenStock */
export function LeadersSection({ onOpenStock }: { onOpenStock: (ticker: string, name: string) => void }) {
  const r = useCanslimScreen();
  const { refreshing, onRefresh } = usePullRefresh(r.refresh);
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = listView({ loading: r.loading, error: r.error, date: r.date, count: r.items.length });
  const filterCount = activeFilterCount(r.filters);
  const lastIndex = r.items.length - 1;

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        {SORTS.map(([v, t]) => <Chip key={v} label={t} selected={r.filters.sort === v} onPress={() => r.setSort(v)} />)}
        <Pressable
          style={styles.filterBtn}
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={filterCount > 0 ? `필터, ${filterCount}개 적용 중` : '필터'}
        >
          <Text style={styles.filterText}>필터</Text>
          {filterCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {view === 'loading' ? (
        <ListState mode="loading" />
      ) : (
        <FlatList
          contentContainerStyle={[styles.list, r.items.length === 0 && styles.grow]}
          data={r.items}
          keyExtractor={(it) => it.ticker}
          ListHeaderComponent={
            view === 'error' ? null : (
              <View style={styles.header}>
                <MarketStrip markets={r.markets} date={r.date} />
                {view === 'list' ? <Text style={styles.total}>총 {formatIndex(r.total)}개</Text> : null}
              </View>
            )
          }
          renderItem={({ item, index }) => (
            <View style={[styles.item, index === 0 && styles.first, index === lastIndex && styles.last]}>
              <LeaderRow item={item} onPress={() => onOpenStock(item.ticker, item.name)} />
            </View>
          )}
          ItemSeparatorComponent={() => (
            <View style={styles.item}>
              <View style={styles.line} />
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing || (r.loading && r.items.length > 0)} onRefresh={onRefresh} />}
          onEndReached={() => {
            if (!r.moreFailed) void r.loadMore();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            view === 'error' ? (
              <ListState mode="error" title="주도주를 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${r.error})`} onRetry={r.reload} />
            ) : view === 'preparing' ? (
              <ListState mode="empty" emoji="🛠️" title="분석 데이터를 준비하고 있어요" hint="매일 장 마감 후 계산돼요" />
            ) : (
              <ListState mode="empty" emoji="🔎" title="조건에 맞는 종목이 없어요" hint="필터를 줄여 보세요" />
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
              </View>
            )
          }
        />
      )}
      {sheetOpen ? (
        <FilterSheet
          value={r.filters}
          onApply={(f) => {
            r.setFilters(f);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  controls: {
    flexDirection: 'row', alignItems: 'center', gap: theme.gap(1),
    paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(1),
  },
  filterBtn: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5),
    borderRadius: theme.radius.chip, paddingVertical: theme.gap(0.75), paddingHorizontal: theme.gap(1.5),
    backgroundColor: theme.colors.fill,
  },
  filterText: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent,
  },
  badgeText: { fontSize: 11, fontWeight: '800', color: '#ffffff' },
  list: { paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(2) },
  grow: { flexGrow: 1 },
  header: { gap: theme.gap(1), paddingBottom: theme.gap(1) },
  total: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(0.5) },
  item: { backgroundColor: theme.colors.surface, paddingHorizontal: theme.gap(2) },
  first: { borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card },
  last: { borderBottomLeftRadius: theme.radius.card, borderBottomRightRadius: theme.radius.card },
  line: { height: 1, backgroundColor: theme.colors.border },
  more: { paddingVertical: theme.gap(1.5), alignItems: 'center' },
  moreText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
}));
```

- [ ] **3-6. 검증**

Run: `cd mobile && npm run typecheck && npx jest`
Expected: 타입 오류 0, `Tests: 546 passed`

- [ ] **3-7. 커밋**

```bash
git add mobile/src/features/leaders/components/letter-badges.tsx
git add mobile/src/features/leaders/components/market-strip.tsx
git add mobile/src/features/leaders/components/leader-row.tsx
git add mobile/src/features/leaders/components/filter-sheet.tsx
git add mobile/src/features/leaders/sections/leaders-section.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): 주도주 목록 화면 조각 — C~M 배지·시장 방향 줄·목록 행·필터 바텀시트·LeadersSection

스크리너 칩 등록과 종목 상세 이동은 라우트 생성(작업 5) 뒤에 연결한다(typedRoutes).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 4: 차트 — 이동평균 기간·첫 화면 일수 인자(게임 회귀 없음) + 종목 일봉 차트 래퍼

**파일:**
- 수정: `mobile/src/features/game/lib/chart-bridge.ts:22`(주석), `:84-99`(`indicatorData`), `:101-118`(`lastIndicatorValues`), `:121-130`(`initialRange`), `:133-136`(`loadMessage`), `:139-143`(`tickMessage`)
- 수정: `mobile/src/features/game/lib/chart-bridge.test.ts`(파일 끝에 추가)
- 수정: `mobile/src/features/game/components/tv-chart.tsx:6-14`(import), `:19-27`(props), `:35`(시그니처), `:49-58`(데이터 effect)
- 수정: `mobile/src/features/game/api.ts:337-347`(`getDailyCandles`)
- 생성: `mobile/src/features/leaders/stock-chart.ts`, `stock-chart.test.ts`
- 생성: `mobile/src/features/leaders/use-daily-candles.ts`
- 생성: `mobile/src/features/leaders/components/stock-daily-chart.tsx`

**회귀 기준(게임):** 기존 `chart-bridge.test.ts` 를 고치지 않고 통과한다. `candle-chart.tsx` 의 `TvChart`·`getDailyCandles` 호출은 수정하지 않는다. `chart-page.ts` 는 바꾸지 않는다 — 그래서 `node scripts/gen-lwc-bundle.js` 를 다시 돌릴 필요가 없다(이 스크립트는 `web_client/node_modules/lightweight-charts` 원본만 `lwc-bundle.generated.ts` 로 묶는다).

- [ ] **4-1. 실패하는 테스트 작성** — `mobile/src/features/game/lib/chart-bridge.test.ts` 파일 **끝에** 추가(파일 위쪽 import·`day` 도우미를 그대로 쓴다)

```ts
describe('이동평균 기간·첫 화면 일수 인자(종목 상세용)', () => {
  // 2026-01-01 부터 60일, 종가 1..60
  const iso = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
  const rows = Array.from({ length: 60 }, (_, i) => day(iso(i), i + 1));
  const NOW = Date.UTC(2026, 2, 1, 3); // KST 2026-03-01 12:00 = 마지막 봉 날짜

  it('기본값은 5·20·60 을 명시한 것과 같다(게임 화면 그대로)', () => {
    expect(loadMessage({ kind: 'day', rows }, false, NOW)).toEqual(
      loadMessage({ kind: 'day', rows }, false, NOW, { maPeriods: [5, 20, 60] }),
    );
  });
  it('[50] 이면 첫째 칸(ma5)에 50일선만, 둘째·셋째 칸은 빈 배열', () => {
    const msg = loadMessage({ kind: 'day', rows }, false, NOW, { maPeriods: [50] });
    if (msg.type !== 'load') throw new Error('load 아님');
    expect(msg.ind.ma5).toHaveLength(11);
    expect(msg.ind.ma5[0]).toEqual({ time: iso(49), value: 25.5 });
    expect(msg.ind.ma5[10]).toEqual({ time: iso(59), value: 35.5 });
    expect(msg.ind.ma20).toEqual([]);
    expect(msg.ind.ma60).toEqual([]);
    expect(msg.ind.bbUpper.length).toBeGreaterThan(0); // 볼린저는 그대로 계산(표시는 vis 로 끔)
  });
  it('마지막 값·틱도 같은 기간을 쓴다', () => {
    const bars = toBars({ kind: 'day', rows });
    const v = lastIndicatorValues(bars, [50]);
    expect(v.ma5).toBe(35.5);
    expect(v).not.toHaveProperty('ma20');
    expect(v).not.toHaveProperty('ma60');
    const tick = tickMessage({ kind: 'day', rows }, [50]);
    if (tick?.type !== 'tick') throw new Error('tick 아님');
    expect(tick.ind.ma5).toBe(35.5);
  });
  it('첫 화면 일수 — 기본 180일이면 전체 맞춤, 10일이면 최근 10일부터', () => {
    const bars = toBars({ kind: 'day', rows });
    expect(initialRange('day', bars, NOW)).toBe('fit');
    expect(initialRange('day', bars, NOW, 10)).toEqual({ from: 49, to: 59 }); // 2026-02-19 부터
  });
  it('loadMessage 도 visibleDays 를 첫 화면에 쓴다', () => {
    const msg = loadMessage({ kind: 'day', rows }, false, NOW, { visibleDays: 10 });
    if (msg.type !== 'load') throw new Error('load 아님');
    expect(msg.range).toEqual({ from: 49, to: 59 });
  });
});
```

- [ ] **4-2. 실패 확인**

Run: `cd mobile && npx jest src/features/game/lib/chart-bridge.test.ts`
Expected: FAIL — 새 테스트 중 **4개가 실패**한다(예: `[50]` 테스트에서 `ma5` 길이가 56, `initialRange(..., 10)` 이 `'fit'`). "기본값은 5·20·60 을 명시한 것과 같다" 1개는 회귀 고정용이라 구현 전에도 통과한다(jest 는 babel 로 돌아 넷째 인자를 그냥 무시하므로 양쪽 결과가 같다). 기존 테스트는 통과. 타입 검사는 4-3 뒤에 한다.

- [ ] **4-3. `chart-bridge.ts` 구현**

(1) 22행의 `IndicatorKey` 선언 **바로 위**에 주석 한 줄을 추가한다
```ts
// ma5·ma20·ma60 은 "첫째·둘째·셋째 이동평균 칸" 이름이다(기본 5·20·60일, maPeriods 로 기간을 바꿔도 칸 이름은 그대로)
```

(2) `export const DAILY_VISIBLE_DAYS = 180;` 줄(64행) **바로 위**에 추가
```ts
/** 이동평균 기간(최대 3칸, 앞에서부터 ma5·ma20·ma60 칸에 들어감). 기본은 게임과 같은 MA_PERIODS(5·20·60) */
export type MaPeriods = readonly number[];
/** 전체 로드 선택 인자 — 종목 상세는 [50]·365일, 게임은 생략(기본값) */
export interface LoadOptions {
  maPeriods?: MaPeriods;
  visibleDays?: number;
}
```

(3) `indicatorData` 전체(84~99행)를 다음으로 바꾼다
```ts
/** 종가로 지표 전체 계산(값이 없는 앞 구간은 점을 빼서 선이 그 지점부터 시작). 기간이 없는 칸은 빈 배열 */
export function indicatorData(bars: Bar[], maPeriods: MaPeriods = MA_PERIODS): IndicatorData {
  const closes = bars.map((b) => b.close);
  const line = (values: (number | null)[]): LinePoint[] =>
    values.flatMap((v, i) => (v === null ? [] : [{ time: bars[i].time, value: v }]));
  const ma = (slot: number): LinePoint[] => {
    const p = maPeriods[slot];
    return p ? line(sma(closes, p)) : [];
  };
  const bands = bollinger(closes);
  return {
    ma5: ma(0),
    ma20: ma(1),
    ma60: ma(2),
    bbUpper: line(bands.map((b) => b?.upper ?? null)),
    bbMiddle: line(bands.map((b) => b?.middle ?? null)),
    bbLower: line(bands.map((b) => b?.lower ?? null)),
  };
}
```

(4) `lastIndicatorValues` 전체(101~118행)를 다음으로 바꾼다
```ts
/** 마지막 막대의 지표 값만(틱마다 전체 setData 대신 update — 스크롤 위치가 흔들리지 않게) */
export function lastIndicatorValues(bars: Bar[], maPeriods: MaPeriods = MA_PERIODS): Partial<Record<IndicatorKey, number>> {
  const n = bars.length;
  if (n === 0) return {};
  const closes = bars.map((b) => b.close);
  const out: Partial<Record<IndicatorKey, number>> = {};
  const pick = (k: IndicatorKey, v: number | null | undefined) => {
    if (v != null) out[k] = v;
  };
  const maAt = (slot: number): number | null => {
    const p = maPeriods[slot];
    return p ? sma(closes, p)[n - 1] : null;
  };
  pick('ma5', maAt(0));
  pick('ma20', maAt(1));
  pick('ma60', maAt(2));
  const b = bollinger(closes)[n - 1];
  pick('bbUpper', b?.upper);
  pick('bbMiddle', b?.middle);
  pick('bbLower', b?.lower);
  return out;
}
```

(5) `initialRange` 의 첫 줄과 일봉 분기를 바꾼다(121~130행). 함수 전체:
```ts
/** 첫 화면 구간 — 일봉: 최근 visibleDays 일(기본 180), 분봉: 최근 120개(웹 TradingChart 와 같은 규칙) */
export function initialRange(
  mode: ChartMode,
  bars: Bar[],
  nowMs: number = Date.now(),
  visibleDays: number = DAILY_VISIBLE_DAYS,
): VisibleRange {
  const n = bars.length;
  if (n === 0) return null;
  if (mode === 'day') {
    const from = kstDateString(new Date(nowMs - visibleDays * 86_400_000));
    const hidden = bars.findIndex((b) => String(b.time) >= from);
    return hidden > 0 ? { from: hidden, to: n - 1 } : 'fit';
  }
  return n > INTRADAY_VISIBLE_BARS ? { from: n - INTRADAY_VISIBLE_BARS, to: n - 1 } : 'fit';
}
```

(6) `loadMessage`(133~136행)와 `tickMessage`(139~143행)를 다음으로 바꾼다
```ts
/** 전체 로드 메시지. keepView=true 면(같은 단위 재조회) 사용자가 보던 위치 유지 */
export function loadMessage(
  data: ChartRows,
  keepView: boolean,
  nowMs: number = Date.now(),
  opts: LoadOptions = {},
): ChartMessage {
  const bars = toBars(data);
  return {
    type: 'load',
    mode: data.kind,
    bars,
    ind: indicatorData(bars, opts.maPeriods),
    range: initialRange(data.kind, bars, nowMs, opts.visibleDays),
    keepView,
  };
}

/** 틱 메시지 — 마지막 막대 + 그 지표 값. 데이터가 없으면 null */
export function tickMessage(data: ChartRows, maPeriods: MaPeriods = MA_PERIODS): ChartMessage | null {
  const bars = toBars(data);
  if (bars.length === 0) return null;
  return { type: 'tick', bar: bars[bars.length - 1], ind: lastIndicatorValues(bars, maPeriods) };
}
```
(`opts.maPeriods`·`opts.visibleDays` 가 `undefined` 면 각 함수의 기본값이 쓰인다.)

- [ ] **4-4. 통과 확인**

Run: `cd mobile && npx jest src/features/game/lib/chart-bridge.test.ts`
Expected: PASS — 기존 테스트 + 새 5개

- [ ] **4-5. `TvChart` prop 추가** — `mobile/src/features/game/components/tv-chart.tsx`

(1) import(6~14행)를 다음으로 바꾼다
```tsx
import {
  DAILY_VISIBLE_DAYS,
  loadMessage,
  tickMessage,
  toInjectScript,
  type ChartColors,
  type ChartLine,
  type ChartMessage,
  type ChartRows,
  type MaPeriods,
} from '../lib/chart-bridge';
import { MA_PERIODS } from '../lib/indicators';
```

(2) `TvChartProps`(19~27행)를 다음으로 바꾼다
```tsx
type TvChartProps = {
  view: TvChartData | null;
  lines: ChartLine[];
  ma: boolean;
  bb: boolean;
  colors: ChartColors;
  height: number;
  onReady?: () => void;
  /** 이동평균 기간(생략 = 5·20·60, 게임). 렌더마다 새 배열을 넘기지 말 것(모듈 상수로) */
  maPeriods?: MaPeriods;
  /** 일봉 첫 화면 일수(생략 = 180, 게임) */
  visibleDays?: number;
};
```

(3) 함수 시그니처(35행)를 다음으로 바꾼다
```tsx
export function TvChart({
  view,
  lines,
  ma,
  bb,
  colors,
  height,
  onReady,
  maPeriods = MA_PERIODS,
  visibleDays = DAILY_VISIBLE_DAYS,
}: TvChartProps) {
```

(4) 데이터 effect(49~58행)를 다음으로 바꾼다
```tsx
  useEffect(() => {
    if (!ready || view === null) return;
    if (sentSeq.current !== view.seq) {
      // 새 WebView(sentSeq=null)면 보던 위치가 없으니 첫 화면 구간부터
      send(loadMessage(view.data, sentSeq.current !== null && view.keepView, Date.now(), { maPeriods, visibleDays }));
      sentSeq.current = view.seq;
    } else {
      send(tickMessage(view.data, maPeriods));
    }
  }, [ready, view, maPeriods, visibleDays]);
```
(게임은 두 prop 을 넘기지 않으므로 기본값이 모듈 상수 — 의존성이 바뀌지 않아 동작이 지금과 같다.)

- [ ] **4-6. 일봉 조회 기간 인자** — `mobile/src/features/game/api.ts` 의 `getDailyCandles`(337~347행) 전체를 다음으로 바꾼다
```ts
/** 최근 약 180일 일봉(lookbackDays 로 늘릴 수 있음 — 종목 상세는 1년 + 50일선 워밍업). GraphQL 오류·빈 응답이면 throw(차트만 오류 표시) */
export async function getDailyCandles(
  ticker: string,
  now: Date = new Date(),
  lookbackDays: number = LOOKBACK_DAYS,
): Promise<DailyCandle[]> {
  const data = await stockRequest<DailyResponse, DailyVars>(DAILY_QUERY, {
    symbol: ticker,
    startDate: kstDateString(new Date(now.getTime() - lookbackDays * DAY_MS)),
    endDate: kstDateString(now),
  });
  const candles = data.getChartData?.candles;
  if (!candles || candles.length === 0) throw new Error('일봉 데이터 없음');
  return candles;
}
```

- [ ] **4-7. 실패하는 테스트 작성** — `mobile/src/features/leaders/stock-chart.test.ts`

```ts
import { STOCK_CHART_LOOKBACK_DAYS, STOCK_CHART_MA, STOCK_CHART_VISIBLE_DAYS, stockChartLines } from './stock-chart';

describe('종목 상세 차트 설정', () => {
  it('52주 고점이 없거나 숫자가 아니면 가격선 없음', () => {
    expect(stockChartLines(null, '#999999')).toEqual([]);
    expect(stockChartLines(Number.NaN, '#999999')).toEqual([]);
  });
  it('52주 고점은 점선·자동 범위 포함(화면 밖으로 사라지지 않게), 50일선·1년 화면·워밍업 기간', () => {
    expect(stockChartLines(72800, '#999999')).toEqual([
      { price: 72800, color: '#999999', width: 1, dashed: true, title: '52주 고점', fit: 'day' },
    ]);
    expect(STOCK_CHART_MA).toEqual([50]);
    expect(STOCK_CHART_VISIBLE_DAYS).toBe(365);
    expect(STOCK_CHART_LOOKBACK_DAYS).toBeGreaterThanOrEqual(STOCK_CHART_VISIBLE_DAYS + 70);
  });
});
```

Run: `cd mobile && npx jest src/features/leaders/stock-chart.test.ts`
Expected: FAIL — `Cannot find module './stock-chart'`

- [ ] **4-8. 구현** — `mobile/src/features/leaders/stock-chart.ts`

```ts
// 종목 상세 일봉 차트 설정 — 게임 차트(TvChart·chart-bridge)를 그대로 쓰고 기간·가격선만 정한다.
import type { ChartLine } from '@/features/game/lib/chart-bridge';

/** 이동평균 기간 — 50일선 하나(첫째 칸 ma5 에 들어간다) */
export const STOCK_CHART_MA = [50] as const;
/** 첫 화면 일수 — 최근 1년 */
export const STOCK_CHART_VISIBLE_DAYS = 365;
/** 받아 올 일수 — 1년 + 50일선 워밍업(50거래일 ≈ 달력 75일) */
export const STOCK_CHART_LOOKBACK_DAYS = 440;
/** 50일선 색 — chart-page.ts 의 첫째 이동평균 칸(MA.ma5) 색과 같아야 범례가 맞는다 */
export const MA50_COLOR = '#14b8a6';

/** 52주 고점 점선(값 없으면 생략). 자동 범위에 넣어 화면 밖으로 사라지지 않게 한다 */
export function stockChartLines(high52w: number | null, color: string): ChartLine[] {
  if (high52w === null || !Number.isFinite(high52w)) return [];
  return [{ price: high52w, color, width: 1, dashed: true, title: '52주 고점', fit: 'day' }];
}
```

Run: `cd mobile && npx jest src/features/leaders/stock-chart.test.ts`
Expected: PASS — 2 tests

- [ ] **4-9. 일봉 훅** — `mobile/src/features/leaders/use-daily-candles.ts`

```ts
import { useCallback, useEffect, useState } from 'react';

import { getDailyCandles } from '@/features/game/api';
import type { DailyCandle } from '@/features/game/types';
import { errorCode } from '@/features/market/format';

type State = { rows: DailyCandle[] | null; seq: number; loading: boolean; error: string | null };

/** 종목 일봉 — 점수 조회와 독립(차트만 실패해도 점수표는 보인다). 성공할 때마다 seq 를 올려 차트를 다시 그린다 */
export function useDailyCandles(ticker: string, lookbackDays: number) {
  const [state, setState] = useState<State>({ rows: null, seq: 0, loading: true, error: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const rows = await getDailyCandles(ticker, new Date(), lookbackDays);
      setState((s) => ({ rows, seq: s.seq + 1, loading: false, error: null }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorCode(e) }));
    }
  }, [ticker, lookbackDays]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
```

- [ ] **4-10. 차트 래퍼** — `mobile/src/features/leaders/components/stock-daily-chart.tsx`

```tsx
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { TvChart, type TvChartData } from '@/features/game/components/tv-chart';
import type { ChartColors } from '@/features/game/lib/chart-bridge';

import {
  MA50_COLOR,
  STOCK_CHART_LOOKBACK_DAYS,
  STOCK_CHART_MA,
  STOCK_CHART_VISIBLE_DAYS,
  stockChartLines,
} from '../stock-chart';
import { useDailyCandles } from '../use-daily-candles';

const CHART_H = 260;

/** 종목 상세 일봉 차트 — 캔들 + 50일선 + 52주 고점 점선(볼린저 끔). 실패하면 차트 자리만 "다시 시도" */
export function StockDailyChart({ ticker, high52w }: { ticker: string; high52w: number | null }) {
  const { theme } = useUnistyles();
  const d = useDailyCandles(ticker, STOCK_CHART_LOOKBACK_DAYS);
  const colors = useMemo<ChartColors>(
    () => ({
      up: theme.colors.up,
      down: theme.colors.down,
      text: theme.colors.textSecondary,
      grid: theme.colors.background,
      border: theme.colors.border,
    }),
    [theme.colors.up, theme.colors.down, theme.colors.textSecondary, theme.colors.background, theme.colors.border],
  );
  const lines = useMemo(() => stockChartLines(high52w, theme.colors.textSecondary), [high52w, theme.colors.textSecondary]);
  const view = useMemo<TvChartData | null>(
    () => (d.rows ? { data: { kind: 'day', rows: d.rows }, seq: d.seq, keepView: false } : null),
    [d.rows, d.seq],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.legend}>
        <Text style={[styles.legendText, { color: MA50_COLOR }]}>━ 50일선</Text>
        <Text style={styles.legendText}>┄ 52주 고점</Text>
      </View>
      <View>
        <TvChart
          view={view}
          lines={lines}
          ma
          bb={false}
          colors={colors}
          height={CHART_H}
          maPeriods={STOCK_CHART_MA}
          visibleDays={STOCK_CHART_VISIBLE_DAYS}
        />
        {d.loading && !d.rows ? (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator />
          </View>
        ) : null}
        {d.error && !d.rows ? (
          <Pressable style={styles.overlay} onPress={() => void d.reload()} accessibilityRole="button">
            <Text style={styles.error}>차트를 불러오지 못했어요 · 다시 시도</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(0.5) },
  legend: { flexDirection: 'row', gap: theme.gap(1.5) },
  legendText: { fontSize: 11, color: theme.colors.textSecondary },
  overlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface,
  },
  error: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
}));
```

- [ ] **4-11. 회귀 확인(게임 호출부 무수정)**

Run: `cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app && git diff --stat -- mobile/src/features/game/components/candle-chart.tsx mobile/src/features/game/chart-web/`
Expected: 출력 없음(두 곳 모두 변경 없음)

- [ ] **4-12. 전체 검증**

Run: `cd mobile && npx jest && npm run typecheck`
Expected: `Tests: 553 passed`(546 + 5 + 2), 타입 오류 0

- [ ] **4-13. 커밋**

```bash
git add mobile/src/features/game/lib/chart-bridge.ts
git add mobile/src/features/game/lib/chart-bridge.test.ts
git add mobile/src/features/game/components/tv-chart.tsx
git add mobile/src/features/game/api.ts
git add mobile/src/features/leaders/stock-chart.ts
git add mobile/src/features/leaders/stock-chart.test.ts
git add mobile/src/features/leaders/use-daily-candles.ts
git add mobile/src/features/leaders/components/stock-daily-chart.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): 차트 이동평균 기간·첫 화면 일수 인자 + 종목 일봉 차트(50일선·52주 고점)

게임 기본값(5·20·60일, 180일)은 그대로 — candle-chart·chart-page 무수정, 번들 재생성 불필요.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 5: 종목 상세 라우트 + 스크리너 '주도주' 칩 연결

**파일:**
- 생성: `mobile/src/features/leaders/components/score-table.tsx`
- 생성: `mobile/src/features/leaders/components/score-history.tsx`
- 생성: `mobile/src/app/stock/[ticker].tsx`
- 수정: `mobile/src/app/_layout.tsx:47`(Stack 화면 한 줄 추가)
- 수정: `mobile/src/app/(tabs)/screener.tsx`(전체 교체)

순서가 중요하다: 라우트 파일·Stack 등록 → **라우트 타입 재생성** → 스크리너 이동 배선 → 타입 검사.

- [ ] **5-1. 점수표** — `mobile/src/features/leaders/components/score-table.tsx`

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { letterStatusText } from '../canslim';
import type { CanslimLetter } from '../types';
import { LetterBadge } from './letter-badges';

/** 7항목 점수표 — 배지·이름·상태 글자·근거(display)·설명·기준(threshold). 문구는 모두 서버 값 */
export function ScoreTable({ letters }: { letters: CanslimLetter[] }) {
  return (
    <View style={styles.list}>
      {letters.map((l) => (
        <View key={l.key} style={styles.row}>
          <LetterBadge letter={l.key} status={l.status} size="lg" />
          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={styles.label}>{l.label}</Text>
              <Text style={styles.status}>{letterStatusText(l.status)}</Text>
            </View>
            <Text style={styles.display}>{l.display}</Text>
            <Text style={styles.explain}>
              {l.explanation} 기준: {l.threshold}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { gap: theme.gap(1) },
  row: { flexDirection: 'row', gap: theme.gap(1.5), backgroundColor: theme.colors.fill, borderRadius: 14, padding: theme.gap(1.5) },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.gap(1) },
  label: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  status: { fontSize: 12, color: theme.colors.textSecondary },
  display: { fontSize: 14, color: theme.colors.text },
  explain: { fontSize: 12, color: theme.colors.textSecondary },
}));
```

- [ ] **5-2. 점수 추이** — `mobile/src/features/leaders/components/score-history.tsx`

```tsx
import { Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { historyPoints } from '../canslim';
import type { CanslimHistoryPoint } from '../types';

/** 점수 추이(최근 거래일들) 미니 그래프 — 점 2개 미만이면 숨김 */
export function ScoreHistory({ history }: { history: CanslimHistoryPoint[] }) {
  const { theme } = useUnistyles();
  const points = historyPoints(history);
  if (!points) return null;
  const first = history[0];
  const last = history[history.length - 1];
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>점수 추이 · 최근 {history.length}거래일</Text>
        <Text style={styles.meta}>
          {first.score}점 → {last.score}점
        </Text>
      </View>
      <Svg
        width="100%"
        height={48}
        viewBox="0 0 240 40"
        preserveAspectRatio="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Polyline points={points} fill="none" stroke={theme.colors.primary} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <Text style={styles.meta}>
        {first.date} ~ {last.date}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.gap(1) },
  title: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
}));
```

- [ ] **5-3. 종목 상세 라우트** — `mobile/src/app/stock/[ticker].tsx`

```tsx
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { high52w, scoreView } from '@/features/leaders/canslim';
import { ScoreHistory } from '@/features/leaders/components/score-history';
import { ScoreTable } from '@/features/leaders/components/score-table';
import { StockDailyChart } from '@/features/leaders/components/stock-daily-chart';
import { useCanslimScore } from '@/features/leaders/use-canslim-score';
import { formatIndex } from '@/features/market/format';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Button, ListState } from '@/ui';

/**
 * 범용 종목 상세 — 머리(이름·종가·점수) · 일봉 차트(50일선·52주 고점) · 7항목 점수표 · 점수 추이.
 * 점수와 차트는 따로 조회한다(한쪽이 실패해도 다른 쪽은 보인다). 점수가 null 이면 분석 비대상(ETF·우선주 등).
 * 진입: 스크리너 '주도주' 목록, 테마·업종 상세의 구성 종목. name 파라미터는 비대상 종목의 제목용.
 */
export default function StockDetailScreen() {
  // name 은 선택 파라미터지만 typedRoutes 제약(값은 string) 때문에 string 으로 선언하고 실제 값으로 판단한다
  const params = useLocalSearchParams<{ ticker: string; name: string }>();
  const ticker = String(params.ticker ?? '').trim();
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!ticker) return <NotFound />;
  return <StockDetailBody ticker={ticker} fallbackName={name || ticker} />;
}

function NotFound() {
  const router = useRouter();
  // 딥링크로 들어와 스택이 이 화면뿐이면 back() 이 동작하지 않으므로 스크리너 탭으로 보낸다
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/screener'));
  return (
    <View style={styles.center}>
      <ListState mode="empty" emoji="🔍" title="종목 정보를 찾을 수 없어요" hint="주소를 다시 확인해 주세요" />
      <Button label="뒤로 가기" variant="secondary" fullWidth={false} onPress={goBack} />
    </View>
  );
}

function StockDetailBody({ ticker, fallbackName }: { ticker: string; fallbackName: string }) {
  const score = useCanslimScore(ticker);
  const { refreshing, onRefresh } = usePullRefresh(score.refresh);
  const view = scoreView(score);
  const data = score.data;
  const n = data?.letters.find((l) => l.key === 'n');
  const high = data ? high52w(data.close, n?.value ?? null) : null;
  const title = data?.name ?? fallbackName;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Stack.Screen options={{ title }} />
      <View style={[styles.card, styles.headRow]}>
        <View style={styles.headMain}>
          <Text style={styles.name} numberOfLines={1}>{title}</Text>
          <Text style={styles.meta}>
            {ticker}
            {data ? ` · ${data.sectorName ?? data.market}` : ''}
          </Text>
          {data ? (
            <Text style={styles.meta}>
              {formatIndex(data.close)}원 · {data.date} 종가
            </Text>
          ) : null}
        </View>
        {data ? (
          <View style={styles.scoreBox}>
            <Text style={styles.score}>
              {data.score}
              <Text style={styles.unit}>점</Text>
            </Text>
            <Text style={styles.meta}>7개 중 {data.passCount}개 통과</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <StockDailyChart ticker={ticker} high52w={high} />
      </View>

      {view === 'loading' ? (
        <View style={styles.card}>
          <ActivityIndicator />
        </View>
      ) : null}
      {view === 'error' ? (
        <View style={styles.card}>
          <Text style={styles.msgTitle}>점수표를 불러오지 못했어요</Text>
          <Text style={styles.meta}>잠시 후 다시 시도해 주세요 (오류: {score.error})</Text>
          <Pressable onPress={() => void score.reload()} accessibilityRole="button" style={styles.retry}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
      {view === 'none' ? (
        <View style={styles.card}>
          <Text style={styles.msgTitle}>주도주 분석 대상이 아니에요</Text>
          <Text style={styles.meta}>보통주만 분석해요</Text>
        </View>
      ) : null}
      {view === 'ready' && data ? (
        <>
          <View style={styles.card}>
            <Text style={styles.section}>7가지 기준</Text>
            <ScoreTable letters={data.letters} />
          </View>
          <ScoreHistory history={data.history} />
          <Text style={styles.note}>실적(C·A)은 최신 공시 기준이며, 투자 권유가 아닙니다.</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.gap(2), backgroundColor: theme.colors.background },
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2), gap: theme.gap(1.5) },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  headRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.gap(1.5) },
  headMain: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: '800', color: theme.colors.text },
  meta: { fontSize: 13, color: theme.colors.textSecondary },
  scoreBox: { alignItems: 'flex-end', gap: 2 },
  score: { fontSize: 28, fontWeight: '800', color: theme.colors.text },
  unit: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  section: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  msgTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  retry: { alignSelf: 'flex-start', paddingVertical: theme.gap(0.5) },
  retryText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  note: { fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: theme.gap(1) },
}));
```

- [ ] **5-4. Stack 등록** — `mobile/src/app/_layout.tsx` 의 47행(`<Stack.Screen name="market/[kind]/[id]" … />`) **바로 아래**에 한 줄 추가

```tsx
        <Stack.Screen name="stock/[ticker]" options={{ headerShown: true, title: '종목 상세' }} />
```

- [ ] **5-5. 라우트 타입 재생성** — `.expo/types/router.d.ts` 에 `/stock/[ticker]` 를 넣는다(gitignore 대상, dev 서버가 만든다)

(1) 사용자 dev 서버(8082)가 이미 떠 있으면 새 파일을 보고 저절로 다시 만든다. 먼저 확인한다:
```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/mobile && grep -c 'stock/\[ticker\]' .expo/types/router.d.ts
```
1 이상이면 (5)로 건너뛴다. 0 이면 (2)부터 한다.

(2) 임시 dev 서버를 **8083** 으로 띄운다 — Bash `run_in_background: true` 로 실행:
```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/mobile && CI=1 npx expo start --port 8083 --offline
```

(3) 타입 파일이 바뀔 때까지 기다린다 — Monitor 도구로 다음 조건이 참이 될 때까지(최대 2분). Monitor 를 쓸 수 없으면 (1)의 `grep -c` 를 몇 번 다시 실행해 확인한다:
```bash
until grep -q 'stock/\[ticker\]' /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/mobile/.expo/types/router.d.ts; do sleep 2; done
```

(4) 임시 서버를 끈다:
```bash
pkill -f "expo start --port 8083"
```

(5) 확인:
```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/mobile && grep -c 'stock/\[ticker\]' .expo/types/router.d.ts && git status --short
```
Expected: 1 이상. `git status` 에는 이 작업에서 만든·고친 파일과 기존 `.serena/project.yml` 만 보인다. dev 서버가 `tsconfig.json`·`expo-env.d.ts`·`.gitignore` 를 건드렸다면 `git diff` 로 확인하고 `git checkout -- <파일>` 로 되돌린다(이미 설정돼 있어 보통은 변경 없음).
2분이 지나도 생기지 않으면 진행을 멈추고, 임시 서버 출력과 함께 사용자에게 보고한다(라우트 타입 없이 이동 코드를 커밋하지 않는다).

- [ ] **5-6. 스크리너 칩 + 이동 배선** — `mobile/src/app/(tabs)/screener.tsx` 전체를 다음으로 바꾼다

```tsx
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { LeadersSection } from '@/features/leaders/sections/leaders-section';
import { CalendarSection } from '@/features/market/sections/calendar-section';
import { GroupSection } from '@/features/market/sections/group-section';
import { MarketSection } from '@/features/market/sections/market-section';
import type { GroupKind } from '@/features/market/types';
import { Chip } from '@/ui';

type Tab = 'market' | 'theme' | 'sector' | 'calendar' | 'leaders';
const TABS: [Tab, string][] = [
  ['market', '시장'],
  ['theme', '테마'],
  ['sector', '업종'],
  ['calendar', '일정'],
  ['leaders', '주도주'],
];

/** 스크리너 탭 — 위쪽 칩(시장·테마·업종·일정·주도주, 웹 탭 순서와 같음)으로 아래 내용을 바꾼다 */
export default function ScreenerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('market');

  const openGroup = (kind: GroupKind, id: string) =>
    router.push({ pathname: '/market/[kind]/[id]', params: { kind, id } });
  const openStock = (ticker: string, name: string) =>
    router.push({ pathname: '/stock/[ticker]', params: { ticker, name } });

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsBar}>
        {TABS.map(([v, t]) => <Chip key={v} label={t} selected={tab === v} onPress={() => setTab(v)} />)}
      </ScrollView>
      <Text style={styles.notice}>ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요</Text>
      {tab === 'market' ? <MarketSection onMore={setTab} onOpenGroup={openGroup} /> : null}
      {tab === 'theme' ? <GroupSection key="theme" kind="theme" onOpenGroup={openGroup} /> : null}
      {tab === 'sector' ? <GroupSection key="sector" kind="sector" onOpenGroup={openGroup} /> : null}
      {tab === 'calendar' ? <CalendarSection /> : null}
      {tab === 'leaders' ? <LeadersSection onOpenStock={openStock} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  tabsBar: { flexGrow: 0 },
  tabs: { gap: theme.gap(1), paddingHorizontal: theme.gap(2), paddingVertical: theme.gap(1.5) },
  notice: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(0.5) },
}));
```
(바뀐 곳: import 1줄, `Tab`·`TABS` 에 `leaders`, 머리 주석, `openStock`, 마지막 줄 렌더. 나머지는 지금과 같다.)

- [ ] **5-7. 검증**

Run: `cd mobile && npm run typecheck && npx jest`
Expected: 타입 오류 0, `Tests: 553 passed`

- [ ] **5-8. 커밋**

```bash
git add mobile/src/features/leaders/components/score-table.tsx
git add mobile/src/features/leaders/components/score-history.tsx
git add "mobile/src/app/stock/[ticker].tsx"
git add mobile/src/app/_layout.tsx
git add "mobile/src/app/(tabs)/screener.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): 범용 종목 상세(/stock/[ticker]) — 점수표·일봉 차트·점수 추이, 스크리너 '주도주' 칩 연결

점수와 차트는 따로 조회(한쪽 실패해도 다른 쪽 표시), 점수 null 이면 "주도주 분석 대상이 아니에요".

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 6: 그룹 상세 구성 종목 → 종목 상세

**파일:**
- 수정: `mobile/src/app/market/[kind]/[id].tsx`(import 2줄, `GroupDetailBody` 의 훅 1줄, 구성 종목 행, 스타일 1줄)

작업 5 의 라우트 타입 재생성이 끝난 뒤에 한다.

- [ ] **6-1. import 바꾸기**

바꾸기 전:
```tsx
import { RefreshControl, ScrollView, Text, View } from 'react-native';
```
바꾼 뒤:
```tsx
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
```

- [ ] **6-2. 라우터 훅** — `GroupDetailBody` 첫 줄들(훅은 조기 반환보다 위에 있어야 한다)

바꾸기 전:
```tsx
  const { data, loading, error, notFound, reload, refresh } = useGroupDetail(kind, id);
  const { refreshing, onRefresh } = usePullRefresh(refresh);
```
바꾼 뒤:
```tsx
  const router = useRouter();
  const { data, loading, error, notFound, reload, refresh } = useGroupDetail(kind, id);
  const { refreshing, onRefresh } = usePullRefresh(refresh);
```
(`useRouter` 는 이 파일 1행에서 이미 import 하고 있다.)

- [ ] **6-3. 구성 종목 행을 누를 수 있게**

바꾸기 전:
```tsx
        {data.stocks.map((s) => (
          <View key={s.ticker} style={styles.stock}>
```
바꾼 뒤:
```tsx
        {data.stocks.map((s) => (
          <Pressable
            key={s.ticker}
            style={({ pressed }) => [styles.stock, pressed && styles.pressed]}
            onPress={() => router.push({ pathname: '/stock/[ticker]', params: { ticker: s.ticker, name: s.name } })}
            accessibilityRole="button"
            accessibilityLabel={`${s.name}${s.isLeader ? ' 대장주' : ''}, ${formatIndex(s.close)}, 1일 ${formatChg(s.chg1d)}, 5일 ${formatChg(s.chg5d)}`}
            accessibilityHint="종목 상세 보기"
          >
```
그리고 그 행을 닫는 태그(`<View style={styles.stockNums}>…</View>` 다음 줄)

바꾸기 전:
```tsx
            </View>
          </View>
        ))}
```
바꾼 뒤:
```tsx
            </View>
          </Pressable>
        ))}
```

- [ ] **6-4. 눌림 스타일** — `styles` 의 `stock:` 줄 **바로 아래**에 추가
```tsx
  pressed: { opacity: 0.6 },
```

- [ ] **6-5. 검증**

Run: `cd mobile && npm run typecheck && npx jest`
Expected: 타입 오류 0, `Tests: 553 passed`

- [ ] **6-6. 커밋**

```bash
git add "mobile/src/app/market/[kind]/[id].tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): 테마·업종 상세의 구성 종목을 누르면 종목 상세로 이동

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 7: 문서 — README · ROADMAP

**파일:**
- 수정: `README.md`(181행 모바일 머리말, 556행 CANSLIM 절)
- 수정: `docs/ROADMAP.md`(85행, 106행)

- [ ] **7-1. README 모바일 머리말(181행)**

바꾸기 전(문장 그대로 찾는다):
```markdown
Expo SDK 57 · React Native 0.86 · expo-router(하단 5탭: 홈/커뮤니티/게임/스크리너/내정보 — 스크리너는 시장·테마·업종·일정, 설계 `docs/superpowers/specs/2026-10-20-mobile-screener-design.md`) · **Unistyles v3**(테마 스타일링) · zustand.
```
바꾼 뒤:
```markdown
Expo SDK 57 · React Native 0.86 · expo-router(하단 5탭: 홈/커뮤니티/게임/스크리너/내정보 — 스크리너는 시장·테마·업종·일정·주도주, 설계 `docs/superpowers/specs/2026-10-20-mobile-screener-design.md` · 주도주·종목 상세 `docs/superpowers/specs/2026-10-21-mobile-leaders-design.md`. 종목 상세 `/stock/[ticker]`(점수표·일봉 차트 50일선·52주 고점·점수 추이)는 주도주 목록과 테마·업종 상세의 구성 종목에서 들어간다) · **Unistyles v3**(테마 스타일링) · zustand.
```

- [ ] **7-2. README CANSLIM 절(556행)**

바꾸기 전:
```markdown
설계 `docs/superpowers/specs/2026-10-18-canslim-design.md`. 웹 `/screener/leaders`(스크리너 탭 '주도주', `?ticker=` 로 종목 바로 열기, 비로그인 공개).
```
바꾼 뒤:
```markdown
설계 `docs/superpowers/specs/2026-10-18-canslim-design.md`. 웹 `/screener/leaders`(스크리너 탭 '주도주', `?ticker=` 로 종목 바로 열기, 비로그인 공개). 앱은 스크리너 탭 '주도주' 칩(정렬·필터 바텀시트·50개씩 더 불러오기) + 종목 상세 `/stock/[ticker]`(같은 GraphQL, 서버 변경 없음 — 쿼리는 `mobile/src/features/leaders/api.ts`, 계약 테스트 `backend/tests/test_market_query.py`).
```

- [ ] **7-3. ROADMAP**

(1) 85행 끝부분

바꾸기 전:
```markdown
C 는 재무 형식 확인 뒤 `FUNDAMENTALS_Q_CUMULATIVE` 로 켬. 스펙 `docs/superpowers/specs/2026-10-18-canslim-design.md` (2026-10-18). 앱 화면은 다음
```
바꾼 뒤:
```markdown
C 는 재무 형식 확인 뒤 `FUNDAMENTALS_Q_CUMULATIVE` 로 켬. 스펙 `docs/superpowers/specs/2026-10-18-canslim-design.md` (2026-10-18). 앱 화면은 2026-10-21(모바일 '주도주' 칩·종목 상세)
```

(2) 106행

바꾸기 전:
```markdown
- [ ] 종목 차트 상세 + 차트 드로잉(앱) · 주도주(CANSLIM) 칩
```
바꾼 뒤(두 줄):
```markdown
- [x] 주도주(CANSLIM) 칩 + 범용 종목 상세 `/stock/[ticker]`(점수표·일봉 50일선·52주 고점·점수 추이, 테마·업종 구성 종목에서도 진입) — 2026-10-21, 설계 `docs/superpowers/specs/2026-10-21-mobile-leaders-design.md`. 실기기 확인 대기
- [ ] 차트 드로잉(앱)
```

- [ ] **7-4. 확인**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app && grep -n "주도주(CANSLIM) 칩" docs/ROADMAP.md && grep -c "mobile-leaders-design" README.md
```
Expected: ROADMAP 한 줄(`- [x] 주도주(CANSLIM) 칩 …`), README 숫자 `1`.

- [ ] **7-5. 커밋**

```bash
git add README.md
git add docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: 모바일 주도주 칩·종목 상세 반영 — README 모바일·CANSLIM 절, ROADMAP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 8: 실기기 확인 — **사용자 몫**

에이전트는 이 작업을 실행하지 않는다. 아래 절차를 사용자에게 안내하고 결과를 기다린다. 서버 배포는 필요 없다(백엔드 변경 없음). 개발 서버의 `canslim_daily` 에 최신 기준일이 있어야 목록이 보인다.

- [ ] **8-1. 앱 실행** — 새 네이티브 모듈이 없으므로 기존 개발 빌드 + Metro(8082)로 JS 만 바꿔 확인할 수 있다. 에뮬레이터면 `adb reverse` 로 8000·8001·8002·8082 를 연다. release APK 로 볼 때는 JS 가 묶여 있으므로 `cd mobile && npm run build:android:devapk` 로 새로 빌드한다.
- [ ] **8-2. 주도주 목록** — 스크리너 탭 → 칩 순서 시장·테마·업종·일정·주도주 → '주도주'. 시장 방향 줄(KOSPI·KOSDAQ 상태 색: 상승 추세 빨강 계열·하락 파랑 계열·조정 중립, 분산일), "총 n개", 행(점수·이름/티커·배지 7개·업종·RS·종가·고점 대비)이 보인다. 라이트·다크 모드 둘 다 확인한다.
- [ ] **8-3. 정렬·필터** — 정렬 칩 점수·RS·통과 수로 순서가 바뀐다. [필터] → 시장 KOSDAQ·최소 5개 이상·꼭 통과 C·L → [적용] → 배지 숫자 4, 목록이 줄어든다. [초기화] → [적용] 이면 배지가 사라지고 정렬은 유지된다. 시트를 그냥 닫으면 바뀌지 않는다. 조건을 지나치게 좁히면 "조건에 맞는 종목이 없어요".
- [ ] **8-4. 더 불러오기·새로고침** — 끝까지 내리면 50개씩 이어진다(중복 행 없음). 당겨서 새로고침 동작. 비행기 모드로 더 불러오기 → "더 불러오지 못했어요 · 다시 시도".
- [ ] **8-5. 종목 상세** — 행을 누르면 `/stock/…`: 머리(이름·티커·업종·종가·기준일·점수·"7개 중 n개 통과"), 일봉 차트(첫 화면 약 1년, 청록 50일선, 52주 고점 점선·가격 라벨, 가로로 끌기·핀치), 7항목 점수표(상태 글자·근거·설명·기준), 점수 추이 그래프, 안내 문구.
- [ ] **8-6. 비대상** — 테마·업종 상세에서 ETF 또는 우선주 구성 종목(없으면 주소로 `/stock/<ETF 티커>?name=…` 딥링크) → 차트는 보이고 점수 영역에 "주도주 분석 대상이 아니에요 / 보통주만 분석해요", 제목은 종목명. 주의: `getChartData` 는 일봉이 수집되지 않은 종목(CH 에 없음)이면 가짜 캔들(`chart_service.generate_candles`)을 돌려준다. ETF 차트가 실제 시세와 다르면 **기록만 하고** 이번 범위 밖으로 남긴다(서버 변경 없음).
- [ ] **8-7. 그룹 상세 진입** — 테마·업종 상세의 구성 종목 행을 누르면 종목 상세로 간다. 뒤로 가면 그룹 상세로 돌아온다.
- [ ] **8-8. 게임 차트 회귀** — 게임 탭 차트에서 5·20·60일선·볼린저가 전과 같고, 지표 토글(이동평균·볼린저 켜고 끄기)·일봉/분봉 전환·틱 갱신이 정상이다.
- [ ] **8-9. 결과 반영** — 통과하면 ROADMAP 의 "주도주(CANSLIM) 칩 …" 줄 끝 "실기기 확인 대기"를 "실기기 확인 완료(날짜)"로 바꿔 커밋한다(파일 개별 add, 끝 두 줄).

---

## 자체 점검 (작성자 확인 결과)

- **설계 범위**: §2.1(칩 순서·시장 줄·정렬·필터 시트·목록·무한 스크롤·당겨서 새로고침·네 가지 상태·행 → 상세) → 작업 1·2·3·5. §2.2(머리·차트·점수표·추이·안내·비대상·차트만 실패) → 작업 4·5. §2.3 → 작업 6. §3(TvChart 재사용·기간 인자·52주 고점 `lines` 점선·컴포넌트 이동 안 함) → 작업 4. §4 파일 구성 → 파일 구조 표(설계 목록 + `stock-chart.ts`·`use-daily-candles.ts` 추가). §5 테스트 → 작업 1·4(jest), 작업 1(계약), 작업 8(실기기). 범위 밖(드로잉·알림·관심 종목·서버 변경)은 다루지 않는다.
- **이름 일관성**: `LEADERS_PAGE`·`listView`·`scoreView`·`activeFilterCount`·`mergeLeaderPage`·`hasMoreLeaders`·`historyPoints`(작업 1) → 작업 2·3·5 에서 같은 이름. `MaPeriods`·`LoadOptions`(작업 4) → `TvChart`. `STOCK_CHART_*`·`MA50_COLOR`·`stockChartLines`(작업 4) → `stock-daily-chart.tsx`. `onOpenStock(ticker, name)`(작업 3) → `screener.tsx`(작업 5).
- **테스트 수**: 모바일 529 → 546(작업 1, canslim 17) → 553(작업 4, chart-bridge 5 + stock-chart 2). 백엔드 1356 → 1357(작업 1).
