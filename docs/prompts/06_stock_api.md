# 6. 주식 데이터 제공 마이크로서비스 (Stock API)

당신의 임무는 앱 및 웹(어드민 포함) 클라이언트에 주식 차트 데이터와 종목 검색 기능을 제공하는 `stock_api` 백엔드 서버를 구축하는 것입니다.

### 🟢 1단계: Backend Stock API 기본 셋업
1. `backend/apps/stock_api/` 디렉토리에 주식 정보 제공을 위한 독립 FastAPI 서버를 구축하세요. (`main.py`, `routers/`, `schemas.py`, `services.py`)
2. 데이터베이스 접근은 ClickHouse(`daily_prices`)와 PostgreSQL(종목 메타데이터)을 동시에 사용해야 할 수 있으므로, 적절한 DB Connection 로직을 작성하세요.

### 🔍 2단계: 글로벌 종목 및 지수 통합 검색 API
어드민 웹의 '차트 삽입' 기능 및 클라이언트 앱에서 사용할 수 있도록 아래 검색 API를 구현하세요.
1. **검색 엔드포인트** (`GET /api/v1/stocks/search?q={query}`):
   - 검색어(`query`)를 기반으로 **국내 주식, 해외(미국 등) 주식, 그리고 나라별 주요 지수(KOSPI, S&P500, NASDAQ 등)**를 모두 통합 검색하여 리턴하세요.
2. **차트 데이터 엔드포인트** (`GET /api/v1/stocks/{symbol}/chart?start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}`):
   - 클라이언트에서 요청한 특정 종목(`symbol`) 혹은 지수의 데이터를 ClickHouse에서 조회하세요.
   - 요청받은 **조회 기간(start_date ~ end_date)** 범위 내의 OHLCV 일봉 데이터 및 관련 지표를 JSON 배열 형태로 응답해야 합니다.

### 📈 3단계: 한국투자증권 실시간/과거 데이터 연계
- 만약 ClickHouse에 저장되지 않은 과거 데이터나 지수 데이터가 필요하다면, 파이프라인에서 작성했던 **자체 Custom API Client** (`requests` 기반) 로직을 재사용하여 한국투자증권 OpenAPI에서 데이터를 실시간 페칭(Fetching)한 뒤 응답하는 Fallback 로직을 구현하세요.
