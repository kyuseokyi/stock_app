# 시장 대시보드·테마·업종·일정 (스크리너 프로젝트 3) — 설계

> 상태: 설계 확정(사용자 승인 2026-10-19) · 작성 2026-10-19
> 선행: 프로젝트 1 시장 데이터 수집(`2026-10-18-market-data-foundation-design.md`), 프로젝트 2 CANSLIM(`2026-10-18-canslim-design.md`)
> 기획 원본: `docs/joodal_curation_service_plan.md`(주달) — 이 문서는 그중 테마 랭킹·트리맵·테마 상세·일정 캘린더를 공식 데이터로 구현한다.

## 1. 사용자 결정 (2026-10-18~19 브레인스토밍)

| 항목 | 결정 |
|---|---|
| 범위 | 시장 대시보드(지수·거시 요약) + 테마·업종 랭킹·트리맵·상세 + 일정 캘린더. **관리자 테마 보정 UI·뉴스·AI 요약은 다음**(네이버 키·Ollama 없음) |
| 갱신 기준 | **종가 기준 하루 1회**(장중 갱신 없음 — 전종목 현재가 API 없음·레이트리밋 경합) |
| 위치 | 새 메뉴를 만들지 않고 **기존 '스크리너' 메뉴 안 탭**으로 |
| 트리맵 면적 | 시총/거래대금 **전환 토글, 기본 시총** |
| 계산 방식 | **H2 — 매일 미리 계산해 CH 에 저장, 관리자 테마 보정 시 최신 기준일만 다시 계산**. API 는 읽기만 |
| CANSLIM 탭 이름 | 화면에 'CANSLIM' 을 내세우지 않는다 → 탭 **'주도주'**, 제목 '주도주 분석'. 내부 이름(테이블·GraphQL·파일)은 그대로 |

## 2. 계산·저장 (collector)

### 2.1 종목 값
- 대상: `market_repo.analysis_universe`(보통주 — ETF·SPAC·우선주 제외). 거래정지(`stock_profile.is_halted`) 종목은 그룹 평균·상승/하락 수에서 뺀다(목록에는 표시).
- 입력: `daily_prices FINAL` 의 기준일 포함 최근 21봉.
- `chg_1d / chg_5d / chg_20d` = 기준일 종가 ÷ 1·5·20봉 전 종가 − 1 (%). 봉이 모자라면 해당 값 NULL(그 기간 평균에서 제외).
- `value`(거래대금) = 종가 × 거래량(일봉에 거래대금 컬럼이 없어 근사 — CANSLIM `avg_value_20d` 와 같은 방식).
- `mcap`(시가총액) = 종가 × `stock_profile.listed_shares_k` × 1000. 상장주식수가 없으면 NULL.
- 기준일 봉이 없는 종목은 건너뛴다.

### 2.2 그룹 집계
- 테마: PG `themes`(`is_hidden=false`) × `theme_stocks`(`is_excluded=false`), 분석 대상 종목만. `group_id` = 테마 id(문자열).
- 업종: `stock_profile.sector_m`(`sectors` 이름). `group_id` = 업종 코드.
- 값:
  - `chg_1d/5d/20d` = 구성 종목 값의 **단순 평균**(NULL 제외)
  - `value`·`mcap` 합, `up/down/flat`(1일 등락 > 0 / < 0 / = 0)
  - `leader_ticker`·`leader_chg` = 그날 상승 종목 중 거래대금 1위(상승 종목이 없으면 거래대금 1위)
  - `rank` = `chg_1d` 내림차순 순위(1부터). **구성 종목 3개 미만 그룹은 rank 0(순위 제외)** 이며 목록에서도 기본으로 빠진다.
- 상수(`MIN_MEMBERS=3`, `TOP_N_STREAK=10`)는 한곳에 모은다.

### 2.3 저장 (CH, ReplacingMergeTree(ingested_at), 조회는 FINAL, PARTITION BY toYYYYMM(date))
- `market_stock_daily(date, ticker, market, sector_m, close, chg_1d, chg_5d, chg_20d Nullable(Float64), value Float64, mcap Nullable(Float64), ingested_at)` ORDER BY (date, ticker)
- `market_group_daily(date, kind LowCardinality(String) 'theme'|'sector', group_id, name, members UInt16, chg_1d, chg_5d, chg_20d Nullable(Float64), value, mcap Float64, up, down, flat UInt16, leader_ticker String, leader_chg Nullable(Float64), rank UInt16, ingested_at)` ORDER BY (date, kind, group_id)
- 재계산 시 같은 (date, kind, group_id) 로 다시 넣으면 FINAL 에서 최신 행이 이긴다. **보정으로 숨겨진 테마**는 그날 행이 남지 않도록, 재계산 때 그 기준일 `kind='theme'` 의 이전 그룹 중 이번 결과에 없는 것은 `members=0, rank=0` 행으로 덮어쓴다(조회는 `members > 0` 만).

