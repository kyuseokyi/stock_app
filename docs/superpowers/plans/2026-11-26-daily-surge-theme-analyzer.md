# 급등락·테마 분석기 구현 계획

> **에이전트용:** superpowers:executing-plans 로 작업 단위 진행(이번에는 같은 세션 인라인 실행). 체크박스(`- [ ]`)로 추적.

**목표:** 날짜별 급등·급락·거래대금 상위 종목과 같은 테마 동반 급등락 묶음(대장주·공시·관리자 메모·네이버 뉴스 바로 보기)을 관리자 웹 `/market/daily-surge` 에서 본다.

**구조:** 수집기(`apps/collector/daily_surge/`)가 상용 CH 일봉 + PG 프로필·테마 + DART 로 날짜별 결과를 PG 3표에 저장 → stock_api 관리자 라우터가 조회·메모·재집계·뉴스 바로 보기 제공 → admin_web 화면.

**기술:** FastAPI · SQLAlchemy(async 조회 / sync 집계) · Alembic · Celery · clickhouse-connect · Redis · React(Vite)+Tailwind.

설계: [`docs/superpowers/specs/2026-11-26-daily-surge-theme-analyzer-design.md`](../specs/2026-11-26-daily-surge-theme-analyzer-design.md)

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `backend/shared/daily_surge_models.py` (새) | `DailySurgeStock`·`DailySurgeThemeGroup`·`DailySurgeNote` ORM |
| `backend/alembic/versions/e5a7c9b1d3f6_daily_surge_tables.py` (새) | 표 3개 (down: `d4f6b8c0e2a4`) |
| `backend/alembic/env.py` | 모델 import 1줄 |
| `backend/apps/collector/daily_surge/__init__.py` (새) | |
| `backend/apps/collector/daily_surge/compute.py` (새) | 순수 계산: 종목 행·분류·순위·묶음·대장주·대표 테마·공시 키워드·뉴스 시각 배지 |
| `backend/apps/collector/daily_surge/repository.py` (새) | CH 일봉 2일치, PG 프로필·이름·테마, PG 날짜 단위 교체 저장 |
| `backend/apps/collector/daily_surge/run.py` (새) | 한 날짜 집계 오케스트레이션(일봉 미확정 건너뜀, 공시 붙이기) |
| `backend/apps/collector/tasks/daily_surge.py` (새) | Celery `collector.analyze_daily_surge` + Redis 잠금 |
| `backend/apps/collector/celery_app.py` | include + beat `analyze-daily-surge` 평일 22:10 |
| `backend/apps/ai_analyst/clients/opendart.py` | `disclosures_between(code, bgn, end)` 추가(기존 `disclosures` 는 그것을 호출) |
| `backend/apps/stock_api/services/daily_surge_query.py` (새) | 조회·필터·정렬·메모 우선순위·성적표 |
| `backend/apps/stock_api/services/daily_surge_news.py` (새) | 네이버 바로 보기(검색어 생성·5분 캐시·배지) |
| `backend/apps/stock_api/routers/daily_surge_admin.py` (새) | 라우터 |
| `backend/apps/stock_api/main.py` | 라우터 등록 |
| `backend/tests/test_daily_surge_compute.py` (새) | 순수 계산 |
| `backend/tests/test_daily_surge_store.py` (새) | 저장 멱등·메모 보존(sqlite) |
| `backend/tests/test_daily_surge_api.py` (새) | API·권한·뉴스 |
| `admin_web/src/api/dailySurge.ts` (새) | 호출·타입 |
| `admin_web/src/lib/dailySurge.ts` (새) | 표시 함수(숫자·색·배지) |
| `admin_web/src/components/dailySurge/*.tsx` (새) | `ThemeGroupList`·`SurgeStockTable`·`DetailPanel`·`NoteEditor`·`NaverNewsList` |
| `admin_web/src/pages/MarketDailySurge.tsx` (새) | 화면 상태 |
| `admin_web/src/App.tsx`·`components/Sidebar.tsx`·`lib/navPermissions.ts` | 라우트·메뉴·권한 |
| `README.md`·`docs/ROADMAP.md` | 기능 안내 |

## 작업

### 작업 1: 순수 계산 (`compute.py`) — TDD
- [ ] 테스트 먼저(`tests/test_daily_surge_compute.py`):
  - `build_rows(today, prev, profiles, names)`: `today/prev = {ticker: (close, volume)}`. 등락률 소수 2자리, `change_price = close - prev_close`, `trading_value = close*volume`, 전일 거래량 0 → `volume_ratio None`, 전일 없음 → 제외, 보통주 아님·프로필 없음 → 제외.
  - 분류 경계: +10.0·+30.5·−10.0·−30.5 포함, +9.99·+30.51·−30.51 제외. 거래대금 50위(`top_n` 인자) 순위.
  - `theme_groups(rows, themes)`: `themes = {theme_id: (name, [tickers])}`, 방향별 2종목 이상만, 평균·합계, 대장주 동률 규칙(거래대금 → |등락률| → 코드).
  - `assign_primary(rows, groups)`: 종목 수 → 거래대금 합 → id 순, `is_theme_leader`.
  - `dart_keywords(["주주배정 유상증자 결정", "단일판매ㆍ공급계약체결"])` → `["#유상증자", "#공급계약"]`(중복 없음, 사전 순서).
  - `time_slot(pub_dt, trade_date, prev_date)` 경계: P 15:29 → other, P 15:30 → pre, T 08:59 → pre, T 09:00 → intra, T 15:30 → intra, T 15:31 → post, T+1 00:00 → other.
  - `parse_pub_date("Thu, 26 Nov 2026 08:12:00 +0900")` → KST datetime, 실패 → None.
