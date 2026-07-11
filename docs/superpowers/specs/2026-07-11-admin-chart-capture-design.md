# 어드민 차트 캡처 고도화 설계 (종목 검색 + 기간 설정)

- 작성일: 2026-07-11
- 관련 문서: `docs/prompts/04_admin_web.md`(5단계 핵심), `docs/prompts/06_stock_api.md`

## 배경 / 목표
기존 어드민 TipTap 에디터의 '차트 삽입'은 모의 OHLCV를 즉석 렌더링만 했다.
이를 고도화해 **국내외 종목·주요 지수를 검색**하고, **조회 기간(시작/종료일)** 을 지정하면
해당 차트를 렌더링한 뒤 이미지로 캡처해 본문에 삽입한다.

## 핵심 결정
- **API 방식**: Strawberry **GraphQL** (`06_stock_api.md` 스펙 준수, mobile의 graphql-request와 일관)
- **데이터 소스**: **온더플라이(on-the-fly) 시드 데이터** — DB 저장 없이 요청 시점에 결정적 생성
  - ClickHouse/Postgres 마이그레이션 **불필요**. 실데이터(KIS/ClickHouse) 전환은 생성 함수 교체로 대응
- **종목 카탈로그**: `stock_api` **인메모리** 목록 (Postgres `StockMeta` 미사용)

## A. stock_api 백엔드 (포트 8002)
디렉토리: `backend/apps/stock_api/`
- `seed_catalog.py` — 인메모리 종목/지수 목록
  - 국내 주식(~15), 미국 주식(~15), 주요 지수(~6). 필드: `symbol, name, market, country, currency`
  - `market` 예: `KOSPI/KOSDAQ/NASDAQ/NYSE/INDEX`
- `services/chart.py` — 온더플라이 OHLCV 생성
  - `symbol + date` 해시를 시드로 결정적 랜덤워크 → 같은 입력이면 항상 동일 결과
  - candle: `date, open, high, low, close, volume` + MA5/MA20 계산 제공
- `graphql/` (types.py, schema.py)
  - `searchStocks(query: String!): [Stock!]!` — 이름/심볼 부분일치, 국내+해외+지수 통합
  - `getChartData(symbol: String!, startDate: String!, endDate: String!): ChartData!`
    - `candles: [Candle!]!`, 선택적 지표(`ma5, ma20`)
  - Strawberry `GraphQLRouter` 를 FastAPI `/graphql` 에 마운트
- 의존성: `strawberry-graphql`
- CORS: 기존 5173/3000 허용 유지

## B. admin_web ChartSnapshotModal 고도화
- `src/api/stockClient.js` — `graphql-request` GraphQLClient (`VITE_STOCK_API_URL`, 기본 `http://localhost:8002/graphql`)
- 모달 UX 3단계
  1. 검색창(debounce) → `searchStocks` → 결과 리스트(종목명·심볼·시장 배지)
  2. 종목 선택 + 기간(시작/종료일, 기본 최근 3개월)
  3. `getChartData` → ECharts 캔들+MA 렌더 → 기존 `getDataURL()` 캡처 → 본문 `<img>` 삽입(로직 재사용)
  - 로딩/에러/빈결과 처리, 기존 모의데이터 생성부 제거

## C. 환경변수 · 문서
- `VITE_STOCK_API_URL` 추가, README 갱신
- 기능 단위 자동 커밋(백엔드 / 프론트 분리)

## 데이터 흐름
```
에디터 [차트 삽입] → 검색모달 → GraphQL searchStocks (8002)
  → 종목선택 + 기간 → getChartData (8002, 온더플라이 생성)
  → ECharts 렌더 → getDataURL() → TipTap <img> 삽입
```

## 비범위 (이후 단계)
- KIS OpenAPI 실연동 / ClickHouse 적재 / 수집 파이프라인
- 지표 확대(RSI, 볼린저 등), 종목 마스터의 Postgres 영속화