### 2.4 언제 계산하나
| 시점 | 태스크 |
|---|---|
| 매일 일일 파이프라인 끝(20:30 시작 — 일봉 → 국내 지수 → 투자자 → CANSLIM → **시장 그룹**) | `collector.compute_market_groups(as_of=None)` — 기준일 = `daily_prices` 최신 거래일 |
| 관리자 테마 보정(생성·수정·종목 추가·제외) | 같은 태스크를 최신 기준일로 즉시 실행 |
| 처음 한 번(수동) | `collector.backfill_market_groups(days=60)` — 과거 날짜는 **현재** 테마 소속·상장주식수 기준 근사 |

- 계산은 순수 함수 모듈 `apps/collector/market_groups/`(입력: 종목 봉·프로필·소속 → 출력: 종목 행·그룹 행). CH 조회·저장은 `repositories/clickhouse_market_groups.py`.
- 그룹 하나·종목 하나 계산 오류는 격리(로그 후 계속).

## 3. API (stock_api GraphQL, 공개 — 로그인 불필요)

```graphql
marketOverview: MarketOverview!
#  → { indices: [{ code, name, region(KR|US|FX), date, close, chg1d, spark: [Float!]! (최근 20종가) }],
#      macro:   [{ seriesId, name, date, value, prev }] }      # FRED 데이터 없으면 빈 배열
#  지수는 market_index_daily 의 기본 지수(KR 3·US 6·원/달러). 대표 종목(USSTK:*)은 제외

marketGroups(kind: String! = "theme", period: String = "1d", sort: String = "chg",
             limit: Int = 30, offset: Int = 0): GroupRanking!
#  kind: theme | sector, period: 1d | 5d | 20d, sort: chg | value
#  → { date, total, items: [{ id, name, members, chg, value, up, down, flat,
#                             leader { ticker name chg }, rank, streak }] }
#  chg = 선택 기간 평균 등락률. rank 는 저장된 1일 순위. streak = 최근 연속 rank 1~10 일수

marketTreemap(kind: String! = "sector", size: String = "mcap", period: String = "1d"): Treemap!
#  → { date, groups: [{ id, name, chg, size, stocks: [{ ticker, name, chg, size }] }] }
#  그룹 안 종목은 size 상위 30 + 나머지 '기타' 1칸. theme 은 거래대금 상위 30개 테마만

marketGroup(kind: String!, id: String!): GroupDetail       # 없으면 null
#  → { kind, id, name, description, date, chg1d, chg5d, chg20d, value, mcap, up, down, flat, rank,
#      history: [{ date, chg1d, rank }] (최근 60거래일, 오래된 순),
#      stocks:  [{ ticker, name, close, chg1d, chg5d, value, mcap, isLeader, reason }] (거래대금 순) }

marketCalendar(from: String!, to: String!, category: String): [CalendarEvent!]!
#  → [{ date, title, category(공모주|경제지표), ticker, name, detail }]  — PG stock_events, 최대 92일(초과분 잘라냄)
```

- 서비스 `apps/stock_api/services/market_query.py`(리졸버는 얇게). 종목명·업종명은 PG `stock_meta`·`sectors`(CANSLIM `_names` 패턴).
- `kind·period·sort·size·category` 는 화이트리스트, 아니면 기본값. `limit` 상한 100.
- `detail` 은 서버가 payload 로 문장을 만든다(공모주: "공모가 25,000원 · 주관 ○○증권", 청약/상장 구분 / 경제지표: "발표 예정").
- 기준일 = `market_group_daily FINAL` 최신 date. 계산된 날이 없으면 `date: null`·빈 목록.
- **재계산 연결**: `services/theme_admin.py` 의 create·update·add_stock·exclude_stock 끝에서 Celery `send_task("collector.compute_market_groups")`. 전송 실패는 로그만(보정 자체는 성공 — 다음 파이프라인에서 반영).
- 캐시 없음(저장값 읽기만, 필요해지면 추가).

## 4. 웹 (web_client) — `/screener` 안의 탭

