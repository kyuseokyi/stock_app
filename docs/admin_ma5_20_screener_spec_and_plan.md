# 관리자 전용 5·20일선 정배열 스크리너 기술 명세 및 구현 플랜

> **목적**: 매일 정규장 마감 후(20:30 KST 일일 파이프라인) 갱신되는 전 종목 일봉·지표 데이터(`screener_daily`)를 기반으로, **5일 이동평균선(MA5)과 20일 이동평균선(MA20)이 정배열(`MA5 > MA20`)인 종목**을 시가총액·거래대금·거래량·등락률 등으로 필터링해 볼 수 있는 **관리자 웹(`admin_web`) 전용 스크리너** 명세서 및 Claude Code 구현 로드맵입니다.
>
> **확장성 원칙**: 현재는 **관리자 페이지(`admin_web`)에서만 노출**하지만, 백엔드 API는 공용 GraphQL(`screenerScreen`)을 확장하여 구현하므로 추후 일반 웹(`web_client`)과 모바일 앱(`mobile`)에 노출할 때 백엔드 재작업 없이 프론트엔드 UI만 연결하면 즉시 확장됩니다.

---

## 0. 기존 시스템 분석 및 아키텍처 결정 사항

1. **ClickHouse 테이블 마이그레이션 불필요 (`screener_daily` 재활용)**
   - 현재 [`backend/apps/collector/repositories/clickhouse_screener.py`](../backend/apps/collector/repositories/clickhouse_screener.py)의 `screener_daily` 테이블은 매일 장 마감 후 파이프라인(`compute_screener`)에서 이미 아래 컬럼들을 모두 계산해 적재하고 있습니다:
     - `date` (기준일), `ticker`, `market` (`KOSPI` | `KOSDAQ`), `sector_m` (업종 코드)
     - `close` (종가), `chg_1d` (등락률 %), `volume` (당일 거래량), `value` (당일 거래대금 = `close * volume`), `mcap` (시가총액), `vol_ratio20` (20일 평균 대비 거래량 배수)
     - `ma5` (5일 이동평균), `ma20` (20일 이동평균), `ma50` (50일 이동평균), `ma60`, `ma120`, `ma_order` (4선 정배열 코드), `rsi14`, `vp_above_pct`, `liquid`
   - 따라서 **DB 스키마 변경이나 재수집/백필 없이**, 기존 `screener_daily` 데이터 위에서 즉시 `ma5 > ma20` 정배열 조회 및 필터링이 가능합니다.

2. **기존 `ma_order`와의 차이점 및 세분화**
   - 기존 `screener_daily.ma_order = 1`은 `MA5 > MA20 > MA50 > MA120` (4개 선 완전 정배열)만 통과시켜 단기 추세 전환 초입 종목이 누락됩니다.
   - 본 기능에서는 **단기 핵심 추세인 `MA5 > MA20` 정배열**을 기본 축으로 삼고, 실전 매매 타점에 맞춰 **4가지 배열 모드**를 제공합니다:
     1. **`MA5_20` (기본 — 5·20 정배열 전체)**: `round(ma5, 2) > round(ma20, 2)`
     2. **`CLOSE_MA5_20` (강세 유지 — 종가 ≥ 5일선 > 20일선)**: `close >= ma5 AND round(ma5, 2) > round(ma20, 2)`
     3. **`PULLBACK_MA5_20` (눌림목 — 5일선 > 종가 ≥ 20일선)**: `close < ma5 AND close >= ma20 AND round(ma5, 2) > round(ma20, 2)`
     4. **`PERFECT` (장단기 완전 정배열)**: 기존 `ma_order = 1` (`MA5 > MA20 > MA50 > MA120`)

3. **기존 기능 보존 (Regression Prevention)**
   - [`screener_query.py`](../backend/apps/stock_api/services/screener_query.py)와 GraphQL `screenerScreen`의 기존 인자·프리셋(`volume_surge`, `golden_cross`, `oversold`, `new_high`)·응답 필드는 100% 하위 호환을 유지합니다.
   - 사용자 웹/앱의 스크리너 탭 노출 여부는 기존 [`ScreenerSettings.tsx`](../admin_web/src/pages/ScreenerSettings.tsx)(`screener_features`) 스위치가 그대로 제어하므로, 이번 작업으로 일반 사용자 화면에는 아무런 변화가 발생하지 않습니다.

