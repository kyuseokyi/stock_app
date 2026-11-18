# 개발 서버가 상용 ClickHouse 주식 데이터를 읽기 전용으로 쓰기 — 설계

- 작성: 2026-11-18 · 상태: **권장안 채택(사용자 2026-11-18) — 코드·문서 구현 완료(7절 1~5·8단계), 서버 작업(6·7단계) 대기** · 관련: `docs/kiwoom_setup_and_dev_spec.md` 4절(범위 C, 보류 중이던 항목)
- 서버 작업 절차: [`docs/deploy/dev-reads-prod-ch-runbook.md`](../../deploy/dev-reads-prod-ch-runbook.md)
- 비밀값(토큰·비밀번호)·IP 는 이 문서에 적지 않는다. 키 이름만 적는다.

## 0. 목표와 결정

| 항목 | 결정 |
|---|---|
| 공유 대상 | **ClickHouse 주식 데이터만** (일봉·지수·수급·재무·CANSLIM·스크리너·패턴 등) |
| 분리 유지 | PostgreSQL(회원·게시판·게임·펀드·테마 마스터 등), Redis |
| 연결 경로 | 상용 터널 `oracle-prod-server` → `ch-ro.funnotedaily.com` → `tcp://localhost:8123`, Access 앱 `ch-ro`, 서비스 토큰 `dev-server-ch-readonly` (2026-11-18 구성 완료, 토큰 없이 접근하면 403 확인) |
| 개발 서버 접속 | 사이드카 `cloudflared access tcp --hostname ch-ro.funnotedaily.com --url 0.0.0.0:18123` → 앱은 `CLICKHOUSE_HOST=<사이드카>`·`CLICKHOUSE_PORT=18123` |
| 스위치 | env **`MARKET_DATA_SOURCE`** = `local`(기본값, 지금 동작 그대로) / `prod_readonly`. 상용 서버는 설정하지 않음 → 영향 0 |
| 되돌리기 | 개발 env 에서 `MARKET_DATA_SOURCE` 와 CH 접속값을 원래대로 돌리고 재배포 |

사이드카 env 이름은 cloudflared 소스(`cmd/cloudflared/access/cmd.go`, tcp 하위 명령)에서 확인했다.
`--hostname`=`TUNNEL_SERVICE_HOSTNAME`, `--url`=`TUNNEL_SERVICE_URL`, `--service-token-id`=`TUNNEL_SERVICE_TOKEN_ID`, `--service-token-secret`=`TUNNEL_SERVICE_TOKEN_SECRET`.

---

## 1. 개발 서버가 CH 에 쓰는 곳 전부 — 읽기 전용 계정이면 무엇이 깨지나

CH 클라이언트는 프로세스마다 하나만 있다. `shared/clickhouse_schema.py:130` `get_client()` 이고, 접속값은 `:23-27` 의 `CLICKHOUSE_HOST/PORT/USER/PASSWORD/DB` 다.
**모든 읽기와 쓰기가 이 함수 하나를 거친다.** 그래서 접속값만 상용으로 바꾸면 아래의 쓰기가 모두 상용 CH 로 간다.

### 1-1. 데이터 적재(INSERT)

| 테이블 | 쓰는 코드 | 호출하는 태스크 |
|---|---|---|
| `daily_prices` | `repositories/clickhouse_ohlcv.py:40` | `collect_all_daily`·`backfill_all_daily`(`tasks/universe.py:265,272,317,325`), `collect_daily_ohlcv`(`tasks/ohlcv.py:49`), `backfill_domestic_daily`(`tasks/backfill.py:34`) |
| `market_index_daily` | `repositories/clickhouse_market.py:136` | `collect_market_indices`(`market_indices.py:91`) |
| `investor_daily`·`investor_detail_daily`·`stock_lending_daily`·`fundamentals_periodic`·`macro_series` | `clickhouse_market.py:132`(`_insert`)·`:141-168` | `tasks/market_data.py:147,160,254,306`, 대차는 키움 |
| `canslim_daily`·`canslim_market` | `clickhouse_canslim.py:160,168` | `tasks/canslim.py:44-45` |
| `screener_daily` | `clickhouse_screener.py:195` | `tasks/screener.py:39` |
| `chart_pattern_daily` | `clickhouse_patterns.py:97` INSERT + **`:99` DELETE** | `tasks/patterns.py:105` |
| `market_stock_daily`·`market_group_daily` | `clickhouse_market_groups.py:102` | `tasks/market_groups.py:60-61` |
| **`game_minute_bars`(트레이딩 게임)** | `collector/game_ws/minute_bars.py:118` | `run_game_ws.py:232` 의 `MinuteBarRecorder`(틱을 1분봉으로 묶음), `game_ws/kis_backfill.py:154,248`(KIS 분봉 보충) |

### 1-2. DDL·ALTER(테이블 만들기·고치기)

- `shared/clickhouse_schema.py:102` `ensure_game_minute_bars`: game_ws 가 시작할 때, 그리고 보충할 때마다(`kis_backfill.py:154,248`) 호출한다.
- `:107` `ensure_daily_prices_source`(`ALTER ... ADD COLUMN IF NOT EXISTS`): 키움 폴백이 처음 적재하기 직전에 호출한다(`kiwoom/daily_fallback.py:92`).
- `clickhouse_market.py:122` `ensure_market_tables`: `tasks/market_data.py:83,154,177,214,262,297`, `canslim.py:51`, `screener.py:67` 에서 호출한다. **FRED 수집(`:297`)도 맨 앞에서 이것을 호출한다.**
- `clickhouse_screener.py:73-77`(`ALTER ADD COLUMN` 포함), `clickhouse_canslim.py:81`, `clickhouse_patterns.py:62`, `clickhouse_market_groups.py:64`
- `init_clickhouse()`(`clickhouse_schema.py:146`): 수동 실행할 때만 쓴다.
- 확인 결과 stock_api·auth·blog·trading_game 의 기동 경로에는 DDL 이 없다. `/ready` 도 CH 를 검사하지 않는다(`shared/health.py`).

### 1-3. 읽기 전용 계정으로 접속을 바꾸기만 하면 생기는 일

권한이 `SELECT` 뿐이면 테이블이 이미 있어도 `CREATE TABLE IF NOT EXISTS`·`ALTER`·`INSERT`·`DELETE` 가 모두 권한 오류로 거부된다. 상용 데이터는 안전하다. 대신 개발 쪽에서 다음이 깨진다.

