# 급등락·테마 분석기 설계 (관리자 웹 `/market/daily-surge`)

> 작성 2026-11-26 · 원 기획: [`docs/daily_surge_and_trading_value_analysis_spec.md`](../../daily_surge_and_trading_value_analysis_spec.md)
> 화면 시안: https://claude.ai/artifact/2n3rB9P2zmWbB1sBYejVHL (가짜 데이터)
> 이 문서가 원 기획과 다르면 **이 문서가 우선**한다(약관·데이터 구조 때문에 바꾼 부분이 있다 — 0절).

## 0. 원 기획에서 바꾼 것과 이유

| 원 기획 | 이 설계 | 이유 |
|---|---|---|
| 네이버 뉴스를 `news_items` 로 PG 에 영구 저장, 장전/장중으로 나눠 재배열, 제목에서 이유·키워드 추출 | **저장 안 함.** 화면을 열 때 서버가 정한 검색어로 조회해 **받은 순서 그대로** 보여 주고 기사마다 시각 배지만 붙인다(5분 캐시) | 네이버 검색 API 약관(2026-09-07 시행) — 저장·재정렬·가공·AI 입력 금지. [`docs/naver-search-api-terms-issue.md`](../../naver-search-api-terms-issue.md) 6-1절 N1~N8 |
| 장전 이유·장중 이유 자동 요약 | **DART 공시(전일·당일)** 를 저장하고 공시 제목에서 키워드, **관리자 메모**(테마 공통 / 종목)로 이유 기록 | 공시는 저장 가능한 공공 데이터. 뉴스 기반 이유는 사람이 읽고 한 줄로 남긴다 |
| "장전 뉴스 있는 종목만" 필터 | **"공시 있는 종목만"** | 뉴스를 저장하지 않으므로 뉴스로는 거를 수 없다. DART `list.json` 은 접수 **날짜만** 줘서 공시는 전일·당일까지만 구분 |
| 표 1개 `daily_surge_analyses` | 표 3개(종목·테마 묶음·메모) | 재집계(덮어쓰기)가 관리자 메모를 지우지 않게 분리 |
| `market_stock_daily` 거래대금 | 일봉 `close × volume` 직접 계산 | 개발 서버 자체 CH 의 `market_stock_daily` 는 비어 있을 수 있다(2026-11-25 디스크 장애). 일봉은 상용 CH 10년 치를 읽으므로 과거 날짜 재집계도 가능 |
| 20:30 파이프라인 끝에 연결 | **별도 Celery 작업 + beat 22:10** (+ 관리자 재집계) | 개발 서버는 읽기 전용 모드라 20:30 파이프라인이 돌지 않는다 |
| AI 이유 요약 | **이번에는 없음**(나중에 기본 꺼짐 스위치로 "AI 관찰 요약" — 뉴스는 넣지 않음) | 사용자 결정 2026-11-26 |
| 테마 출처 미지정 | **키움 우선**(`market_repo.active_theme_source`) — 키움 스냅숏이 없는 서버는 KIS 로 대신하고 화면에 출처 표시 | 사용자 결정. 업종 묶음은 이번 범위 밖(키움 업종 `ka20002` 수집은 별도 작업) |

## 1. 범위

- 관리자 웹 전용(사용자 앱·웹 노출은 이번 범위 밖).
- 날짜별: 급등(+10.0% ~ +30.5%), 급락(−30.5% ~ −10.0%), 거래대금 상위 50, 교집합(급등락 ∧ 거래대금 상위 50).
- 테마 묶음: 같은 테마에서 **같은 방향으로 2종목 이상** 급등/급락 → 묶음, 대장주 판별.
- 보통주만: `stock_profile` 의 `is_etp`·`is_spac`·`is_preferred` 제외(프로필 없는 종목도 제외). `is_halted` 는 '지금' 상태라 과거 재집계에서 그날 거래한 종목까지 빼므로 쓰지 않는다(검토 L1, 2026-11-26).

## 2. 집계 (`apps/collector/daily_surge/`)

순수 계산과 입출력을 나눈다.

