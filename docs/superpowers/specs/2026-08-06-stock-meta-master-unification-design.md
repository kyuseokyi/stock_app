# stock_meta 종목 마스터 일원화

- 작성일: 2026-08-06
- 관련: `docs/ROADMAP.md`(Phase 1-b, Phase 2 스크리너 전제), 메모리 `kis-market-code-un-nxt`

## 배경 / 문제
종목 마스터가 세 곳에 흩어져 있다:
- `stock_meta`(Postgres, `shared/models.py`): 정의만 있고 **미사용**.
- `seed_catalog`(stock_api): 하드코딩 36종목(국내15+미국+지수) → `searchStocks`·차트 종목해석.
- `.mst`(collector, `stock_master.load_domestic_tickers`): KRX 전종목 → 수집 루프.

→ 국내 종목 정보의 **단일 출처(Single Source of Truth)** 를 `stock_meta`로 일원화한다.

## 범위 결정
- **국내 전용(A)**: `stock_meta` = KRX 전종목(.mst 적재). 미국/지수는 아직 실데이터 없음(온더플라이) → 이번 범위 밖.
- **미국/지수는 하이브리드 유지(A-2)**: `searchStocks`·차트에서 미국/지수는 `seed_catalog` 그대로 사용(회귀 방지). Phase 1-b 해외 연동 시 마스터+시세 함께 교체.
- 미국 종목마스터(`nasmst/nysmst/amsmst.cod`)는 존재하지만, 시세 수집이 별개 작업이라 지금은 도입하지 않음.

## 데이터 흐름
```
KRX .mst (매 수집 시 다운로드)
   │ sync_master: upsert(active) + .mst에 없는 기존종목 is_active=false(상폐)
   ▼
stock_meta (Postgres, 단일 국내 마스터)
   ├── collector : is_active=true KR → 수집 대상
   └── stock_api : stock_meta(KR) 검색·해석 + seed(미국/지수) 병합
```

## 컴포넌트

### ① 스키마 — 변경 없음
`StockMeta(ticker PK, name, market=MarketType{KOSPI,KOSDAQ}, is_active, created/updated)` 가 `.mst`(KR) 를 그대로 수용. 국내는 country=KR/currency=KRW 상수 처리 → **마이그레이션 불필요**.

### ② 공용 리포지토리 `shared/stock_meta_repo.py` (신규, 동기 세션)
- `sync_master(session, rows: list[(ticker,name,market)]) -> dict` — upsert(active) + 누락분 is_active=false. 멱등. 반환 {upserted, deactivated, active_total}.
- `list_active(session) -> list[(ticker,name,market)]` — 수집 대상(collector).
- `search_active(session, query, limit=20) -> list[StockMeta]` — 이름/코드 부분일치(stock_api).
- `get_active(session, ticker) -> StockMeta | None` — 단건(차트 해석).

동기 세션(`SyncSessionLocal`)을 쓴다. stock_api는 이미 ClickHouse를 동기(clickhouse_connect)로 접근하므로 일관적이며, GraphQL 리졸버를 async로 재구성할 필요가 없다.

### ③ collector 변경
- `stock_master.load_domestic_tickers()`: `.mst` 직접 로드 → **stock_meta에서 로드**(비면 .mst 동기화 후 로드, self-healing). `fallback` 정적리스트 유지.
- `collect_all_daily`/`backfill_all_daily` 시작 시 `.mst`→`sync_master` 1회(신규상장/상폐 반영).

### ④ stock_api 변경
- `searchStocks`: `search_active`(KR) + `seed_catalog.search`(미국/지수) 병합, 중복 제거.
- `resolve_stock`(차트): `get_active`(KR) 우선 → 없으면 `seed_catalog.get_by_symbol`(미국/지수).
- 국내 결과는 country=KR/currency=KRW 로 매핑.

## 회귀 방지 (Regression Prevention)
- 미국/지수 검색·차트 그대로 동작(seed 유지).
- stock_meta 최초 비었을 때 자동 .mst 동기화 → 검색/수집 깨지지 않음.
- ClickHouse 하이브리드(수집종목=실데이터, 그 외=온더플라이) 경로 유지.

## 검증(완료 기준)
1. `sync_master` 멱등: 2회 실행 시 active_total 동일, 상폐 종목 is_active=false.
2. `collect_all_daily` 후 stock_meta에 KRX 종목 적재(수천 건), 수집은 stock_meta 기준 동작.
3. `searchStocks("삼성")` → stock_meta(전종목), `searchStocks("애플")` → seed. 둘 다 반환.
4. `getChartData` 국내(005930 CH 실데이터)·미국(AAPL 온더플라이) 정상.

## 비범위 (다음)
- 미국/지수 마스터(.cod) + 해외 시세 수집(Phase 1-b 해외).
- ETF/펀드/스팩 필터링(현재는 .mst 전량 적재).
- searchStocks 랭킹/정렬 고도화.