1. **일일 파이프라인 20:30**: 전종목 KIS 호출 약 4천 건을 **다 한 뒤에야** insert 에서 종목마다 실패한다. KIS 쿼터만 낭비하고 실패 기록이 쌓인다. 이어지는 단계도 모두 `ensure_*` 에서 실패한다.
2. **트레이딩 게임 분봉**:
   - `MinuteBarRecorder._write` 는 실패를 무시하고 로그만 남긴다(`minute_bars.py:170-178`). 그런데 개발 게임 종목의 분봉이 아무 데도 저장되지 않는다.
   - 게임 분봉 차트(`trading_game/services/minute_candles_query.py:36,48`)는 **상용** `game_minute_bars` 를 읽는다. 상용 게임은 시즌 종목이 다를 수 있으므로, 개발 시즌 종목이면 **빈 차트**가 나온다.
   - KIS 분봉 보충은 쓰기는 실패하고 KIS 호출만 한다.
3. **관리자 "작업 실행" 버튼**(`stock_api/services/admin_jobs.py:39-55`): canslim·market_groups·screener·patterns·bootstrap·각종 백필이 대상이다. 관리자 테마 수정 뒤의 `send_task("collector.compute_market_groups")`(`theme_admin.py:24`)도 같다. 이것들은 **beat 를 거치지 않으므로** beat 를 끄는 것만으로는 막을 수 없다. bootstrap 은 KIS 를 수천 번 부른 뒤 실패한다.
4. **FRED 거시 지표**: `ensure_market_tables` 에서 바로 실패한다. 그래서 같은 태스크가 PG 에 쓰던 **발표일 일정(`stock_events`)** 까지 함께 멈춘다(`market_data.py:297-322`).

### 1-4. 결론: 연결을 둘로 나눈다

- **읽기 = 상용**: `get_client()` 를 그대로 둔다. 개발 env 의 `CLICKHOUSE_*` 가 사이드카와 읽기 전용 계정을 가리키게 한다. 앱 대부분은 코드를 바꿀 필요가 없다.
- **쓰기 = 개발 자체 CH**: 새 함수 `get_local_client()` 를 둔다.
  - `CLICKHOUSE_LOCAL_HOST/PORT/USER/PASSWORD` 가 **없으면 `get_client()` 를 그대로 돌려준다.** 그래서 상용과 지금의 개발 동작은 같다.
  - 개발 서버가 직접 소유하는 테이블만 이 함수를 쓰도록 명시적으로 바꾼다.
- 방향을 이렇게 잡으면, 빠뜨린 쓰기는 상용 읽기 전용 계정에서 **오류가 나서 바로 드러난다.** 조용히 개발 CH 로 새는 일이 없다.

**개발 자체 CH 에 두는 테이블(표 단위 라우팅):**

| 테이블 | 이유 | 바꿀 곳 |
|---|---|---|
| `game_minute_bars` | 게임 시즌·종목은 PG(개발)에서 정해진다. 쓰는 쪽도 개발 game_ws 다 | `minute_bars.py:116,121-124`, `kis_backfill.py:104-108,152-154,194-198,246-248`, `trading_game/services/minute_candles_query.py:36` 및 세션 조회 함수 |
| `market_stock_daily`·`market_group_daily` | 2절 참고. 테마 id 가 PG 에 묶여 있다(사용자 결정 Q1 의 (a)를 고를 때만) | `clickhouse_market_groups.py` 의 읽기·쓰기(일봉 `load_bars` 는 상용 읽기 유지), `stock_api/services/market_query.py` 에서 두 테이블을 보는 쿼리 11곳, `theme_metrics.py:34`, `verify_ticker.py:223`, `data_status.py:132` |

---

## 2. PG↔CH ID 결합

CH 테이블 컬럼 전체를 훑어 보았다. 키는 대부분 `ticker`(종목코드)·`code`(지수)·`series_id`(FRED)·`sector_m`(업종 코드)이고, 이 값들은 환경과 관계없이 같다.
**PG 자동증가 id 가 들어가는 곳은 하나뿐이다.**

- **`market_group_daily` 의 theme 행**: `group_id` = `str(themes.id)`(PG 자동증가)다. 근거는 `shared/market_repo.py:213-225` `theme_groups()` → `tasks/market_groups.py:34-36,49`.
- 업종 행의 `group_id` 는 업종 코드(`sector_group_code`, `market_repo.py:117-125`)다. 개발과 상용이 같으므로 **업종은 문제없다.**

### 2-1. id 매핑으로도 풀리지 않는 이유

- 상용은 키움 키가 있으므로 `active_theme_source` = **kiwoom** 이다(`market_repo.py:197-205`). 테마는 `KW` 접두사 코드로 만든 별도 행들이다.
- 키움 키가 없는 개발 PG 에는 **키움 테마 행이 아예 없다.** KIS 테마만 있다.
- 그래서 상용 `group_id` 를 `themes.kis_code` 로 바꿔 조인해도 개발 PG 에서는 찾을 수 없다.

### 2-2. 그대로 두면 개발 화면에서 틀어지는 곳

| 위치 | 증상 |
|---|---|
| `market_query.py:325-326` 테마 순위 목록 | 이름은 CH `name` 컬럼에서 오므로 상용 키움 테마 이름이 보인다. 겉보기에는 정상이다 |
| `market_query.py:396-418` 그룹 상세 | `_theme_info(group_id)`(`:145-151`)가 **개발 PG 에서 같은 숫자 id 의 다른 테마**를 찾는다. 설명·편입 사유가 엉뚱하게 나오고, 구성 종목은 비거나 틀린다 |
| `market_query.py:355-374` 트리맵(테마) | `_theme_groups()` 의 개발 PG 소속 정보로 묶으므로 칸이 비거나 틀린다 |
| `market_query.py:291` 테마 순위 추이 | id 를 개발 PG 기준으로 묻기 때문에 엇갈린다 |
| `verify_ticker.py:83-87,223` 관리자 종목 검증 | 개발 PG 테마 id 로 상용 CH 를 찾으므로 소속 테마가 빠지거나 다른 테마가 붙는다 |
| `theme_metrics.py:34` 관리자 테마 지표 | 같은 이유로 엇갈린다 |
| 관리자 테마 보정 → 재계산 | 상용 CH 에 쓸 수 없다(1-3 의 3) |

### 2-3. 선택지 (사용자 결정 Q1)

- **(a) 권장 — 개발이 시장 그룹을 계속 직접 계산한다.**
  - `compute_market_groups` 가 일봉은 상용에서 읽고(`get_client`), 결과는 개발 CH 에 쓴다(`get_local_client`).
  - 화면도 두 테이블은 개발 CH 에서 읽는다.
  - 개발 PG 테마 기준으로 일관되게 맞는다. 계산은 45일치 일봉 약 10만 행을 읽고 몇 초면 끝나며 KIS 호출은 없다.
  - 변경 파일은 약 5개다.
