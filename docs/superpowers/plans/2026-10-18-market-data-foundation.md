# 시장 데이터 수집 기반 (스크리너 프로젝트 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CANSLIM·주달 화면이 쓸 종목 프로필·업종·테마·지수(국내+미국)·투자자별 순매수·재무비율·공모주 일정·미국 거시 지표를 공식 경로로 매일·매주 자동 수집해 PG·CH 에 저장한다.

**Architecture:** 기존 collector 패턴(KISClient + 공유 RateLimiter + `_run_universe` 실패 격리 + CH ReplacingMergeTree 멱등 적재)을 그대로 확장한다. 키 없이 받는 KIS 마스터 파일(.mst·idxcode·theme_code)은 마스터 동기화 때 함께 파싱해 PG 에, 시계열은 CH 에 둔다. 일봉 수집 뒤 국내 지수·투자자 수집을 같은 Celery 작업에서 차례로 돌려 KIS 레이트리밋이 겹치지 않게 한다.

**Tech Stack:** Python 3.12, Celery, requests, SQLAlchemy 2(async+sync), alembic, clickhouse-connect, FastAPI, pytest(+aiosqlite, fakeredis, httpx).

**Spec:** `docs/superpowers/specs/2026-10-18-market-data-foundation-design.md`

## 스펙 대비 보정 (계획 작성 중 확인한 사실)

1. `.mst` 뒤쪽 필드 실데이터 길이는 **KOSPI 227 / KOSDAQ 221**(KIS 예제는 줄바꿈 포함 줄에서 `row[-228:]`/`row[-222:]`). 2026-10-18 실파일로 오프셋 검증(삼성전자 상장일 19750611, 상장주수 5,846,278천주, 시총 12,277,185억).
2. `idxcode.mst` 업종명은 `row[5:45]`(KIS 예제 `row[3:43]` 은 코드 뒷자리 2개가 섞임: "27제조").
3. 테마 관리자 API 는 stock_api GraphQL 에 인증 컨텍스트가 없어 **REST + `shared.auth.require_admin`**(trading_game 관리자 API 와 같은 방식), stock_api `/api/v1/admin/themes`.
4. 미 국채 금리는 KIS 코드 확인 불가 → **FRED `DGS10`·`DGS2` 로만**. KIS 지수 목록에서 제외.
5. 국내 지수·투자자 수집은 체인 대신 `collector.daily_market_pipeline` 한 작업이 일봉 → 국내 지수 → 투자자를 순서대로 실행(앞 단계 예외와 무관하게 다음 단계 진행, KIS 동시 호출 없음).
6. 분석 대상 종목 = ETP·SPAC·우선주 제외 → 2026-10-18 실파일 기준 KOSPI 914 + KOSDAQ 1,751 = 약 2,665.

## File Structure

| 파일 | 책임 |
|---|---|
| `backend/apps/collector/kis/reference_master.py` (신규) | `.mst` 뒤쪽 필드 → `StockProfileRow`, `idxcode.mst` → 업종, `theme_code.mst` → 테마 (순수 파서) |
| `backend/apps/collector/kis/master.py` (수정) | `download_master_lines()`·`download_reference_lines()`·`parse_master_lines()` |
| `backend/shared/market_models.py` (신규) | PG `stock_profile`·`sectors`·`themes`·`theme_stocks`·`stock_events` ORM |
| `backend/alembic/versions/f3a4b5c6d7e8_market_reference_tables.py` (신규) | 위 5개 테이블 |
| `backend/shared/market_repo.py` (신규) | 동기 저장소: 프로필·업종·KIS 테마 동기화, 분석 대상 종목, 일정 upsert |
| `backend/apps/collector/reference_sync.py` (신규) | 마스터 원문 + idxcode·theme 다운로드 → market_repo 동기화 |
| `backend/apps/collector/stock_master.py` (수정) | mst 원문 보관 → 동기화 뒤 reference_sync 호출(실패해도 계속) |
| `backend/apps/collector/kis/client.py` (수정) | TR 5개 메서드 |
| `backend/apps/collector/market_parsers.py` (신규) | KIS 응답 행 → 저장용 dict |
| `backend/apps/collector/repositories/clickhouse_market.py` (신규) | CH DDL 4개·ensure·upsert·최근 날짜 |
| `backend/apps/collector/market_indices.py` (신규) | 지수 목록 + 지수 수집 |
| `backend/apps/collector/fred.py` (신규) | FRED 클라이언트·시리즈·발표일 |
| `backend/apps/collector/tasks/universe.py` (수정) | `_run_universe(..., tickers=None)` |
| `backend/apps/collector/tasks/market_data.py` (신규) | Celery 태스크 6개 |
| `backend/apps/collector/celery_app.py` (수정) | include·beat |
| `backend/shared/clickhouse_schema.py` (수정) | `init_clickhouse` 에 신규 CH 테이블 |
| `backend/apps/stock_api/services/theme_admin.py`·`routers/themes_admin.py` (신규), `main.py` (수정) | 테마 관리자 REST |
| 테스트 (신규) | `test_reference_master`, `test_market_repo`, `test_reference_sync`, `test_market_parsers`, `test_clickhouse_market`, `test_market_indices`, `test_fred`, `test_market_tasks`, `test_themes_admin` |