- `compute.py`(순수 함수, DB 없음)
  - 종목 행: `close, prev_close, change_price, change_rate(소수 2자리), volume, volume_ratio(%; 전일 0 이면 None), trading_value = close × volume`.
  - 분류: `is_surge`(10.0 ≤ r ≤ 30.5), `is_plunge`(−30.5 ≤ r ≤ −10.0), `is_top_value`(거래대금 내림차순 50위 이내). 순위 `surge_rank`(등락률 내림차순, 급등만), `plunge_rank`(오름차순, 급락만), `value_rank`(전체).
  - 테마 묶음: 방향별로 각 테마의 급등(급락) 종목 수 ≥ 2 → 묶음. 묶음 값 = 종목 수, 평균 등락률, 거래대금 합, **대장주 = 거래대금 1위**(같으면 등락률 절댓값 큰 쪽, 그다음 코드 오름차순).
  - 대표 테마: 그 종목이 속한 같은 방향 묶음 중 **함께 움직인 비율(종목 수 ÷ 테마 크기) → 종목 수 → 거래대금 합 → 테마 id 순**(2026-11-27 변경 — 종목 수만 보면 수백 종목짜리 넓은 테마가 뽑혔다).
  - 소속 테마 목록(`themes`, 2026-11-27 추가): 묶음이 없는 종목(혼자 급등·거래대금 상위만)도 어느 테마에 속하는지 보이게 종목마다 최대 5개 — 함께 움직인 수 → 작은 테마 순. 업종 이름(`sector_name`, KIS 마스터)도 함께 저장. 테마 출처가 키움일 때 키움 테마가 하나도 없는 종목은 **KIS 테마로 보충**(`source: "kis"`, 화면에 '(KIS)')하고, 동반 묶음·대표 테마·대장주는 키움 기준 그대로(2026-11-27 사용자 결정 — 상용 키움 연결 894개뿐이라 대부분 '없음') 종목 프로필이 비면(1,000 미만) `종목 프로필 없음`으로 건너뜀. 묶음이 없으면 None. 거래대금 상위만 해당(급등락 아님)인 종목은 대표 테마 없음.
  - 공시 키워드: 정해진 사전(유상증자·무상증자·전환사채·신주인수권·공급계약·수주·감자·합병·분할·자기주식·최대주주변경·감사의견·관리종목·불성실공시·소송·임상·특허·실적 등)과 제목을 대조해 `#키워드` 목록. AI·네이버 미사용.
- `repository.py` — CH 읽기(`daily_prices FINAL`, 기준일과 직전 거래일 두 날짜만), PG 쓰기(아래 표 중 두 개 교체).
- 공시 — 대상(급등·급락·거래대금 상위) 종목의 **직전 거래일 ~ 기준일** 공시. `OpenDartClient.disclosures_between(code, bgn, end, strict=True)` — 실패(목록 수신 실패·네트워크·한도 초과)는 예외로 '공시 없음'과 구분하고, 그 종목은 **이전에 저장한 공시를 유지**한다. 연속 5회 실패하면 남은 종목은 부르지 않는다. 키 없으면 공시 없이 진행.
- 전일 종가: **종목마다 기준일 전 30일 안의 마지막 일봉**(`argMax`) — 그날 일봉이 빠진 종목·거래정지 후 재개 종목도 들어간다(KRX 기준가 = 마지막 종가). 시장 직전 거래일 P(`max(date) < T`)는 확정 판단·공시 기간·뉴스 배지에만 쓴다.
- 확정 판단: P 종목 수 < 1,000 이면 `직전 거래일 일봉 부족`, T 종목 수 < 1,000 또는 < P 의 90% 면 `일봉 미확정`으로 **건너뜀**(부분 적재가 정상 결과를 덮지 않게).
- 저장은 날짜 단위 **교체**(그 날짜의 종목·묶음 행을 지우고 다시 넣기, 한 트랜잭션) → 몇 번을 다시 돌려도 결과가 같다. 메모 표는 건드리지 않는다.

Celery 작업 `collector.analyze_daily_surge(date=None)` — 날짜 없으면 CH 최신 거래일. Redis 잠금(`lock:daily_surge:<date>`, 30분)으로 같은 날짜 중복 실행 방지.
beat `analyze-daily-surge` 평일 22:10(KST, `scheduled` — 오늘이 거래일이고 오늘 일봉이 있을 때만) + `analyze-daily-surge-retry` 23:40(`only_if_missing` — 22:10 에 건너뛴 날만). 상용·개발 공통(읽기 전용 beat 에서도 유지). 수동(관리자) 실행은 날짜 확인 없이 최신 거래일.