---

## 1. 백엔드 (`backend/apps/stock_api`) 확장 명세

### 1-1. `screener_query.py` 필터·프리셋·정렬 추가
파일 경로: [`backend/apps/stock_api/services/screener_query.py`](../backend/apps/stock_api/services/screener_query.py)

1. **프리셋(`PRESETS`) 추가**
   ```python
   PRESETS = {
       "ma5_20": "ma5 IS NOT NULL AND ma20 IS NOT NULL AND round(ma5, 2) > round(ma20, 2)",
       "volume_surge": f"vol_ratio20 >= {VOLUME_SURGE_RATIO}",
       "golden_cross": "gc_days IS NOT NULL",
       "oversold": f"rsi14 <= {OVERSOLD_RSI}",
       "new_high": "is_new_high = 1",
   }
   ```

2. **이동평균 배열(`ma_order`) 조건 확장**
   - 기존 `_MA_ORDERS = {"PERFECT": 1, "REVERSE": -1}` 외에 SQL 조건 맵 `_MA_ORDER_SQL`을 도입:
   ```python
   _MA_ORDER_SQL = {
       "PERFECT": "ma_order = 1",
       "REVERSE": "ma_order = -1",
       "MA5_20": "ma5 IS NOT NULL AND ma20 IS NOT NULL AND round(ma5, 2) > round(ma20, 2)",
       "CLOSE_MA5_20": "ma5 IS NOT NULL AND ma20 IS NOT NULL AND close >= ma5 AND round(ma5, 2) > round(ma20, 2)",
       "PULLBACK_MA5_20": "ma5 IS NOT NULL AND ma20 IS NOT NULL AND close < ma5 AND close >= ma20 AND round(ma5, 2) > round(ma20, 2)",
   }
   ```

3. **범위 필터(`_RANGES` 및 `_PAIRS`) 추가**
   | 필터 키 (`ScreenerFilterInput`) | 대상 CH 컬럼 / 수식 | 단위 및 배수 (`mult`) | 음수 허용 (`allow_negative`) | 설명 |
   | :--- | :--- | :--- | :---: | :--- |
   | `mcap_min`, `mcap_max` | `mcap` | 억 원 (`1e8`) | `False` | 시가총액 최소~최대 (기존 구현됨) |
   | `value_min`, `value_max` | `value` | 억 원 (`1e8`) | `False` | 거래대금 최소~최대 (`value_max` 신규 추가) |
   | `volume_min`, `volume_max` | `volume` | 만 주 (`1e4`) | `False` | 당일 거래량 최소~최대 (신규 추가, 만 주 단위) |
   | `vol_ratio_min` | `vol_ratio20` | 배 (`1`) | `False` | 20일 평균 거래량 대비 배수 (기존 구현됨) |
   | `chg_min`, `chg_max` | `chg_1d` | `%` (`1`) | **`True`** | 당일 등락률 최소~최대 (신규 추가, 음수 허용) |
   | `spread_5_20_min`, `spread_5_20_max` | `(ma5 - ma20) * 100 / ma20` | `%` (`1`) | **`True`** | 5·20일선 이격도(%) 범위 (`ma20 > 0` 가드 포함) |

   - `_PAIRS`에 `("value_min", "value_max")`, `("volume_min", "volume_max")`, `("chg_min", "chg_max")`, `("spread_5_20_min", "spread_5_20_max")`를 추가하여 `min > max` 입력 시 안전하게 무시하도록 처리합니다.

4. **정렬(`SORTS`) 추가**
   ```python
   SORTS = {
       "value": "value DESC, ticker",
       "volume": "volume DESC, ticker",
       "chg": "chg_1d DESC NULLS LAST, ticker",
       "vol_ratio": "vol_ratio20 DESC NULLS LAST, ticker",
       "mcap": "mcap DESC NULLS LAST, ticker",
       "spread_5_20": "(ma5 - ma20) / nullIf(ma20, 0) DESC NULLS LAST, ticker",
       "rsi": "rsi14 DESC NULLS LAST, ticker",
       "vp_above": "vp_above_pct ASC NULLS LAST, ticker",
   }
   ```