- (b) 개발에서는 테마 기능 저하를 받아들인다. 코드 변경은 0이다. 업종은 정상이다.
  - 단점: 그룹 상세에 **엉뚱한 설명이 그럴듯하게** 나온다. 테스트하는 사람이 버그로 오해하기 쉽다.
- (c) 상용 PG 의 테마 테이블을 복제한다. "PG 분리" 결정과 충돌하므로 비권장이다.

### 2-4. 그 밖의 PG 결합 (문제 없음, 단 전제가 있다)

종목 이름·시장·업종(`stock_meta`·`stock_profiles`·`sectors`)은 `ticker` 로 조인하므로 id 문제가 없다.
단 **개발 PG 의 종목 마스터가 계속 갱신돼야 한다.** 그렇지 않으면 상용 CH 에 있는 신규 상장 종목이 개발 화면에서 이름 없이 보이거나 빠진다.
마스터 갱신은 지금 일일 파이프라인의 `daily` 단계 안에 들어 있다. `universe.py:164` `load_domestic_tickers` → `stock_master.py:92-101`(`sync_master`·`sync_reference`). `.mst` 파일 다운로드라서 KIS 시세 쿼터와는 관계없다.
→ **파이프라인을 끄면 마스터 갱신도 함께 꺼진다.** 그래서 4절의 경량 파이프라인이 필요하다.

---

## 3. Redis 에만 있는 시장 데이터

CH 를 공유해도 개발 Redis 는 채워지지 않는다. 개발이 계속 자체 생성해야 한다.

| Redis 키 | 만드는 곳 | 입력 | 처리 |
|---|---|---|---|
| `market:featured:highs`(신고저가 특징주) | `tasks/featured.py:31-45` | **CH 일봉(읽기)** + PG 유니버스 | **유지**. 상용 일봉을 읽어 개발 Redis 에 쓴다. 상용 적재가 **끝난 뒤** 돌아야 한다(4절) |
| `market:featured:vi:*`(VI 특징주) | `featured.py:60` `poll_vi_stocks` | 키움 | 유지(개발은 키움 키가 없어 호출 없이 끝남). 개발 화면은 계속 비어 있다(지금과 같다) |
| `market:intraday`(장중 지수 30초) | `market_data.py:105` | KIS | 유지(③ 비용 판단). 끄면 장중에도 확정 종가만 보인다 |
| `market:investor_flow:today`(수급 전광판·AI 해설) | `ai_analyst` `collect_investor_flow`, `investor_flow.py:261-272` | pykrx/키움/KIS 폴백(**CH `investor_daily` 읽기**) + Gemini | 유지(Gemini 비용 ③). 22:00 회차는 상용 적재 뒤라 당일 수치를 얻는다 |
| `ai:market:movers:*`·`ai:market:keywords:*` | `ai.refresh_market_movers_list`·`ai.analyze_market_movers` | KIS 순위 + Gemini | 유지(③ 비용) |
| `collector:pipeline:last`(관리자 데이터 현황) | `market_data.py:359` | 파이프라인 결과 | 경량 파이프라인이 기록한다. 관리자 화면에는 개발의 경량 단계만 보인다(4절) |
| `stock:tick:*`·`stock:status:*`·`game:*` | game_ws·trading_game | KIS WS·PG | 유지(게임은 개발 자체) |
| AI 브리핑(PG `AiDailyBriefing`)·스크리너 정성 평가(PG `AiStockEvaluation`) | `ai.generate_*`, `ai.evaluate_screener_stocks` | **CH 읽기** + Gemini·DART·네이버 | 유지 가능(③ 비용 — 상용과 이중 과금) |

---

## 4. 개발 Celery beat 분류 (`backend/apps/collector/celery_app.py:58-185`)

① = `prod_readonly` 에서 끔(상용 CH 에 쓰거나, 의미 없이 KIS 를 호출함) · ② = 유지(개발 Redis/PG 에만 씀, CH 는 읽기만) · ③ = 판단 필요

| beat 이름 | 태스크 | 분류 | 근거 |
|---|---|---|---|
| `collect-all-daily` 20:30 | `collector.daily_market_pipeline` | **① → 경량 파이프라인으로 대체** | 단계 11개 중 CH 에 쓰는 것: daily·indices_kr·investor·investor_detail·lending·canslim·market_groups·screener·patterns. 남길 것: 마스터 동기화, (Q1-a 이면) market_groups(로컬 쓰기), featured_highs |
| `collect-kr-indices` 15:40 | `collect_market_indices(KR)` | ① | `market_index_daily` 에 쓴다 |
| `collect-us-indices` 06:30 / `-retry` 07:30 | `collect_market_indices(US)` | ① | 같은 이유 |
| `poll-intraday-indices` 30초 | `poll_intraday_indices` | ③(기본 유지) | Redis 에만 쓴다. 개발 KIS 쿼터를 쓴다. `INTRADAY_INDICES_ENABLED=false` 로 따로 끌 수 있다 |
| `poll-vi-stocks` | `poll_vi_stocks` | ② | 키움 키가 없어 호출하지 않는다 |
| `collect-macro-series` 08:00 | `collect_macro_series` | **③** | CH(`macro_series`) 쓰기와 PG 발표일 이벤트가 한 태스크에 묶여 있다. 끄면 개발 PG 의 FRED 발표 일정이 멈춘다. 살리려면 "CH 쓰기 건너뛰고 이벤트만 저장"으로 나눠야 한다 |
| `collect-ipo-events` 21:30 | `collect_ipo_events` | ② | PG `stock_events` 만 쓴다(KIS 1~2회) |
| `collect-fundamentals` 토 10:00 | `collect_fundamentals` | ① | `fundamentals_periodic` 에 쓴다 |
| `compute-canslim-after-fundamentals` 토 10:40 | `compute_canslim` | ① | `canslim_*` 에 쓴다 |
| `settle-trading-season` 20:40 | `settle_trading_season` | ② | PG 에 정산하고 CH 일봉은 읽기만 한다. 일봉이 없으면 보류 후 재시도(`settle_season.py:25-60`) — 상용과 같은 동작 |
| `generate-chart-quiz` 21:00 | `generate_chart_quiz` | ② | CH 를 읽고 PG 에 쓴다 |
| `close-trading-week`·`close-trading-month` | 게임 | ② | PG·Redis |
| `dispatch-scheduled-pushes` 60초 | 푸시 | ② | PG |
| `ai-morning-briefing`·`ai-weekly-briefing` | AI | ③(기본 유지) | CH 를 읽고 PG 에 쓴다. Gemini 비용 |
| `ai-market-movers-list`·`ai-market-movers` | AI | ③(기본 유지) | KIS·Gemini → Redis |
| `ai-investor-flow-*` 3회 | AI | ③(기본 유지) | 위와 같다 |
| `ai-screener-evaluation` 16:00 | AI | ③(기본 유지) | CH `screener_daily` 를 읽는다. 16:00 에는 상용 스크리너가 아직 전날 기준이다(지금도 같다) |