알려진 한계(검토 L2·L5): 권리락(무상·유상증자) 날은 전일 종가 대비라 거짓 급락이 나올 수 있다(그날 `#무상증자`·`#유상증자` 공시 키워드로 구별). 공시 '당일'에는 장 마감 뒤 접수분도 섞인다(DART 가 접수 시각을 주지 않음). 거래대금은 종가×거래량이라 장중 변동이 큰 종목은 실제보다 크다.

## 3. PG 표 (마이그레이션 1개)

`daily_surge_stocks` — PK `(trade_date, ticker)`
`trade_date DATE, ticker VARCHAR(20), name VARCHAR(100), market VARCHAR(10), close, prev_close, change_price, change_rate FLOAT, volume BIGINT, volume_ratio FLOAT NULL, trading_value FLOAT, is_surge, is_plunge, is_top_value BOOL, surge_rank, plunge_rank, value_rank INT NULL, primary_theme_id INT NULL, primary_theme_name VARCHAR(100) NULL, is_theme_leader BOOL, dart_items JSONB '[]'` ([{rcept_no, title, rcept_dt, when: "prev"|"same", url}]), `dart_keywords JSONB '[]'`, `created_at`. 인덱스 `trade_date`.
저장 대상: 급등 ∪ 급락 ∪ 거래대금 상위 50 만(전 종목 아님).

`daily_surge_theme_groups` — PK `(trade_date, theme_id, direction)`
`theme_name, direction VARCHAR(5) ('up'|'down'), stock_count INT, avg_change_rate FLOAT, value_sum FLOAT, leader_ticker, leader_name, theme_source VARCHAR(10)` (`kiwoom|kis|admin`), `created_at`.

`daily_surge_notes` — PK `id`, 유일 `(trade_date, scope, target)`
`trade_date, scope VARCHAR(10) ('theme'|'stock'), target VARCHAR(20)` (테마 id 문자열 또는 종목코드), `note VARCHAR(300), author_id INT NULL → users ON DELETE SET NULL, updated_at`.
표시 우선순위: 종목 메모 > 대표 테마 메모(“테마 공통” 표시).

## 4. API (stock_api, 관리자 전용)

접두사 `/api/v1/admin/market/daily-surge`. 권한: 조회·메모 `SCREENER_VIEW`, 재집계 `DATA_PIPELINE`.

| 메서드·경로 | 응답 요약 |
|---|---|
| `GET /dates?limit=60` | `[{date, surge_count, plunge_count, value_count, group_count}]` 최신순 |
| `GET ?date&mode&band&market&dart_only&sort&order` | `{date, theme_source, items:[종목 행 + note(우선순위 적용)]}`. `mode` surge·plunge·value·surge_value·plunge_value, `band` all·10_15·15_25·25_30(절댓값), `sort` change_rate·trading_value·volume·change_price·volume_ratio. 기본 정렬: surge 등락률↓, plunge 등락률↑, 나머지 거래대금↓ |
| `GET /groups?date&direction` | `[묶음 + note]` (종목 수↓, 거래대금 합↓) |
| `GET /{date}/stocks/{ticker}` | 종목 행 + 공시 + 메모(종목·테마) + 대표 테마 **성적표**(테마 전 종목의 그날 등락률·거래대금, 급등락 아닌 종목 포함 — 일봉에서 바로 계산) |
| `GET /{date}/themes/{theme_id}?direction` | 묶음 + 메모 + 성적표 |
| `PUT /notes` `{date, scope, target, note}` / `DELETE /notes?date&scope&target` | 메모 쓰기(덮어쓰기)·지우기. 빈 문자열이면 422 |
| `POST /rebuild?date` | Celery 작업 전송, `{task_id}` 또는 409 `ALREADY_RUNNING` |
| `GET /news?kind=stock|theme&date&target` | 네이버 뉴스 바로 보기(5절) |

