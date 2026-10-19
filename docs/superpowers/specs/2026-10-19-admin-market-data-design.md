# 관리자 시장 데이터 1단계 — 테마 보정 · 데이터 현황 · 계산 수동 실행

작성일: 2026-10-19 · 상태: 검토 대기

## 목적

스크리너(주도주·시장·테마·업종·일정)가 쓰는 데이터를 관리자 웹에서 보정하고 상태를 확인하며, 서버에 접속하지 않고 계산을 다시 돌릴 수 있게 한다.
2단계(별도 스펙): CANSLIM C 설정(DB 설정화), 일정 수동 등록, KIS 수집 작업 수동 실행.

## 범위

| 화면 | 경로 | 내용 |
|---|---|---|
| 테마 보정 | `/market/themes` | 테마 목록 + 시장 지표, 숨김·이름·설명 수정, 관리자 테마 생성, 종목 추가·제외 |
| 데이터 현황 | `/market/status` | 데이터별 최신일·종목 수·상태 배지, 지수 코드별 최신일, 설정 상태, 최근 일일 파이프라인 결과 |
| 계산 수동 실행 | `/market/status` 아래 | KIS 를 호출하지 않는 작업 4개 버튼 + 최근 실행 기록 |

사이드바에 그룹 **"시장 데이터"**(테마 보정, 데이터 현황)를 추가한다. 기존 메뉴·라우트는 바꾸지 않는다.

### 앞서 제안한 설계에서 바뀐 점

1. **수동 실행은 계산·백필 4개만**(CANSLIM 계산, 시장 그룹 계산, 각 60일 백필). 재무·지수·공모주·FRED 같은 KIS·외부 수집은 2단계로 옮긴다.
   - 레이트리미터(`apps/collector/rate_limit.py`)는 프로세스 안에서만 적용된다. 그래서 수동 수집과 일일 파이프라인이 동시에 돌면 KIS 호출 속도가 두 배가 된다.
   - 이를 막으려면 파이프라인 잠금이 필요하므로 2단계에서 함께 설계한다.
   - 오늘 실제로 필요했던 작업은 계산과 백필이다.
2. **작업 본문에 잠금을 걸지 않는다.**
   - 테마를 보정할 때마다 `compute_market_groups` 를 보낸다. 실행 중일 때 건너뛰는 잠금을 걸면, 연속 보정 중 마지막 수정이 다음 날까지 반영되지 않는다.
   - 계산 작업은 멱등이고 ReplacingMergeTree 에 쓰므로, 겹쳐 실행돼도 결과가 같다.
   - 중복 방지는 **관리자 수동 실행 API 단계**에서만 한다(아래 "수동 실행 안전장치").
3. **"20:30~21:30 무거운 작업 차단" 규칙은 없앤다.** 1단계 작업은 KIS 를 호출하지 않아 파이프라인과 겹쳐도 안전하다. 2단계에서는 시각 대신 파이프라인 잠금으로 막는다.
4. **"오래됨" 기준을 데이터별로 정한다.** 하나의 "2거래일" 기준을 쓰면 주 1회 수집하는 재무와 월간인 FRED 가 늘 오래됨으로 보인다.

## 백엔드 (stock_api, 관리자 JWT `require_admin`)

### 1) 테마 목록·종목에 시장 지표 추가 (기존 응답에 필드만 추가)

- `GET /api/v1/admin/themes/metrics`(신규): `{as_of, themes: {"<테마 id>": {rank, chg_1d, value, members, leader_ticker, leader_name}}}`
  - 값은 `market_group_daily` 의 최신 날짜, `kind='theme'`, `group_id=str(theme.id)` 에서 읽는다(FINAL).
  - 해당 행이 없는 테마(숨김 테마, 종목 3개 미만 등)는 키가 빠진다.
  - 기존 `GET /api/v1/admin/themes` 응답은 그대로 둔다. 기존 테스트가 응답 전체를 비교하므로, 지표는 화면에서 합친다.
- `GET /api/v1/admin/themes/{id}/stocks`: 각 항목에 다음을 추가한다.
  - `name`: `market_repo.names_for`
  - `chg_1d`, `value`: `market_stock_daily` 최신 날짜에서 읽는다.