**경량 파이프라인 `collector.dev_readonly_pipeline`(새로 만듦, `prod_readonly` 일 때만 beat 에 등록):**

1. 마스터 동기화(`load_domestic_tickers()` 만 호출, 일봉 수집은 하지 않음)
2. (Q1-a) `compute_market_groups()` — 상용 일봉을 읽고 개발 CH 에 쓴다
3. `compute_featured_highs()` — 상용 일봉을 읽고 개발 Redis 에 쓴다
4. `pipeline_record.save` 로 결과를 기록한다

실행 시각은 **상용 파이프라인이 끝난 뒤**여야 한다. 상용은 20:30 에 시작해 11단계를 차례로 돈다. 기본값은 **23:30** 으로 두고, env `DEV_PIPELINE_HOUR`/`DEV_PIPELINE_MINUTE` 로 바꿀 수 있게 한다(사용자 결정 Q2).
상용이 늦게 끝나 전날 데이터로 계산하더라도 결과는 멱등이다. 다음 날 같은 기준일로 다시 계산되어 덮인다.

**끄는 방식 — 플래그 헬퍼 하나를 세 곳에서 쓴다:**

- `shared/clickhouse_schema.py`(또는 `shared/env.py`) 에 `market_data_readonly()` 를 둔다. `MARKET_DATA_SOURCE == "prod_readonly"` 인지 본다.
- ① `celery_app.py`: `beat_schedule` 을 만든 직후, 헬퍼가 참이면 ① 항목을 빼고 경량 파이프라인을 넣는다. 빼는 목록은 이름 집합 하나 `READONLY_DISABLED_BEATS` 로 한 곳에 둔다.
- ② 쓰기 태스크 맨 앞에서 바로 끝낸다. 대상: `daily_market_pipeline`, `collect_all_daily`, `backfill_*`, `collect_daily_ohlcv`, `collect_market_indices`, `collect_investor_*`, `collect_lending_daily`, `collect_fundamentals`, `compute_canslim`, `compute_screener`, `compute_patterns`, `bootstrap_data`, (Q1-b 이면) `compute_market_groups`. 반환값은 `{"skipped": "prod_readonly"}` 로 한다. 수동 실행·`send_task`·관리자 버튼으로 들어와도 KIS 호출 전에 끝난다.
- ③ `admin_jobs.run`(`admin_jobs.py:148`): 헬퍼가 참이면 쓰기 작업을 `JobWindowClosed` 와 같은 방식으로 거절한다. 문구는 "개발 서버는 상용 데이터를 읽기만 해요". 관리자 화면에 실패가 쌓이지 않게 하기 위해서다.
- 마지막 방어선은 상용 CH 계정 권한(SELECT 만)이다.

---

## 5. 상용 CH 쪽 설정

### 5-1. 현재 계정 구성 (확인 필요)

- `docker-compose.prod.yml:23-29`: `clickhouse/clickhouse-server:24.8`, env `CLICKHOUSE_USER`(기본 `default`)·`CLICKHOUSE_PASSWORD`·`CLICKHOUSE_DB`.
- 이 이미지의 entrypoint 는 이 env 로 `users.d/default-user.xml` 을 만든다. 이때 `access_management` 는 `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT`(기본 0)를 따른다. 그런데 compose 의 `environment` 에는 이 키가 없으므로 **기본 계정이 SQL 로 사용자를 만들지 못할 가능성이 높다.**
- 먼저 확인한다(비밀번호는 출력하지 않는다):
  ```bash
  docker exec stock_clickhouse_prod grep -o '<access_management>[0-9]</access_management>' /etc/clickhouse-server/users.d/default-user.xml
  ```

### 5-2. 읽기 전용 사용자 만들기

**권장 = SQL(RBAC)** 이다. SQL 로 만든 사용자는 `/var/lib/clickhouse/access`(데이터 볼륨)에 저장되므로 컨테이너를 다시 만들어도 남는다.

1. `access_management` 가 0 이면 한 번만 켠다.
   - compose 의 `clickhouse.environment` 에 `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: ${CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT:-0}` 한 줄을 추가한다. 기본값이 0 이므로 개발은 바뀌지 않는다.
   - 상용 `compose.env` 에 값 1 을 넣고 `docker compose -f docker-compose.prod.yml up -d clickhouse` 로 다시 만든다. 몇 초 동안 끊기므로 20:30~22:30 파이프라인 시간과 장중은 피한다.
2. `clickhouse-client` 로 아래를 실행한다. 비밀번호는 셸 기록에 남지 않게 입력한다.
   ```sql
   CREATE SETTINGS PROFILE IF NOT EXISTS dev_ro_profile SETTINGS
       readonly = 2,                                  -- 쓰기·DDL 금지, 세션 설정 변경은 허용(clickhouse-connect 호환)
       max_execution_time = 60 CONST,                 -- 쿼리당 60초
       max_memory_usage = 4000000000 CONST,           -- 4GB(상용 서버 메모리에 맞춰 조정)
       max_result_rows = 5000000 CONST, result_overflow_mode = 'throw' CONST,
       max_concurrent_queries_for_user = 8 CONST;
   CREATE USER IF NOT EXISTS dev_ro IDENTIFIED WITH sha256_password BY '<입력>'
       DEFAULT DATABASE stock_data SETTINGS PROFILE 'dev_ro_profile';
   GRANT SELECT ON stock_data.* TO dev_ro;
   -- (선택) 시간당 상한
   CREATE QUOTA IF NOT EXISTS dev_ro_quota FOR INTERVAL 1 hour MAX queries = 20000, read_rows = 5000000000 TO dev_ro;
   ```
   `CONST` 문법과 `max_concurrent_queries_for_user` 를 프로필 제약으로 둘 수 있는지는 24.8 에서 실행해 보고 확정한다. 안 되면 해당 줄만 뺀다.
3. 사용자를 만든 뒤 `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT` 를 0 으로 되돌릴지 정한다. 되돌려도 SQL 로 만든 사용자는 남는다.