- 탭: **시장 · 테마 · 업종 · 일정 · 주도주** — 중첩 라우트 `/screener/market|themes|sectors|calendar|leaders`. `/screener` → `/screener/market` 리다이렉트. 메뉴 이름·개수는 그대로(홈·커뮤니티·게임·스크리너·내정보).
- 공통 레이아웃(부모 라우트): 탭 바(좁은 화면 가로 스크롤) + 아래 "기준일 YYYY-MM-DD 종가 · 투자 권유가 아닙니다".
- **주도주 탭** = 기존 CANSLIM 화면 그대로 이동. 제목 'CANSLIM 스크리너' → '주도주 분석' + 작은 설명 "윌리엄 오닐의 CANSLIM 7가지 기준으로 실적과 추세가 강한 종목을 찾습니다". 비대상 문구 'CANSLIM 분석 대상(보통주)이 아니에요' → '주도주 분석 대상(보통주)이 아니에요'. `?ticker=` 로 열면 그 종목 상세 선택.
- **시장 탭**: 지수 카드(국내 3·미국 6·원/달러, 종가·등락·20일 스파크라인, 미국은 날짜 표시), 거시 지표 카드(데이터 없으면 숨김), 주도 테마 Top 5, 업종 트리맵 축소판, 다가오는 일정 5개 — 각 "더 보기" 로 해당 탭.
- **테마·업종 탭**(같은 컴포넌트, `kind` 만 다름):
  - 컨트롤: 보기(목록/트리맵 — 테마 기본 목록, 업종 기본 트리맵), 기간 1·5·20일, 정렬(등락·거래대금), 트리맵 크기(시총·거래대금).
  - 목록 행: 순위, 이름, 평균 등락, 상승/하락 비율 막대, 대장주(이름·등락), `n일째 상위` 배지(streak ≥ 2), 거래대금.
  - 상세: lg 이상 오른쪽 스플릿, 미만은 그 자리 펼침. 헤더(1·5·20일·거래대금·시총), 60일 순위 추이 미니 차트, 구성 종목 표(대장주 배지·등락·거래대금·편입 사유). 종목 → `/screener/leaders?ticker=`.
- **트리맵**: `lib/treemap.ts` squarified 순수 함수(크기 배열·사각형 → 좌표). 색 = 상승 빨강·하락 파랑·보합 회색, 진하기 상한 1일 ±5%·5일 ±10%·20일 ±20%. 넓은 화면 = 그룹 안 종목 타일, 좁은 화면 = 그룹 타일만 → 누르면 그 그룹 종목 트리맵(뒤로 버튼). 테마 트리맵에 "종목이 여러 테마에 겹칠 수 있어요". 차트 라이브러리 추가 없음.
- **일정 탭**: 오늘~+60일 날짜별 목록, 카테고리 칩(전체·공모주·경제지표), 지난 7일 접기.
- 빈 상태: 계산 전 "시장 데이터를 준비하고 있어요(매일 장 마감 후 갱신)", 결과 0 안내, 일정 없음 안내.
- 비로그인 공개, 기존 토스 스타일 토큰. API 모듈 `api/market.ts`·타입 `types/market.ts` 로 UI 와 통신 분리.

## 5. 오류·빈 상태
- 지수 일부 없음 → 그 카드만 숨김. FRED 키 없음 → 거시 카드 숨김.
- 계산 태스크: 그룹·종목 단위 격리, 테마 PG 조회 실패 시 업종만 계산하고 실패 로그.
- 보정 재계산 전송 실패는 보정 응답에 영향 없음.

## 6. 테스트
- 순수 계산: 등락(봉 부족 NULL), 단순 평균(NULL 제외), 거래정지 제외, 대장주(상승 없음 폴백), 순위·3개 미만 제외, 숨김/제외 종목, 시총 NULL.
- 저장·조회: 가짜 CH, 로컬 CH 임시 DB 로 DDL·FINAL·숨김 덮어쓰기.
- 태스크: 기준일 결정·파이프라인 순서·백필 날짜 수·보정 시 send_task 호출(가짜).
- GraphQL: 필터·정렬·기간·화이트리스트·없는 그룹·달력 92일 자르기, **웹 쿼리 문자열 계약 테스트**(CANSLIM 과 같은 방식).
- 웹: `treemap.ts` 단위 테스트(면적 보존·경계 안·비율), tsc·빌드, 브라우저로 탭·트리맵·좁은 화면 확인. 기존 `/screener` 진입이 주도주 대신 시장 탭으로 바뀌는 것 외 CANSLIM 동작 동일.

## 7. 배포 후 확인 (pending_checks)
- 첫 계산 로그(종목·테마·업종 수), 테마 순위 상위가 그날 시장과 맞는지, `backfill_market_groups` 1회 실행.
- 오래된 KIS 테마(2025-11 이후 갱신 없음)가 상위에 끼는지 — 관리자 보정 UI 프로젝트의 우선순위 판단 자료.

## 8. 범위 밖
앱 화면, 관리자 테마 보정 UI(admin_web), 뉴스·AI 요약(네이버 키·Ollama), 장중 갱신, 미국 개별 종목, 달력 격자 보기.
