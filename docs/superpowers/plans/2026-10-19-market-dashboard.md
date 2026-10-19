# 시장·테마·업종·일정 탭 (스크리너 프로젝트 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 매일 장 마감 뒤 종목·테마·업종 집계를 CH 에 저장하고(관리자 테마 보정 시 최신일 재계산), stock_api GraphQL 과 웹 `/screener` 탭(시장·테마·업종·일정·주도주)으로 보여준다.

**Architecture:** CANSLIM 과 같은 층 구조 — 순수 집계(`apps/collector/market_groups/compute.py`) ← CH 입출력(`repositories/clickhouse_market_groups.py`) ← Celery 태스크(일일 파이프라인 끝·보정 시·60일 백필). stock_api 는 서비스 `services/market_query.py` 가 CH·PG 를 읽어 GraphQL 로. 웹은 api/types → 탭 레이아웃(중첩 라우트) → 탭 페이지 → 컴포넌트, 트리맵은 순수 함수 `lib/treemap.ts`.

**Tech Stack:** Python 3.12, clickhouse-connect, Celery, SQLAlchemy, Strawberry GraphQL, React 18 + TS + Tailwind, react-router 6.

**Spec:** `docs/superpowers/specs/2026-10-19-market-dashboard-design.md`

## 기존 코드에서 확인한 사실 (구현 전 전제)
- `market_repo.analysis_universe(db) -> [(ticker, name, market)]`, `profile_map(db) -> {ticker: (sector_m, settle_month)}` — 이번엔 상장주식수·거래정지가 더 필요 → 새 함수(Task 1).
- CH 패턴: `clickhouse_canslim.py` 의 `_since()`(날짜 연산은 파이썬), `_rows()`, `latest_trading_date()`, `trading_dates()`, DDL 문자열 + `ensure_*`, insert 는 `column_names`.
- 일일 파이프라인: `tasks/market_data.py` `daily_market_pipeline` 의 단계 튜플 — 끝에 `("market_groups", ...)` 추가.
- 비동기 태스크 위임 패턴: `apps/blog/notifications.py`(`celery_app.send_task(name)` + 예외 삼킴).
- 테마 보정: REST `apps/stock_api/services/theme_admin.py` 의 `create_theme·update_theme·add_stock·exclude_stock`(async).
- `market_index_daily` 코드·이름: `apps/collector/market_indices.py` `_BASE`(KR 3·US 6·FX 1). FRED 시리즈: `fred.DEFAULT_SERIES`.
- IPO 이벤트 `payload` = KIS 원본 필드 문자열(`fix_subscr_pri`, `lead_mgr` …), `source_key=ipo:{sht_cd}:subscr|listing`. FRED 이벤트 `title="{발표명} 발표"`.
- 웹: `pages/ScreenerPage.tsx`(CANSLIM, 제목 'CANSLIM 스크리너', `MarketStrip` 이 기준일·투자 권유 문구를 이미 표시), `App.tsx` 의 `/screener` lazy 라우트, `api/screener.ts`(GraphQL POST), `hooks/useMediaQuery`, `lib/format.ts`. **웹에는 테스트 러너가 없다**(package.json 에 test 스크립트 없음).

## Tasks (각 Task = 실패 테스트 → 구현 → 통과 → 커밋, 백엔드는 `cd backend`, conda `stock_app`, `uv run pytest -q`)

### Task 1: 순수 집계 — `apps/collector/market_groups/compute.py`
- 상수 `MIN_MEMBERS=3`, `TOP_N_STREAK=10`.
- `stock_values(bars[(date, close, volume)], listed_shares_k) -> dict` — 마지막 봉 기준 `close, chg_1d, chg_5d, chg_20d`(%, 봉 부족 None), `value=close*volume`, `mcap=close*listed_shares_k*1000`(없으면 None).
- `aggregate(kind, date, groups{group_id: (name, [tickers])}, stocks{ticker: values}, halted:set) -> list[dict]` — 구성 = tickers ∩ stocks − halted(거래정지는 그룹 집계에서 완전 제외). `chg_*` 단순 평균(None 제외, 전부 None 이면 None), value·mcap 합(None 은 0), up/down/flat, 대장주(상승 중 value 1위, 없으면 value 1위), rank(members ≥ 3 그룹만 chg_1d 내림차순 1..N, chg_1d None 은 뒤, 나머지 0). members 0 그룹은 행을 만들지 않는다.
- `compute_day(as_of, universe, profiles{ticker: (market, sector_m, listed_shares_k, is_halted)}, bars{ticker: [...]}, themes{id: (name, [tickers])}, sector_names{code: name}) -> (stock_rows, group_rows)` — 기준일 봉 없는 종목 건너뜀, 종목 단위 예외 격리(로그). 업종 그룹 = sector_m 별(빈 코드 제외), 이름 없으면 코드.
- `shared/market_repo.py`: `group_profile_map(db) -> {ticker: (market, sector_m, listed_shares_k, is_halted)}`, `theme_groups(db) -> {str(id): (name, [tickers])}`(숨김·제외 빼고), `theme_reasons(db, theme_id) -> {ticker: reason}`, `sector_name_map(db) -> {code: name}`.
- Test: `tests/test_market_groups_compute.py`(봉 부족 None·평균 None 제외·거래정지 제외·대장주 폴백·순위/3개 미만 0·기준일 봉 없음 건너뜀·시총 None), `tests/test_market_repo.py` 에 새 함수(sqlite 세션 — 기존 방식).