**대안 = users.d XML.** `/etc/clickhouse-server/users.d/dev_ro.xml` 에 `<readonly>`·`<password_sha256_hex>`·`<allow_databases>` 를 넣는다.
- 단 compose 볼륨에 이 파일 하나를 마운트해야 한다. 그런데 이 compose 는 개발과 공용이다. 개발에 파일이 없으면 docker 가 같은 이름의 **디렉터리**를 만든다. 이 때문에 SQL 방식을 우선한다.

### 5-3. `readonly=1` 과 `readonly=2`

- 둘 다 INSERT·DDL 을 거부한다. 차이는 세션 설정 변경을 허용하는지다(1=거부, 2=허용).
- clickhouse-connect 0.x 는 접속할 때 `system.settings` 를 읽는다. 그리고 `readonly` 열이 1인 설정은 보내지 않는다(`clickhouse_connect/driver/client.py:225-295`, `httpclient.py` 의 `send_progress_in_http_headers`·`enable_http_compression`·`cancel_http_readonly_queries_on_client_close` 처리). 이론상 readonly=1 에서도 동작할 수 있다.
- 하지만 readonly=1 프로필에서 `system.settings.readonly` 값이 실제로 어떻게 나오는지는 코드만으로 확정할 수 없다. 그래서 **readonly=2 를 권장**한다.
- 쓰기를 막는 주 수단은 `GRANT SELECT` 다. readonly=2 는 이중 잠금이다. 7-1 테스트에서 readonly=1 도 시험해 본다.
- `system.settings`·`system.tables` 조회는 24.8 기본값(`select_from_system_db_requires_grant=0`)이면 별도 권한 없이 된다.

### 5-4. 포트 공개 정리 (상용 보안)

- `docker-compose.prod.yml:30-32` 의 CH `8123:8123`·`9000:9000` 은 0.0.0.0 으로 공개되어 있다. 같은 파일의 PG `5432`·Redis `6379` 도 마찬가지다(범위 밖이지만 함께 보고한다).
- **사전 확인(필수)**: 근거가 문서 예시(`docs/server_setup.md:73`)뿐이고, 실제 env 는 보지 못했다. 바꾸기 전에 상용·개발 두 서버에서 각각 아래 둘을 확인한다(값은 출력하지 않는다).
  - `grep -c '^CLICKHOUSE_HOST=clickhouse$' /opt/stock_app/env/.env.production` 결과가 `1` 인지
  - 스택이나 compose 에서 `extra_hosts`(host-gateway)를 쓰지 않는지

  하나라도 어긋나면 바인딩 변경은 **보류**한다. 그 상태에서 바꾸면 그 서버의 앱이 CH 를 잃는다.
- **권장**: `"127.0.0.1:8123:8123"`, `"127.0.0.1:9000:9000"`.
  - 앱 컨테이너는 서비스 이름 `clickhouse`(`CLICKHOUSE_HOST=clickhouse`, `docs/server_setup.md:73`)로 docker 망 안에서 붙는다. 호스트 포트를 쓰지 않으므로 영향이 없다.
  - 터널은 `tcp://localhost:8123` 이므로 cloudflared 가 **호스트에서 실행 중일 때만** 영향이 없다. 저장소에 상용 cloudflared 실행 방식 기록이 없으므로 확인이 필요하다. 컨테이너로 돈다면 그 컨테이너의 localhost 는 호스트가 아니므로, 지금도 다른 경로로 붙고 있는지부터 봐야 한다.
- **주의 1**: `docker-compose.prod.yml` 은 개발과 상용이 함께 쓴다. 개발 서버에도 적용된다.
  - 개발은 로컬 맥이 SSH 로 `localhost:8123` 에 붙으므로(`scripts/dev-db-tunnel.sh:50`) 영향이 없다.
  - 하지만 `docs/deploy/single-node-swarm.md:45` 의 대안(`extra_hosts: host-gateway` 로 호스트 공개 포트 사용)은 0.0.0.0 공개를 전제로 한다. 바인딩을 바꾸면 이 대안은 쓸 수 없다.
- 여러 서비스 포트를 함께 고칠지, CH 만 고칠지는 Q5 로 둔다. Oracle 보안 목록(VCN)에서 이미 막혀 있다면 급하지 않다.

---

## 6. 개발 서버 배포 구성

- 배포 워크플로: `.github/workflows/deploy-server.yml`
  - Swarm 스택 `stock` 이 있으면 `deploy/swarm/deploy.sh` → `deploy/swarm/single-node.yml`(앱 9개, 외부 overlay 망 `stock_net`)을 쓴다.
  - 없으면 `docker-compose.prod.yml` 을 쓴다.
  - DB 3개는 계속 compose 컨테이너이고 `stock_net` 에 별칭으로 붙어 있다.
  - env 는 `/opt/stock_app/env/.env.production` → `backend/.env.production`(env_file) 이다.
- **두 파일 모두 상용과 공용이다.** 그래서 사이드카는 공용 파일에 넣지 않는다.

**사이드카 위치(권장)**: 개발 전용 compose 파일 `deploy/dev/ch-ro-tunnel.yml` 을 새로 만든다. 배포 워크플로는 이 파일을 건드리지 않고, 개발 서버에서 한 번 `up -d` 한다.
```yaml
services:
  ch_ro_tunnel:
    image: cloudflare/cloudflared:<고정 버전>
    container_name: stock_ch_ro_tunnel
    command: access tcp
    environment:
      TUNNEL_SERVICE_HOSTNAME: ch-ro.funnotedaily.com
      TUNNEL_SERVICE_URL: 0.0.0.0:18123
    env_file: /opt/stock_app/env/ch-ro-tunnel.env   # TUNNEL_SERVICE_TOKEN_ID / TUNNEL_SERVICE_TOKEN_SECRET (저장소 밖)
    networks: [stock_net]
    # (선택) 로컬 맥 SSH 터널용: ports: ["127.0.0.1:18124:18123"]
    restart: unless-stopped
networks:
  stock_net: {external: true}
```
- 앱에서 보는 주소는 `stock_ch_ro_tunnel:18123` 이다(`stock_net` 컨테이너 이름).
- **사전 확인**: 개발 서버가 실제로 Swarm 모드인지 먼저 본다(`docker stack ls` 에 `stock` 이 있는지, `docker network ls | grep stock_net`).
  - **compose 모드라면** `stock_net` 이 없어서 위 파일의 `up -d` 가 실패한다.
  - 그 경우 `networks` 를 compose 기본 망(`<프로젝트명>_default`, `external: true`)으로 바꿔 앱 컨테이너와 같은 망에 붙인다. 주소는 그대로 `stock_ch_ro_tunnel:18123` 이다.