5. **조회 컬럼(`_SCREEN_COLUMNS`) 및 반환 아이템 확장**
   - `_SCREEN_COLUMNS`에 `"volume"`, `"ma5"`, `"ma50"`을 추가 (기존 `"ma20"`은 이미 포함됨).
   - 계산 헬퍼 `ma5_20_spread_pct(ma5, ma20)` 추가:
     ```python
     def ma5_20_spread_pct(ma5: float | None, ma20: float | None) -> float | None:
         if ma5 is None or ma20 is None or ma20 <= 0:
             return None
         return (ma5 - ma20) * 100 / ma20
     ```
   - 반환 dict에 `"volume"`, `"ma5"`, `"ma20"`, `"ma50"`, `"ma5_20_spread_pct"` 포함.

### 1-2. GraphQL 타입 확장 (`backend/apps/stock_api/graphql/types.py`)
- `ScreenerFilterInput`에 아래 선택(Optional) 필드 추가:
  ```python
  value_max: float | None = None        # 거래대금 최대(억 원)
  volume_min: float | None = None       # 당일 거래량 최소(만 주)
  volume_max: float | None = None       # 당일 거래량 최대(만 주)
  chg_min: float | None = None          # 당일 등락률 최소(%)
  chg_max: float | None = None          # 당일 등락률 최대(%)
  spread_5_20_min: float | None = None  # 5·20일선 이격도 최소(%)
  spread_5_20_max: float | None = None  # 5·20일선 이격도 최대(%)
  ```
- `ScreenerItem`에 아래 필드 추가:
  ```python
  volume: float                         # 당일 거래량(주)
  ma5: float | None                     # 5일 이동평균(원)
  ma20: float | None                    # 20일 이동평균(원)
  ma50: float | None                    # 50일 이동평균(원)
  ma5_20_spread_pct: float | None       # (MA5 - MA20) / MA20 × 100 (%)
  ```

---

## 2. 관리자 웹 (`admin_web`) UI 상세 명세

### 2-1. 라우트 및 사이드바 메뉴 추가
- **사이드바 ([`admin_web/src/components/Sidebar.tsx`](../admin_web/src/components/Sidebar.tsx))**:
  - `'시장 데이터'` 그룹 내에 `{ to: '/market/ma-screener', label: '5·20 정배열 스크리너', icon: '📈' }` 항목 추가 (`주도주` 바로 아래).
- **라우터 ([`admin_web/src/App.tsx`](../admin_web/src/App.tsx))**:
  - `<Route path="market/ma-screener" element={<MarketMaScreener />} />` 추가.
  - [`Layout.tsx`](../admin_web/src/components/Layout.tsx)의 `WIDE_PREFIXES`에 이미 `'/market/'`이 포함되어 있으므로 자동으로 `max-w-7xl` 2단 와이드 레이아웃이 적용됩니다.

### 2-2. 화면 레이아웃 및 기능 (`admin_web/src/pages/MarketMaScreener.tsx`)

1. **상단: 정규장 마감 데이터 갱신 상태 바 (`ScreenerDatasetStatus`)**
   - [`MarketLeaders.tsx`](../admin_web/src/pages/MarketLeaders.tsx)의 `CanslimStatus`와 동일하게 `getMarketStatus()`(`GET /api/v1/admin/market/status`)에서 `key === 'screener'` 데이터셋 상태를 조회해 표시합니다.
   - 기준일(예: `2026-11-03 종가 기준`), 계산된 종목 수(예: `2,640 종목`), 정상/지연 배지를 보여주며 우측에 `[수집 현황에서 재계산 →]` (`/market/status`) 버튼을 배치합니다.

2. **정배열 모드 탭/칩 (4종)**
   - 화면 진입 시 기본값은 **`MA5_20` (5·20일선 정배열 전체)**로 고정되어 즉시 정배열 종목이 조회됩니다.
   - 빠른 전환 칩:
     - `📈 5·20 정배열 전체 (MA5 > MA20)` *(기본)*
     - `🔥 5일선 위 강세 (종가 ≥ MA5 > MA20)`
     - `🎯 5·20 눌림목 (MA5 > 종가 ≥ MA20)`
     - `👑 4선 완전 정배열 (MA5 > 20 > 50 > 120)`