없는 날짜 → 빈 목록(404 아님). 없는 종목·테마 → 404 `NOT_FOUND`.

## 5. 네이버 뉴스 바로 보기 (저장 안 함)

- 검색어는 서버가 만든다: 종목 `"{종목명} 특징주"`, 테마 `"{테마명} 관련주"` (기존 `mover_query`·`theme_query`), `sort=date`, `display=10`. 임의 검색어를 받지 않는다.
- 결과는 **받은 순서·개수 그대로**. 각 기사에 `time_slot` 만 덧붙인다 — 기준일 T, 직전 거래일 P:
  `pre` P 15:30 ≤ t < T 09:00 · `intra` T 09:00 ≤ t ≤ T 15:30 · `post` T 15:30 < t < T+1 00:00 · `other` 그 밖.
- Redis 캐시 키 `naver:news:<sha1(검색어)>` **300초**. DB 저장 없음. 응답에 `source: "naver_news_search"`, `query` 포함.
- 키 없음·호출 실패 → `{items: [], unavailable: true}` (200).
- 화면: "네이버 뉴스 검색 결과" + 검색어 표시, 원문 링크(`originallink`, 없으면 `link`) 새 탭, 광고 없음, AI 문장과 분리.

## 6. 관리자 웹

- 사이드바 `시장 데이터` 맨 위에 `급등락·테마 분석`(`/market/daily-surge`, 권한 `SCREENER_VIEW`). 기존 메뉴 유지.
- 파일: `api/dailySurge.ts`(호출·타입), `lib/dailySurge.ts`(배지·색·숫자 표시 순수 함수), `pages/MarketDailySurge.tsx`(상태), `components/dailySurge/` — `ThemeGroupList`, `SurgeStockTable`, `DetailPanel`(테마·종목), `NoteEditor`, `NaverNewsList`.
- 시안대로: 기본 보기 = 테마 묶음, 탭(테마 묶음·급등·급락·거래대금·교집합), 등락 구간 칩, 공시만 칩, 정렬 선택, 날짜 이동·최근 날짜, 테마 출처 표시, 재집계 버튼(권한 있을 때만). 상승 빨강·하락 파랑.
- 종목 상세 하단에 기존 `StockDailyChart`.

## 7. 오류 처리

| 상황 | 동작 |
|---|---|
| 기준일 일봉 미확정 | 작업 `skipped`, 기존 저장 유지 |
| DART 키 없음·실패 | 공시 없이 저장(종목별 실패는 그 종목만 빈 목록), 결과에 `dart_failed` 수 |
| 테마 조회 실패 | 묶음 없이 종목만 저장, `theme_error` 표시 |
| 네이버 실패 | `unavailable: true` — 화면은 "뉴스를 불러오지 못했습니다" |
| 재집계 중복 | 409 `ALREADY_RUNNING` |

## 8. 테스트

- `tests/test_daily_surge_compute.py`: 등락률·전일대비·거래대금, 경계값(+10.0·+30.5·−10.0·−30.5 포함, +9.99·+30.51 제외), 보통주 필터, 거래대금 50위, 묶음 2종목 기준, 대장주 동률 규칙, 대표 테마 고르기, 공시 키워드, time_slot 경계(15:30·09:00·자정).
- `tests/test_daily_surge_api.py`: 목록 mode·band·dart_only·정렬, 메모 우선순위, 메모 PUT/DELETE, 권한(EDITOR 403, ANALYST 조회·메모 가능, 재집계는 DATA_PIPELINE), 뉴스 — 순서 그대로·캐시·실패 시 unavailable.
- 집계 저장 멱등(같은 날짜 두 번 → 행 수 동일, 메모 보존).
- admin_web: `tsc --noEmit`, 표시 함수 단위 테스트(테스트 도구가 있으면).

## 9. 나중 작업(이번 범위 밖)

- 키움 업종 스냅숏(`ka20002`) 수집 → 업종 묶음.
- 개발 서버 키움 키(테마·업종 수집만) — 사용자: 키 입력, 키움에 개발 서버 IP 등록.
- AI 관찰 요약(기본 꺼짐, 뉴스 미입력, 근거 없는 문장 제거).
- 사용자 앱·웹 노출(시세 공개 스위치 조건).