- compose 컨테이너를 overlay 망에 붙이는 데에는 DB 컨테이너와 같은 재부팅 위험이 있다(`single-node-swarm.md:45`). 재부팅 점검 목록에 추가한다.
- 상용 Access 정책에 서비스 토큰 만료일이 있으면 그 날짜를 운영 일정에 적어 둔다.

**개발 env 키** (`/opt/stock_app/env/.env.production`, 값은 적지 않는다):

| 키 | 값의 의미 |
|---|---|
| `MARKET_DATA_SOURCE` | `prod_readonly` |
| `CLICKHOUSE_HOST` / `CLICKHOUSE_PORT` | 사이드카 컨테이너 이름 / `18123` |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | 상용 `dev_ro` 계정 |
| `CLICKHOUSE_DB` | `stock_data` |
| `CLICKHOUSE_LOCAL_HOST` / `_PORT` / `_USER` / `_PASSWORD` | 개발 자체 CH(지금 값: `clickhouse` / `8123` / 기존 계정) |
| `CLICKHOUSE_CONNECT_TIMEOUT` / `CLICKHOUSE_SEND_RECEIVE_TIMEOUT`(새로 만듦) | 예: 5 / 60. 현재 `get_client` 는 라이브러리 기본값(10초 / **300초**, `httpclient.py:93-94`)을 쓴다. 터널이 멈추면 요청이 5분 동안 매달린다 |
| `DEV_PIPELINE_HOUR` / `DEV_PIPELINE_MINUTE`(새로 만듦) | 경량 파이프라인 시각(기본 23:30) |

### 6-1. 터널이 끊겼을 때 화면 동작

- **API 준비 상태**: `/ready` 는 PG·Redis 만 보므로 배포와 롤백에는 영향이 없다.
- **시장 탭·순위·스크리너·CANSLIM·패턴**:
  - `latest_date()` 류는 예외를 삼켜 "준비 중/빈 화면"을 보인다(`market_query.py:168-174`).
  - 그 밖의 쿼리는 500 이 난다.
  - 결과 캐시는 실패를 저장하지 않으므로 복구되면 바로 정상이 된다(`market_query.py:110-122`).
- **종목 차트**: ⚠ `clickhouse_source.get_candles` 는 CH 오류를 `None` 으로 삼킨다(`clickhouse_source.py:15-26`). 그러면 GraphQL 이 **가짜 시드 캔들**을 그린다(`graphql/schema.py:129-139`, `chart_service.generate_candles`). 차트가 정상처럼 보이므로 장애를 알아채기 어렵다(지금의 CH 장애 때도 같다). 개선은 선택 사항이다.
- **게임 정산**: 일봉 조회가 실패하면 보류하고 재시도한다(`settle_season.py:25-60`). 안전하다. RSI·코치 레벨은 빈 값이다.
- **경량 파이프라인·AI**: 각 단계가 실패로 기록된다. 다음 실행에서 회복한다.

### 6-2. 로컬 맥 영향

- `scripts/dev-db-tunnel.sh` 는 개발 서버 CH(`:8123`)를 본다.
- 전환한 뒤 개발 CH 에는 `game_minute_bars`(와 Q1-a 의 그룹 테이블)만 새로 쌓이고 나머지는 **전환 시점에 멈춘다.**
- 로컬에서도 상용 데이터를 보려면 다음 중 하나를 고른다.
  - (a) 사이드카 포트를 개발 서버 `127.0.0.1:18124` 로 공개하고 터널 스크립트에 포워딩을 하나 더한다.
  - (b) 로컬 맥에서 직접 `cloudflared access tcp` 를 실행한다(같은 토큰을 공유해야 해서 비권장).
- 이것도 같은 두 연결 구조(`CLICKHOUSE_LOCAL_*`)가 필요하다. → Q4

---

## 7. 권장안 요약 (최소 변경)

1. 상용: `dev_ro` 계정(SELECT + readonly=2 + 실행 한도)을 만든다. CH 포트를 127.0.0.1 로 바인딩한다(cloudflared 실행 방식 확인 후).
2. 개발: 사이드카는 개발 전용 compose 로 둔다. env 로 `get_client()` = 상용 읽기, `get_local_client()` = 개발 CH 로 나눈다.
3. 코드(전부 기본값 = 현재 동작):
   - `clickhouse_schema.py`: `get_local_client`·`market_data_readonly`·타임아웃 env 를 추가한다.
   - 게임 분봉 3개 파일을 로컬 클라이언트로 바꾼다.
   - (Q1-a) 시장 그룹 읽기·쓰기를 로컬로 바꾼다.
   - `celery_app.py` beat 를 필터링하고 경량 파이프라인을 추가한다.
   - 쓰기 태스크에 early-return 을 넣는다.
   - `admin_jobs` 에서 거절한다.
4. 상용 서버에 배포해도 env 가 없으므로 동작 변화가 0이다. 기존 테스트는 그대로 통과해야 한다.

### 단계별 작업

| # | 구분 | 내용 |
|---|---|---|
| 1 | 코드 | `shared/clickhouse_schema.py`: `get_local_client()`(env 가 없으면 `get_client()`), `market_data_readonly()`, `connect_timeout`/`send_receive_timeout` env 를 추가한다. 단위 테스트: env 가 없을 때 같은 객체인지, 있을 때 다른 접속값인지 |
| 2 | 코드 | 게임 분봉: `minute_bars.insert_bars`·`_ensure_table`, `kis_backfill.tick_minutes_in_ch`·`dates_in_ch`·`run_*`, `trading_game/services/minute_candles_query.py` → `get_local_client()`. `ensure_game_minute_bars(client=get_local_client())` |
| 3 | 코드 | (Q1-a) `clickhouse_market_groups.py`: `existing_group_ids`·`_insert`·`ensure_market_group_tables` → 로컬, `load_bars` 는 `get_client`. 화면 쪽: `market_query.py` 의 그룹 두 테이블 쿼리(11곳)는 `_query_local`, `theme_metrics.py`·`verify_ticker.py`·`data_status.py` 의 해당 쿼리 |
| 4 | 코드 | `celery_app.py`: `READONLY_DISABLED_BEATS` 와 `collector.dev_readonly_pipeline` 등록(새 태스크는 `tasks/market_data.py` 또는 새 파일 `tasks/dev_readonly.py`) |
| 5 | 코드 | 쓰기 태스크 early-return(4절 목록), `admin_jobs.run` 거절, `theme_admin` 의 send_task 는 Q1-a 이면 그대로 둔다(로컬 재계산) |
| 6 | 상용 서버 | 5-1 확인 → (필요하면) access_management 켜기 → 5-2 SQL → 7-1 의 상용 시험 → 5-4 바인딩 변경(별도 배포 창) |
| 7 | 개발 서버 | `/opt/stock_app/env/ch-ro-tunnel.env`(토큰 키 2개, 권한 600) → `docker compose -f deploy/dev/ch-ro-tunnel.yml up -d` → 연결 시험 → `.env.production` 키 변경 → 백엔드 재배포 |
| 8 | 문서 | `README.md` 환경변수 표(`CLICKHOUSE_LOCAL_*`·`MARKET_DATA_SOURCE` 등), `docs/kiwoom_setup_and_dev_spec.md` 4절의 "보류" 표시를 갱신하고 이 문서를 링크한다 |