- 기존 필드·순서·상태 코드는 그대로다. ClickHouse 가 실패하면 지표만 `null` 로 두고 목록은 그대로 반환한다(로그 경고).
- 서비스: `services/theme_admin.py` 는 그대로 두고, 지표를 붙이는 함수를 `services/theme_metrics.py` 에 따로 둔다(CH 조회, 동기 → `run_in_threadpool`).

### 2) 데이터 현황 `GET /api/v1/admin/market/status`

`services/data_status.py` 가 집계하고, CH 조회는 데이터마다 1~2개다. 전체 `count() FINAL` 은 쓰지 않는다.

**기준일:** `ref = max(date) FROM daily_prices`(최신 거래일). 지연은 달력이 아니라 이 기준일과 비교하므로 휴장일 달력이 필요 없다.

| key | 표시 이름 | 최신일 | 종목/행 수 | 오래됨 기준 |
|---|---|---|---|---|
| daily | 일봉 | `max(date)` daily_prices | 그 날짜 `uniqExact(ticker)` + 전 거래일 종목 수 | 기준일 자체. 전 거래일보다 종목 수가 10% 넘게 줄면 `warn` |
| indices_kr | 국내 지수 | 코드별 `max(date)` market_index_daily(`index_specs("KR")` 코드) | 코드 수 | 어느 코드든 `< ref` |
| indices_us | 미국 지수·환율·대표 종목 | 코드별(`index_specs("US")`) | 코드 수 | 어느 코드든 ref 보다 4일 넘게 이전(시차·미국 휴장 허용) |
| investor | 투자자 순매수 | `max(date)` investor_daily | 그 날짜 종목 수 | `< ref` |
| fundamentals | 재무 | `max(ingested_at)` fundamentals_periodic | `uniqExact(ticker)` | 오늘보다 8일 넘게 이전(주 1회 토요일) |
| macro | FRED | 시리즈별 `max(date)` | 시리즈 수 | 키 미설정이면 `off`. 시리즈 최신일이 오늘보다 45일 넘게 이전이면 그 시리즈만 stale |
| ipo | 공모주 일정 | `max(updated_at)` stock_events(source='kis') | 앞으로 60일 일정 수 | 오늘보다 3일 넘게 이전 |
| canslim | CANSLIM | `max(date)` canslim_daily | 그 날짜 행 수 | `< ref` |
| market_groups | 시장 그룹 | `max(date)` market_group_daily | 그 날짜 kind 별 행 수 | `< ref` |

- **응답:** `{ref_date, generated_at, datasets:[{key, label, latest, count, unit, status: ok|stale|warn|empty|off|error, note, items?:[{code, name?, latest, status}]}], settings:{fred_key: bool, q_cumulative: "true"|"false"|"unset"}, pipeline}`
- 데이터 하나의 조회가 실패하면 그 항목만 `status:"error"` 로 표시하고, 나머지는 그대로 반환한다.
- **설정 표시:** 값은 절대 반환하지 않는다. `FRED_API_KEY` 는 있는지 여부만, `FUNDAMENTALS_Q_CUMULATIVE` 는 true/false/unset 세 값만 보여준다. stock_api 와 worker 는 같은 env 파일을 쓴다.
- **`pipeline`:** 아래 3)에서 저장한 최근 일일 파이프라인 기록이다. 기록이 없으면 `null` 이다.

### 3) 일일 파이프라인 결과 기록 (collector, 최소 변경)

`daily_market_pipeline` 의 단계 순서와 반환값(`out`)은 그대로 둔다. 각 단계의 걸린 시간을 재고, 끝에 Redis 키 `collector:pipeline:last` 에 JSON 을 저장한다(만료 8일).

```json
{"started_at": "...", "finished_at": "...", "steps": [{"name": "daily", "ok": true, "seconds": 1234.5, "summary": "<결과 dict 를 200자로 자른 문자열>"}]}
```

- 실패한 단계는 `ok:false` 이고, `summary` 에 오류 문자열을 넣는다.
- 저장에 실패해도 파이프라인 결과에는 영향이 없다(경고 로그만 남김).
- 테스트로 확인할 것:
  - 단계 순서와 반환 형태가 그대로인지
  - 기록이 저장되는지
  - Redis 가 실패해도 반환값이 같은지

### 4) 계산 수동 실행