3. **핵심 필터 바 (즉시 적용 + 빠른 프리셋 버튼)**
   관리자가 숫자를 일일이 타이핑하지 않고도 원클릭으로 좁혀볼 수 있도록 **숫자 입력칸(최소~최대) + 빠른 칩**을 함께 배치합니다:
   - **시장**: `전체` | `KOSPI` | `KOSDAQ` + `유동성 필터(20일 평균 거래대금 10억·1,000원↑)` 체크박스
   - **시가총액 (억 원)**: `[최소] ~ [최대] 억` + 빠른 선택(`전체`, `500억↑`, `1,000억↑`, `3,000억↑`, `1조↑`)
   - **거래대금 (억 원)**: `[최소] ~ [최대] 억` + 빠른 선택(`전체`, `30억↑`, `100억↑`, `300억↑`, `1,000억↑`)
   - **거래량 (만 주 & 20일 평균 대비)**:
     - 당일 거래량 `[최소] ~ [최대] 만 주`
     - 20일 평균 대비 `[전체 | 1.5배↑ | 2배↑ | 3배↑]`
   - **등락률 (%)**: `[최소] ~ [최대] %` + 빠른 선택(`전체`, `양봉(0%↑)`, `+3% ~ +15%`, `보합·소폭(-2% ~ +5%)`)
   - **5·20 이격도 (%)**: `[최소] ~ [최대] %` + 빠른 선택(`전체`, `초입(0~3%)`, `추세(3~10%)`)

4. **정렬 및 결과 목록 + 우측 일봉 차트 스플릿 뷰**
   - **정렬 칩**: `거래대금순(기본)` | `등락률순` | `거래량순` | `거래량급증(20일비)순` | `시가총액순` | `5·20 이격도순`
   - **좌측 종목 리스트**:
     - 종목명 · 티커 · 시장 · 업종명
     - 종가 · **등락률(상승 빨강 / 하락 파랑)**
     - **MA5 / MA20 가격 및 이격도(`+2.4%`) 배지** (종가가 MA5 위면 `5일선 위`, MA5~MA20 사이면 `눌림목` 배지 표시)
     - **거래대금(억)** · **거래량(만 주 · 20일 평균 대비 `2.3x`)** · **시가총액(억/조)**
   - **우측 상세 패널 (와이드 화면 Sticky / 모바일 인라인 펼침)**:
     - 선택된 종목의 [`StockDailyChart`](../admin_web/src/leaders/components/screener/StockDailyChart.tsx) 렌더링.
     - **`StockDailyChart.tsx` 개선 (`showMa5Ma20?: boolean` prop 추가)**:
       - 기존 호출부(`CanslimDetail` 등)는 건드리지 않고, `showMa5Ma20={true}`일 때만 차트에 **5일선(`#10b981` 에메랄드/청록)**과 **20일선(`#ec4899` 분홍)** 라인 시리즈 및 상단 범례를 추가로 그려 5·20일선 정배열 및 골든크로스 지점을 눈으로 즉시 확인할 수 있게 합니다.
     - 우측 패널 하단에 핵심 수치 요약표(시가총액, 거래대금, 거래량, 20일 거래량비, MA5, MA20, MA50, 5·20 이격도, RSI14, 매물대 비율, PER/PBR/ROE)와 `[데이터 검증 화면에서 열기 →]`(`/market/verify?ticker=...`) 링크를 제공합니다.

---

## 3. 향후 일반 웹(`web_client`) 및 모바일(`mobile`) 확장 설계