## Tasks (각 Task = 실패 테스트 → 실패 확인 → 구현 → 통과 → 커밋)

> 각 Task 의 전체 테스트·구현 코드는 이 세션에서 그대로 커밋된다(커밋 메시지 = Task 제목). 아래는 Task 별 계약(공개 인터페이스·동작)과 검증 명령이다. 실행 명령은 모두 `cd backend` 후.

### Task 1: 마스터 파일 파서
- `reference_master.PART2_LEN = {"KOSPI": 227, "KOSDAQ": 221}`, `SPANS[market][field] = (start, end)` — 필드: mcap_size, sector_l/m/s, etp, spac, halted, managed, warning, listed_date, listed_shares, settle_month, preferred, market_cap. KOSPI: etp(22,23) spac(29,30) halted(60,61) managed(62,63) warning(63,65) listed_date(105,113) listed_shares(113,128) settle_month(149,151) preferred(158,159) market_cap(212,221). KOSDAQ: etp(18,19) spac(24,25) halted(55,56) managed(57,58) warning(58,60) listed_date(100,108) listed_shares(108,123) settle_month(144,146) preferred(153,154) market_cap(206,215). 공통 mcap_size(2,3) sector_l(3,7) sector_m(7,11) sector_s(11,15).
- `StockProfileRow`(frozen dataclass, 필드 = `StockProfile` 컬럼) + `is_common_stock`(ETP·SPAC·우선주 아님). `parse_profile(line, market) -> StockProfileRow | None`, `parse_profiles(lines, market)`, `parse_sectors(lines) -> {code: name}`(`[1:5]`, `[5:45]`), `ThemeRow(code, name, tickers)`, `parse_themes(lines)`.
- 숫자 0·공백 → None, 날짜 형식 오류 → None, 짧은 줄 → None.
- `master.download_master_lines()`, `download_reference_lines()`, `parse_master_lines(lines)`; `download_and_parse_master()` 동작 불변.
- Test: `uv run pytest -p no:warnings tests/test_reference_master.py -q`

### Task 2: PG 모델·마이그레이션
- `shared/market_models.py`: `StockProfile`(ticker PK), `Sector`(code PK), `Theme`(id, kis_code unique null, name, source kis|admin, is_hidden, description, timestamps), `ThemeStock`(PK theme_id+ticker, FK themes cascade, source, is_excluded, reason), `StockEvent`(id, event_date idx, title, category, ticker, source, source_key unique, payload JSON/JSONB, timestamps). 티커 FK 없음.
- `shared/models.py` 끝·`alembic/env.py` 에 import 등록. 마이그레이션 `f3a4b5c6d7e8`(down `e0f1a2b3c4d5`).
- Test: sqlite 생성 + 일회용 docker PG(55432)로 upgrade → downgrade -1 → upgrade.

### Task 3: 참조 데이터 저장소 (동기)
- `market_repo.sync_profiles(session, profiles) -> int`(upsert, 삭제 없음), `sync_sectors(session, {code: name})`, `analysis_universe(session) -> [(ticker, name, market)]`(활성 + 보통주, 프로필 없으면 활성 전체), `sync_kis_themes(session, themes) -> {themes, added, removed}`(source='kis' 연결만 추가·삭제, 관리자 행·숨김·제외 보존, 사라진 KIS 테마는 연결만 정리), `upsert_events(session, events)`(source_key 멱등), `names_for(session, tickers)`.
- upsert 는 dialect 별(PG/sqlite) `on_conflict_do_update`, 1000행 청크.
- Test: `tests/test_market_repo.py`

### Task 4: 마스터 동기화 연결
- `reference_sync.sync_reference(master_lines) -> dict`. `stock_master._fetch_master_bundle(source) -> (stocks, lines|None)`, `_fetch_master` 호환 유지, `load_domestic_tickers` 가 stock_meta 동기화 뒤 `sync_reference` 호출(예외는 로그만).
- Test: `tests/test_reference_sync.py`, 회귀 `tests/test_universe_cooldown.py`