### 구현 상태 (2026-11-18, 브랜치 `feature/dev-reads-prod-ch`)

| # | 상태 | 반영 위치 · 설계와 다른 점 |
|---|---|---|
| 1 | ✅ | `shared/clickhouse_schema.py`: `market_data_readonly()`·`readonly_skip()`·`local_client_configured()`·`get_local_client()`·타임아웃 env. 로컬 판정은 `CLICKHOUSE_LOCAL_HOST` 하나로 하고, `LOCAL_USER/PASSWORD` 는 `CLICKHOUSE_USER/PASSWORD` 로 대신 채우지 않는다(readonly 에서는 그 값이 `dev_ro` 라서). 타임아웃은 env 가 있을 때만 넘긴다 |
| 2 | ✅ | 게임 분봉: 리포지토리 기본값을 `get_local_client()` 로 바꿨다(`ensure_game_minute_bars` 포함) |
| 3 | ✅ | 시장 그룹(Q1-a): `clickhouse_market_groups` 의 결과 쓰기·`existing_group_ids` → 로컬, `load_bars` → 상용. 화면은 `market_query`(11곳)·`theme_metrics`·`verify_ticker`·`data_status` 에 더해 **`collector/verify/spot_check`(로컬 CLI)** 도 `_query_local` 로 바꿨다. `_query_local` 은 로컬이 미설정이면 기존 `_query` 로 위임한다 |
| 4 | ✅ | `celery_app.py` 의 `READONLY_DISABLED_BEATS`(6개)·`readonly_beat_schedule()`. 경량 파이프라인 `collector.dev_readonly_pipeline` 은 새 파일 대신 **`tasks/market_data.py`** 에 두었다(include 변경 없음). 마스터 동기화는 `.mst` 파일 다운로드 → PG 뿐이고 KIS 시세 API·CH 쓰기가 없다 |
| 5 | ✅ | 쓰기 태스크 18개 early-return(`backfill_investor_detail`·`backfill_lending` 은 위임 대상이 막는다). `admin_jobs.run` → `JobReadonly` → 409 `JOB_READONLY`. 시장 그룹 두 작업은 허용한다. **FRED**(Q3 계속): 4절의 "이벤트만 저장" 분리 대신, `CLICKHOUSE_LOCAL_*` 가 있으면 `macro_series` 를 개발 CH 에 쓴다(화면은 상용 `macro_series` 를 읽는다) |
| 6-1 보완 | ✅ | 차트 시드 폴백: readonly 에서는 실데이터가 없을 때 가짜 캔들 대신 빈 candles 를 준다(`graphql/schema.py`). `get_candles` 의 None 의미는 정산·RSI·코치가 쓰므로 그대로 둔다 |
| 6 | ⏳ | 상용 서버 — runbook 1~3장 |
| 7 | ⏳ | 개발 서버 — runbook 4~6장. 사이드카 `deploy/dev/ch-ro-tunnel.yml`(이미지 태그·망 이름은 env 파일에서 받는다) |
| 8 | ✅ | README 환경변수 표, `kiwoom_setup_and_dev_spec.md` 4절·Step 2-1 갱신, runbook |

---

## 8. 테스트 계획

### 8-1. 일회용 로컬 CH (메모리 규칙: 일회용 docker, 끝나면 정리)

- `clickhouse/clickhouse-server:24.8` 을 `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` 로 띄우고 5-2 SQL 을 실행한다.
- `dev_ro` 로 clickhouse-connect `get_client()` 접속 → `SELECT` 가 성공하는지 확인한다.
- `INSERT`·`CREATE TABLE IF NOT EXISTS`(이미 있는 테이블)·`ALTER ADD COLUMN IF NOT EXISTS`·`DELETE` 가 **모두 거부**되는지 확인한다.
- 같은 시험을 **readonly=1** 프로필로 반복해 clickhouse-connect 접속이 성공하는지 기록한다. 결과로 5-3 결정을 확정한다.
- `max_execution_time` 초과(`SELECT sleep(3)` 반복 등) 오류가 나는지 확인한다.

### 8-2. 단위 테스트

- `get_local_client` 분기를 확인한다.
- `market_data_readonly()` 가 참일 때 beat 에서 ① 이 빠지고 경량 파이프라인만 추가되는지 확인한다. 거짓일 때는 beat 사전이 **지금과 완전히 같은지** 확인한다(회귀 방지).
- 쓰기 태스크의 early-return 이 KIS 클라이언트를 만들지 않는지, `admin_jobs.run` 이 거절하는지 확인한다.
- 게임 분봉 insert·조회가 로컬 클라이언트를 쓰는지 가짜 클라이언트로 확인한다.

### 8-3. 상용 연결 시험 (사용자 실행)

- 토큰 **없이** 403 이 나는 것은 이미 확인했다.
- 개발 서버 사이드카 → `curl -s 'http://stock_ch_ro_tunnel:18123/?query=SELECT%201' -u dev_ro:…` → `1` 이 나오는지 본다.
- `SELECT count() FROM stock_data.daily_prices FINAL WHERE date = <최근 거래일>` 결과가 상용 서버에서 직접 조회한 값과 같은지 본다.
- `INSERT`·`CREATE` 가 거부되는지 본다.
- **읽기 시간 측정**: 개발 서버에서 `compute_featured_highs`(1년치 전종목, 약 100만 행)를 한 번 돌려 걸린 시간을 잰다. HTTP 는 결과를 내려보내는 시간도 실행 시간에 들어갈 수 있다. 그래서 `max_execution_time`·`CLICKHOUSE_SEND_RECEIVE_TIMEOUT` 은 이 측정값에 여유를 더해 확정한다. 문서의 60초는 임시값이다.