### Task 2: CH 입출력 — `apps/collector/repositories/clickhouse_market_groups.py`
- `STOCK_COLUMNS`, `GROUP_COLUMNS`, DDL `market_stock_daily`·`market_group_daily`(스펙 2.3), `ensure_market_group_tables()`.
- `load_bars(as_of, days=45) -> {ticker: [(date, close, volume)]}`(21봉 확보용 달력 45일, `_since`).
- `existing_group_ids(as_of, kind) -> set[str]`(FINAL, members > 0), `upsert_stocks(rows)`, `upsert_groups(rows)`.
- `tombstones(as_of, kind, previous_ids, current_ids) -> list[dict]`(순수 — 이전에 있고 이번에 없는 id → members 0·rank 0·수치 0/None, name '').
- `latest_trading_date`·`trading_dates` 는 `clickhouse_canslim` 재사용.
- Test: `tests/test_clickhouse_market_groups.py` — 가짜 CH(인스턴스 하나 공유), tombstones, 로컬 CH 임시 DB 로 DDL·FINAL·덮어쓰기(로컬 CH 없으면 skip — 기존 `test_clickhouse_canslim` 패턴).

### Task 3: 태스크 — `apps/collector/tasks/market_groups.py`
- `collector.compute_market_groups(as_of=None)` — ensure → universe·profiles·sector_names·themes(PG, 테마 조회 실패 시 themes={} + 로그 → 업종만) → bars → compute_day → upsert + 테마 tombstones(테마 조회 실패 시 tombstone 생략). 결과 `{date, stocks, themes, sectors}`.
- `collector.backfill_market_groups(days=60)` — 날짜별 실패 격리.
- `tasks/market_data.py` 파이프라인 끝 단계, `celery_app.py` include.
- Test: `tests/test_market_groups_task.py`(가짜 저장소·PG 함수 monkeypatch: 정상·테마 실패·일봉 없음·백필 격리), 파이프라인 단계 이름 확인.

### Task 4: 보정 시 재계산 — `apps/stock_api/services/theme_admin.py`
- `_recompute()` — `celery_app.send_task("collector.compute_market_groups")`, 예외는 로그만. create·update·add_stock·exclude_stock 의 commit 뒤 호출.
- Test: `tests/test_themes_admin.py` 에 호출 횟수·브로커 예외에도 성공.

### Task 5: 조회 서비스 — `apps/stock_api/services/market_query.py`
- 상수: `KINDS`, `PERIODS={"1d":"chg_1d","5d":"chg_5d","20d":"chg_20d"}`, `SORTS`, `SIZES`, `CATEGORIES={"공모주","경제지표"}`, `MAX_LIMIT=100`, `TREEMAP_STOCKS=30`, `TREEMAP_THEMES=30`, `HISTORY_DAYS=60`, `CALENDAR_MAX_DAYS=92`, `MACRO_NAMES`(9개 한글 이름), `YOY_SERIES={"CPIAUCSL","CPILFESL","PCEPILFE"}`(물가 지수는 수준값 대신 **전년 대비 %**), 지수 목록 = `market_indices._BASE`(순서·이름·region: KR/US, FX:→FX).
- `latest_date()`, `overview()`, `groups(kind, period, sort, limit, offset)`(members>0, theme 은 rank>0, streak = 최근 60거래일 rank 1~10 연속 일수 — date·group_id·rank 한 번에 읽어 파이썬 계산), `treemap(kind, size, period)`(theme: value 상위 30, 그룹 안 종목 size 상위 30 + '기타'), `group(kind, id)`(헤더·60일 history·구성 종목, theme 은 PG 소속·reason / sector 는 `market_stock_daily.sector_m`, 없으면 None), `calendar(from, to, category)`(92일 자르기, detail: 공모주 `공모가 {가격:,}원 · 주관 {lead_mgr}`(값 없는 부분 생략) / 경제지표 `발표 예정`, 종목명은 PG).
- 화이트리스트 밖 → 기본값, limit 1~100 클램프, SQL 에 사용자 문자열을 넣지 않음(컬럼은 매핑 값만).
- Test: `tests/test_market_query.py` — 가짜 CH 결과 큐·PG 함수 monkeypatch.