### Task 5: KIS TR 5개 + 파서
- `KISClient.get_domestic_index_daily(index_code, s, e)`(FHKUP03500100, U, output2), `get_overseas_daily(mrkt, symbol, s, e)`(FHKST03030100, output2), `get_investor_daily(ticker, market_code="UN")`(FHKST01010900, output), `get_financial_ratio(ticker, period "0"|"1")`(FHKST66430300, J 고정, 소문자 파라미터 키 — 공식 예제), `get_ipo_schedule(f, t)`(HHKDB669108C0, output1). `_as_list`.
- `market_parsers.parse_domestic_index / parse_overseas_daily / parse_investor / parse_financial_ratio / parse_ipo`.
- Test: `tests/test_market_parsers.py`, 회귀 `tests/test_kis_retry.py`

### Task 6: CH 시장 테이블
- `clickhouse_market.ensure_market_tables(client=None)`, `upsert_index_daily(code, records)`, `upsert_investor_daily(ticker, records)`, `upsert_fundamentals(ticker, period, records)`, `upsert_macro(series_id, [(date, value)])`, `latest_index_date(code)`, `latest_macro_date(series_id)`(빈 테이블 1970-01-01 → None). `init_clickhouse` 에 ensure 추가.
- Test: 가짜 CH + 로컬 CH 임시 DB(생성→DROP)로 DDL·FINAL 대체 확인.

### Task 7: 지수 수집
- `IndexSpec(code, name, kind KR|OVERSEAS, mrkt, symbol, region KR|US)`, `index_specs(region=None)`(기본 10개 + 대표 종목 `NVDA,MU,AAPL,MSFT,TSLA` + `MARKET_INDEX_EXTRA`), `collect_indices(specs, client, today=None)`(최근 날짜 없으면 730일, 있으면 −10일 겹침, 100일 청크, 지표별 실패 격리).
- Test: `tests/test_market_indices.py`

### Task 8: FRED
- `fred.api_key()`, `series_ids()`(기본 9개 + `MACRO_SERIES_EXTRA`), `FredClient(key, session=None).observations / release_of / release_dates`, `release_events(releases, dates)`(한국어 라벨, source_key `fred:{release_id}:{date}`).
- Test: `tests/test_fred.py`

### Task 9: Celery 태스크·스케줄
- `_run_universe(..., tickers=None)`. `tasks/market_data.py`: `collect_market_indices(region)`, `collect_investor_daily()`(분석 대상, UN→J), `collect_fundamentals()`(연간·분기), `collect_ipo_events(today=None)`, `collect_macro_series(today=None)`(키 없으면 skipped), `daily_market_pipeline()`.
- beat: `collect-all-daily` → `collector.daily_market_pipeline` 20:30, `collect-us-indices` 07:30, `collect-macro-series` 08:00, `collect-ipo-events` 21:30, `collect-fundamentals` 토 10:00.
- Test: `tests/test_market_tasks.py` + 전체 `uv run pytest -p no:warnings 2>&1 | tail -1`("failed" 없으면 커밋)

### Task 10: 테마 관리자 API
- stock_api `/api/v1/admin/themes`: GET 목록(stock_count = 제외 안 된 종목 수), POST 생성(source admin), PATCH `{name?, description?, is_hidden?}`, GET `/{id}/stocks`, POST `/{id}/stocks {ticker, reason?}`(이미 있으면 제외 해제), DELETE `/{id}/stocks/{ticker}`(제외 표시). 관리자만(403), 없는 테마 404.
- Test: `tests/test_themes_admin.py`

### Task 11: 문서
- `backend/.env.example`(FRED_API_KEY·MACRO_SERIES_EXTRA·MARKET_INDEX_EXTRA), README(환경 변수 표·수집 스케줄·수동 실행·테마 API), `docs/server_setup.md`(배포 후 자동 생성·FRED 키), `docs/pending_checks.md`(첫 수집 확인 항목), ROADMAP `[x]`, 스펙 보정 반영.

## Self-Review
- 스펙 3절 7개 항목 → Task 1·3·4(1·2번), 5·6·7(3번), 5·6·9(4·5번), 5·9(6번), 8·9(7번). 관리자 보정 → Task 10. 스케줄 → Task 9. 확인·키 → Task 11.
- 인터페이스 일관성: `StockProfileRow` 필드 = `StockProfile` 컬럼(`asdict` upsert). `ThemeRow(code, name, tickers)`, `IndexSpec(...)`, `_run_universe(..., tickers=)` 는 정의한 Task 와 사용하는 Task 가 같은 이름.