| job key | 표시 이름 | Celery 태스크 | 예상 시간 | 잠금 TTL |
|---|---|---|---|---|
| canslim | CANSLIM 계산(최신일) | `collector.compute_canslim` | 수 초 | 10분 |
| market_groups | 시장 그룹 계산(최신일) | `collector.compute_market_groups` | 수 초 | 10분 |
| backfill_canslim | CANSLIM 60일 백필 | `collector.backfill_canslim`(days=60) | 수 분 | 60분 |
| backfill_market_groups | 시장 그룹 60일 백필 | `collector.backfill_market_groups`(days=60) | 수 분 | 60분 |

- `GET /api/v1/admin/market/jobs`
  - 작업 목록, 각 작업의 현재 상태(`idle|queued|running`), 최근 실행 기록을 반환한다.
  - 기록은 최근 30건이다. 항목은 `{job, task_id, actor, requested_at, state, result_summary}` 이다.
- `POST /api/v1/admin/market/jobs/{job}`: 결과는 다음 셋 중 하나다.
  - 알 수 없는 job 이면 `404`
  - 이미 실행 중이면 `409 {detail:"실행 중", task_id, requested_at}`
  - 작업 큐(브로커)에 보내지 못하면 `503`(잠금은 바로 해제)
  - 성공하면 `202 {task_id}`

**수동 실행 안전장치**

- **권한:** `require_admin` 만 통과한다. 실행 대상은 위 표(서버 상수 `JOBS`)뿐이고, 요청 본문으로 태스크 이름을 받지 않는다.
- **중복 방지:**
  - Redis 키 `admin:job:{job}` 에 `SET NX EX <TTL>` 으로 `{task_id, actor, requested_at}` 를 저장한다.
  - 키가 있으면 `celery_app.AsyncResult(task_id).state` 를 확인한다. `PENDING`·`STARTED`·`RETRY` 이면 409 를 반환한다. 그 밖의 상태(SUCCESS·FAILURE)이면 잠금이 남은 것으로 보고 덮어쓴다.
  - 배포로 워커가 교체돼 태스크가 `STARTED` 에 멈춰 있어도, TTL 이 지나면 풀린다.
- **기록:** Redis 리스트 `admin:job:history` 에 LPUSH 하고 LTRIM 으로 30건만 둔다. 상태와 결과는 조회할 때 `AsyncResult` 로 채운다. Celery 결과는 1일 뒤 만료되므로, 만료 후에는 `state:"UNKNOWN"`(기록만 남음)이다. 서버 로그에도 `admin job run` 으로 남긴다.
- **스케줄 실행:** beat 실행은 이 기록에 넣지 않는다. 일일 파이프라인은 2)의 `pipeline` 으로 보여준다.
- **상태 판정:** `state` 가 `PENDING` 이면 `queued`(워커 대기 중), `STARTED` 이면 `running` 이다(`task_track_started=True`). 워커 동시 실행 수는 기본값(CPU 수)이다. 다만 긴 파이프라인 중에도 대기할 수 있어 "대기 중"을 따로 표시한다.
- **Redis 연결:** stock_api 는 지금 Redis 를 쓰지 않는다. `redis.asyncio.from_url(REDIS_URL)` 을 작업 서비스 안에서 지연 생성해 쓴다. `/ready` 는 바꾸지 않는다.

라우터는 `routers/market_admin.py`(status·jobs)에 둔다. 서비스는 `services/data_status.py`(CH 조회 포함 — 기존 `market_query.py` 의 `_query` 관례를 따름)와 `services/admin_jobs.py` 로 나눈다. 동기 Redis 는 `shared/sync_redis.py`, 파이프라인 기록은 `shared/pipeline_record.py` 를 함께 쓴다.

## 관리자 웹 (admin_web)

- **API 클라이언트:** `api/stockAdmin.ts` 는 `STOCK_API_URL` 에서 `/graphql` 을 뗀 base 와 기존 `makeClient`(관리자 JWT·재시도 없음)를 쓴다. 종목 검색은 기존 `stockClient.searchStocks`(GraphQL)를 재사용한다.
- **타입:** `types/marketAdmin.ts`

### 테마 보정 `pages/MarketThemes.tsx`