### 8-4. 개발 전환 후 확인

- 시장 탭·종목 차트(005930 2026-08-05 = 종가 242,000·거래량 43,358,171, 상용 값)를 확인한다.
- 스크리너·CANSLIM·패턴이 상용 기준일인지 확인한다.
- 게임 분봉 차트가 개발 시즌 종목으로 쌓이는지 확인한다.
- 다음 날:
  - 20:30 에 개발 KIS 일봉 호출이 없는지(로그) 확인한다.
  - 경량 파이프라인 기록이 남는지(관리자 데이터 현황) 확인한다.
  - 신고저가 특징주가 당일 기준인지 확인한다.
  - (Q1-a) 테마 상세의 설명과 구성 종목이 맞는지 확인한다.
- **장애 시험**: 사이드카를 멈춘다(`docker stop stock_ch_ro_tunnel`) → 시장 탭 오류 또는 빈 화면, `/ready` 200 유지, 차트가 가짜 캔들로 바뀌는지 기록한다 → 다시 켜서 회복하는지 본다.

---

## 9. 위험과 되돌리기

| 위험 | 대응 |
|---|---|
| **CH 스키마 차이**: dev 브랜치가 상용보다 먼저 배포된다. 새 컬럼·테이블(`ensure_*` 의 `ALTER ADD COLUMN`, 예: `clickhouse_screener.py:77`)을 개발 코드가 먼저 읽으면 상용에 없어서 실패하고, 개발은 DDL 권한이 없어 직접 만들 수 없다 | 운영 규칙: **CH 스키마 변경은 상용에 먼저 반영**한다(상용 배포 또는 상용에서 `init_clickhouse`/해당 `ensure_*` 수동 실행). 해당 기능은 그 전까지 개발에서 검증하지 않는다 |
| 상용 부하·대역폭: 신고저가·퀴즈·AI 등 개발 쪽 대량 읽기(1년치 전종목 약 100만 행)가 터널을 지난다 | 실행 한도(5-2), clickhouse-connect 압축(기본 켜짐), 경량 파이프라인을 늦은 시각에 실행 |
| 서비스 토큰 노출 | 저장소 밖 env 파일(600), Access 에서 토큰을 회전·폐기할 수 있다. 계정이 SELECT 전용이라 피해는 읽기에 그친다 |
| 터널이 끊기면 차트가 가짜 캔들로 보인다 | 알려진 동작으로 기록한다. 필요하면 `prod_readonly` 에서 시드 폴백을 끄도록 개선한다(별도) |
| 개발 CH 에 남은 옛 시세(전환 시점에 멈춤) | 그대로 둔다(되돌릴 때 기반). 로컬 맥이 이를 보게 되므로 6-2 를 참고한다 |
| 바인딩 변경(5-4)이 개발 서버의 Swarm 대안 경로를 막는다 | 바인딩 변경은 별도 작업으로 하고 문서에 표시한다 |
| 상용 CH 를 다시 만들 때(access_management) 잠깐 끊긴다 | 장중·20:30~22:30 을 피한다. game_ws 분봉 저장 실패는 무시되도록 설계되어 있다 |

**되돌리기 (env 한 묶음):**

1. 개발 `.env.production` 에서 `MARKET_DATA_SOURCE` 를 지우거나 `local` 로 바꾸고, `CLICKHOUSE_HOST/PORT/USER/PASSWORD` 를 개발 CH 로 되돌리고(`CLICKHOUSE_LOCAL_*` 는 지워도 되고 남겨도 된다), 백엔드를 재배포한다.
2. 그러면 beat·태스크가 원래대로 돌아오고 20:30 자체 수집이 다시 시작된다.
3. **공백 메우기**: 겹침 창은 일봉 30일(`collect_all_daily`), `investor_detail`·`lending` 5거래일(`market_data.py:47,57`)이다. 꺼둔 기간이 이보다 길면 관리자 "초기 데이터 준비"(bootstrap) 또는 해당 백필을 한 번 돌린다. 지수·CANSLIM·스크리너·패턴·그룹도 백필 작업으로 메운다.
4. 사이드카는 `docker compose -f deploy/dev/ch-ro-tunnel.yml down` 으로 내린다. 상용 쪽 계정은 남겨 두어도 무해하다(`DROP USER dev_ro` 선택).

---

## 10. 사용자 결정이 필요한 질문

1. **Q1 테마 처리**: (a) 개발이 시장 그룹(테마·업종)을 계속 직접 계산 — 상용 일봉을 읽고 개발 CH 에 씀, 권장 / (b) 개발에서는 테마 상세가 틀린 것을 감수 / (c) 상용 테마 PG 복제(비권장)
2. **Q2 경량 파이프라인 시각**: 상용 일일 파이프라인이 보통 몇 시에 끝나는지(관리자 데이터 현황의 `finished_at`). 기본 23:30 이면 충분한지
3. **Q3 ③ 항목**: 장중 지수(KIS), AI 6종(Gemini·KIS — 상용과 이중 과금), FRED(끄면 발표 일정 멈춤 / 나누려면 코드 추가)를 개발에서 계속 돌릴지
4. **Q4 로컬 맥**: 로컬 개발도 상용 CH 를 보게 할지(사이드카 포트 공개 + 터널 스크립트 수정), 아니면 개발 CH(멈춘 데이터)를 그대로 볼지
5. **Q5 상용 포트**: CH 만 127.0.0.1 로 바인딩할지, PG·Redis·앱 포트까지 함께 정리할지. 그리고 상용 cloudflared 가 호스트(systemd)에서 도는지 확인

### 결정 (2026-11-18, 사용자 "권장안대로")
| 질문 | 결정 |
|---|---|
| Q1 | **(a)** 개발이 시장 그룹(테마·업종)을 계속 직접 계산 — 상용 일봉을 읽고 결과는 개발 CH 에 |
| Q2 | 개발 경량 파이프라인 **23:30**(env 로 변경 가능). 상용 파이프라인 종료 시각을 관리자 데이터 현황에서 확인해 늦으면 조정 |
| Q3 | 장중 지수·AI·FRED 는 **개발에서 계속 돌린다**(개발 화면 동작 유지 — 비용이 문제 되면 나중에 개별 스위치) |
| Q4 | 로컬 맥은 **지금 그대로**(개발 CH SSH 터널) — 이번 범위 밖 |
| Q5 | **CH 포트만** 127.0.0.1 바인딩(cloudflared 실행 방식 확인 후). PG·Redis·앱 포트는 별도 점검 |