### Task 6: GraphQL — `graphql/types.py`·`schema.py`
- 타입: `MarketIndex`, `MacroValue`, `MarketOverview`, `GroupLeader`, `GroupItem`, `GroupRanking`, `TreemapStock`, `TreemapGroup`, `Treemap`, `GroupHistory`, `GroupStock`, `GroupDetail`, `CalendarEvent`.
- Query: `marketOverview`, `marketGroups`, `marketTreemap`, `marketGroup`, `marketCalendar`(스펙 3절). 리졸버는 서비스 dict → 타입 변환만.
- Test: 스키마 연결 + **웹 쿼리 계약 테스트**(`web_client/src/api/market.ts` 의 쿼리 문자열이 테스트 상수와 같은지 확인 후 실제 스키마로 실행).

### Task 7: 웹 기반 — 타입·API·트리맵·탭 레이아웃·주도주 이동
- `types/market.ts`, `api/market.ts`(쿼리 상수 + 함수, `api/screener.ts` POST 방식 재사용).
- `lib/treemap.ts`: `squarify(items[{id, size}], rect{x,y,w,h}) -> [{id,x,y,w,h}]`(size ≤ 0 제외, 큰 순, worst-ratio 줄바꿈), `chgColor(chg, period)`(상한 1d 5·5d 10·20d 20, 보합 회색, 상승 빨강·하락 파랑 5단계).
- 트리맵 검증: 웹 테스트 러너가 없으므로 러너를 새로 들이지 않고, scratchpad 에 일회용 검사 스크립트(면적 합 보존·사각형 안·겹침 없음)를 `node_modules/.bin/esbuild` 로 번들해 node 로 실행한다(커밋 안 함).
- `pages/screener/ScreenerLayout.tsx`(제목 '스크리너' + NavLink 탭 5개, 좁은 화면 가로 스크롤, `<Outlet/>`), `App.tsx`: `/screener` 부모(lazy) + 자식 `market|themes|sectors|calendar|leaders`, index → `market`.
- 주도주: `ScreenerPage.tsx` 를 `leaders` 자식으로, 제목 '주도주 분석' + 설명 "윌리엄 오닐의 CANSLIM 7가지 기준으로 실적과 추세가 강한 종목을 찾습니다", `?ticker=` 초기 선택, `CanslimDetail` 비대상 문구 '주도주 분석 대상(보통주)이 아니에요'. 그 밖의 동작은 그대로. (기준일 문구는 MarketStrip 이 있으므로 주도주 탭엔 `BasisNote` 를 붙이지 않는다.)
- Test: `npx tsc --noEmit`, `npx vite build`.

### Task 8: 웹 탭 화면
- `components/market/`: `BasisNote`, `IndexCards`(SVG 스파크라인), `MacroCards`, `Treemap`(ResizeObserver → squarify, 넓은 화면 그룹+종목 / 좁은 화면 그룹 → 드릴다운·뒤로, 테마는 겹침 안내), `GroupControls`, `GroupList`, `GroupDetail`(순위 추이 SVG·구성 종목 표, 종목 → `/screener/leaders?ticker=`), `EventList`(날짜별·카테고리 칩·지난 7일 접기).
- `pages/screener/`: `MarketTab`, `GroupTab({kind})`(theme 기본 목록·sector 기본 트리맵, lg 스플릿·좁은 화면 펼침), `CalendarTab`.
- 빈 상태 문구(스펙 4절), 숫자 표기는 `lib/format.ts` 재사용(없는 억/조 헬퍼만 추가).
- Test: tsc·build, 가짜 GraphQL 서버 + vite 로 1280px·390px 브라우저 확인.

### Task 9: 문서·마무리
- README(스크리너 탭·태스크), ROADMAP(Phase 2), pending_checks(첫 계산·백필 1회·오래된 테마), 스펙 상태 '구현 완료(dev)'.
- 전체 백엔드 테스트·웹 tsc·build 통과 확인.