- **넓은 화면:** 왼쪽은 목록, 오른쪽은 상세다.
- **좁은 화면(< 1024px):** 목록을 위에 두고, 선택한 상세를 그 아래에 연다. 상세가 열리면 그 위치로 스크롤한다.
- **목록:**
  - 검색(이름), 정렬(순위·1일 등락·거래대금·종목 수·이름), "숨긴 테마 보기" 토글(기본 끔), 출처 배지(KIS/관리자)
  - 각 행: 이름, 종목 수, 순위, 1일 등락(빨강·파랑), 거래대금(억·조), 숨김 표시
  - 지표가 `null` 이면 "—" 로 표시한다. 기준일은 목록 위에 한 번만 표시한다.
- **상세:**
  - 이름·설명 수정과 저장, 숨김 토글을 둔다.
  - 구성 종목 표의 열은 이름, 코드, 출처, 1일 등락, 편입 사유, 제외·복구 버튼이다.
  - 제외된 종목은 흐리게 표시하고, 기본으로 아래쪽에 둔다.
  - 종목 추가: 검색 자동 완성(300ms 디바운스) → 선택 → 편입 사유 입력(선택) → 추가
- **새 테마 만들기:** 버튼을 누르면 이름·설명을 입력받아 관리자 테마를 만든다.
- **안내:** 저장·추가·제외에 성공하면 토스트 "저장했어요. 테마 순위는 잠시 뒤 다시 계산돼요"를 띄운다.

### 데이터 현황 `pages/MarketStatus.tsx`

- **상단:** 기준 거래일, 새로고침 버튼
- **카드 그리드:** 넓은 화면은 3열, 좁은 화면은 1열
  - 카드마다 표시 이름, 상태 배지(정상·오래됨·주의·없음·꺼짐·오류), 최신일, 종목/행 수, 설명(note)
  - 지수·FRED 카드는 펼치면 코드별 최신일과 상태를 보여준다.
- **설정 상태 카드:** FRED 키(설정됨/없음), 분기 EPS 형식(누적/단독/미설정 — 2단계에서 화면에서 바꿀 수 있게 한다는 안내 포함)
- **최근 일일 파이프라인:** 단계별 성공·실패와 걸린 시간. 실패한 단계를 누르면 오류 요약을 펼친다.
- **계산 수동 실행:**
  - 작업마다 이름, 설명, 예상 시간, "KIS 호출 없음" 표시, 실행 버튼을 둔다.
  - 버튼을 누르면 확인창(기존 앱 모달 관례)이 뜬다. 실행 후에는 5초마다 목록을 다시 불러와, 대기 중·실행 중·완료·실패를 표시한다. 실행 중에는 버튼을 비활성화한다.
  - 409 이면 "이미 실행 중이에요(시작 시각)"를 표시한다.
  - 아래쪽에 최근 실행 기록 표(시각, 작업, 실행자, 상태, 결과 요약)를 둔다.

## 테스트

- **백엔드(pytest):**
  - theme_metrics: 지표 붙이기, CH 실패 시 null, 기존 필드 보존
  - data_status: 데이터별 상태 판정, 기준일 비교, 종목 수 감소 경고, 조회 실패 격리, 설정 값 비노출
  - admin_jobs:
    - 화이트리스트, 409(실행 중), 잠금이 남은 경우 덮어쓰기, 기록 30건 유지
    - Redis 는 fakeredis 또는 기존 테스트 관례를 따르고, send_task 는 가로챈다
  - 라우터: 관리자가 아니면 401/403
  - 파이프라인 기록: 순서·반환값 보존, 기록 저장, Redis 실패 무시
  - 기존 테마 관리자 테스트가 그대로 통과해야 한다
- **관리자 웹:** 테스트 프레임워크가 없어 `npm run build`(tsc)로 검사한다. 로컬 브라우저에서 데스크톱과 모바일 폭(390px)으로 두 화면을 확인한다.
- **실데이터 확인:** 로컬 개발 DB(SSH 터널)로 현황 API 를 호출해 값을 확인한다. KIS 는 호출하지 않는다.

## 범위 밖

- CANSLIM C 설정, 일정 수동 등록, KIS 수집 수동 실행, 파이프라인 잠금(2단계)
- 지수·FRED 시리즈 목록 편집, 종목 업종 보정, 배포·서버 상태