- [ ] 실패 확인 → 구현 → 통과 → 커밋 `feat(collector): 급등락·테마 분석 순수 계산`

### 작업 2: 모델·마이그레이션
- [ ] `shared/daily_surge_models.py` (설계 3절 컬럼, JSON 은 `JSON().with_variant(JSONB(), "postgresql")`), `alembic/env.py` import, 마이그레이션 파일(로컬 `alembic upgrade` 금지 — 문법·임포트만 확인).
- [ ] 커밋 `feat(db): 급등락 분석 표 3개`

### 작업 3: 저장·집계 실행 (`repository.py`·`run.py`) — TDD
- [ ] `tests/test_daily_surge_store.py`(sqlite 동기 엔진): `replace_day(session, date, stock_rows, group_rows)` 두 번 호출 → 행 수 동일, 그날 메모는 그대로, 다른 날짜 행은 안 건드림.
- [ ] `run_day(trade_date, *, load_prices, load_meta, load_themes, fetch_dart, store)` 의존성 주입형: 일봉 < `min_rows`(기본 1000) → `{"skipped": ...}`; 공시 실패 종목은 빈 목록 + `dart_failed` 카운트; 테마 실패 → 묶음 없이 저장 + `theme_error`.
- [ ] 실제 연결 함수: CH `SELECT ticker, close, volume FROM daily_prices FINAL WHERE date = %(d)s`, 직전 거래일 `SELECT max(date) FROM daily_prices WHERE date < %(d)s`, 최신 거래일 `max(date)`; PG `stock_profile`(보통주 판정)·`stock_meta`(이름)·`market_repo.theme_groups`·`active_theme_source`.
- [ ] `OpenDartClient.disclosures_between` 추가 + 기존 테스트 통과 확인.
- [ ] 커밋 `feat(collector): 급등락 집계 실행·저장`

### 작업 4: Celery 작업·일정
- [ ] `tasks/daily_surge.py`: `analyze_daily_surge(date: str | None = None)`, Redis `SET lock:daily_surge:<date> NX EX 1800`, 끝나면 삭제. include·beat 22:10 평일. 읽기 전용 beat 제외 목록에 넣지 않음.
- [ ] 테스트: 잠금 중이면 `{"skipped": "실행 중"}`(가짜 Redis).
- [ ] 커밋 `feat(collector): 급등락 분석 Celery 작업·22:10 일정`

### 작업 5: 조회 서비스·라우터 — TDD
- [ ] `tests/test_daily_surge_api.py`(sqlite async, `test_themes_admin.py` 방식): dates 집계, 목록 mode/band/dart_only/정렬 기본값, 메모 우선순위(종목 > 테마), 메모 PUT 덮어쓰기·DELETE·빈 문자열 422, 상세 404, 권한(일반 403, EDITOR 403, ANALYST 조회·메모 200, 재집계 ANALYST 403·OPERATOR 202), 재집계 409(잠금).
- [ ] 성적표는 `daily_surge_query._prices(date, tickers)`(CH) 를 테스트에서 가로챈다.
- [ ] 커밋 `feat(stock_api): 급등락 분석 관리자 API`

### 작업 6: 네이버 뉴스 바로 보기 — TDD
- [ ] 테스트: 순서·개수 그대로(배지만 추가), 캐시 두 번째 호출 클라이언트 미호출, 클라이언트 None·빈 결과 → `unavailable`, 검색어는 서버 생성(임의 q 무시), DB 에 쓰지 않음.
- [ ] 커밋 `feat(stock_api): 급등락 화면 네이버 뉴스 바로 보기(저장 안 함)`

### 작업 7: 관리자 웹
- [ ] `api/dailySurge.ts`·`lib/dailySurge.ts`·컴포넌트 5개·페이지, 라우트·메뉴(`시장 데이터` 맨 위)·권한(`SCREENER_VIEW`).
- [ ] `npx tsc --noEmit`, 빌드(더미 VITE env, 출력은 작업 tmp).
- [ ] 커밋 `feat(admin_web): 급등락·테마 분석 화면`

### 작업 8: 마무리
- [ ] backend 전체 `pytest`, ruff(F,E9) 새 파일.
- [ ] 검토: 시세·계산 → `market-data-reviewer`, API → `api-contract-reviewer`(이번 세션 고친 파일 목록 전달).
- [ ] README·ROADMAP 갱신, 커밋, dev 병합(`--no-ff`), 작업 폴더 정리. 배포는 요청 시.