추후 관리자 검증이 끝나고 일반 유저에게도 공개하고 싶을 때는 아래 작업만으로 즉시 오픈할 수 있습니다:
1. `web_client/src/lib/finder.ts` 및 `mobile/src/features/screener/finder-types.ts`의 프리셋 상수에 `{ key: 'ma5_20', label: '5·20일선 정배열', description: '단기 추세(5일선)가 중기 추세(20일선) 위에 있는 종목' }` 추가.
2. `FinderFilters` 컴포넌트에 등락률(`chgMin/Max`)·거래량(`volumeMin/Max`) 입력 줄 추가.
3. 관리자 웹 [`/market/screener`](../admin_web/src/pages/ScreenerSettings.tsx)에서 **`조건검색 탭(FINDER)` 스위치 ON** 전환.

---

## 4. 단계별 구현 로드맵 (Claude Code 작업 플랜)

Claude Code에서 아래 Micro-Step 순서대로 구현 및 테스트를 진행합니다.

### 📍 Step 1: 백엔드 `screener_query.py` 및 GraphQL 스키마 확장 + 단위 테스트
- [ ] [`backend/apps/stock_api/services/screener_query.py`](../backend/apps/stock_api/services/screener_query.py)에 `PRESETS["ma5_20"]`, `_MA_ORDER_SQL`(`MA5_20`, `CLOSE_MA5_20`, `PULLBACK_MA5_20`), `_RANGES`(`value_max`, `volume_min/max`, `chg_min/max`, `spread_5_20_min/max`), `SORTS`(`volume`, `spread_5_20`), 반환 필드(`volume`, `ma5`, `ma20`, `ma50`, `ma5_20_spread_pct`) 추가.
- [ ] [`backend/apps/stock_api/graphql/types.py`](../backend/apps/stock_api/graphql/types.py)의 `ScreenerFilterInput`, `ScreenerItem`에 신규 필드 반영.
- [ ] `backend/tests/` 내 스크리너 쿼리 단위 테스트 및 GraphQL 계약 테스트 추가 후 `uv run pytest` 통과 확인.

### 📍 Step 2: 관리자 웹 `StockDailyChart` 5일·20일선 표시 옵션 추가
- [ ] [`admin_web/src/leaders/components/screener/StockDailyChart.tsx`](../admin_web/src/leaders/components/screener/StockDailyChart.tsx)에 선택적 prop `showMa5Ma20?: boolean`을 추가하여 활성화 시 `sma(closes, 5)`와 `sma(closes, 20)` 라인 시리즈 및 범례(`5일선`, `20일선`)를 렌더링하도록 확장 (기본값 `false`로 기존 화면 영향 0%).

### 📍 Step 3: 관리자 웹 `MarketMaScreener` 페이지 및 라우트·사이드바 구현
- [ ] `admin_web/src/api/maScreener.ts` (GraphQL `screenerScreen` 호출 클라이언트 및 타입 정의) 생성.
- [ ] `admin_web/src/pages/MarketMaScreener.tsx` 구현:
  - 상단 `screener` 데이터셋 갱신 현황 카드
  - 정배열 모드 칩 4종 (`MA5_20`, `CLOSE_MA5_20`, `PULLBACK_MA5_20`, `PERFECT`)
  - 시가총액·거래대금·거래량·등락률·이격도 필터 패널 + 원클릭 빠른 칩
  - 좌측 종목 목록 + 우측 `StockDailyChart (showMa5Ma20)` 스플릿 뷰
- [ ] [`admin_web/src/components/Sidebar.tsx`](../admin_web/src/components/Sidebar.tsx) 및 [`admin_web/src/App.tsx`](../admin_web/src/App.tsx)에 `/market/ma-screener` 연결.
- [ ] `cd admin_web && npm run build` (`tsc --noEmit` 포함) 및 `npm run lint` 통과 검증.

---

## 5. Claude Code 실행용 프롬프트 템플릿

Claude Code에 아래 명령어를 그대로 입력하면 Step 1부터 Step 3까지 순차적으로 구현 및 검증을 완료합니다:

```text
docs/admin_ma5_20_screener_spec_and_plan.md 문서를 읽고, Step 1부터 Step 3까지 순서대로 Micro-Step 단위로 구현해줘.
기존 기능(Regression Prevention)에 영향이 없도록 하위 호환성을 유지하고, 각 Step 완료 시 백엔드 pytest 및 admin_web의 tsc --noEmit / build 검증을 실행한 뒤 한국어로 보고해줘.
```
