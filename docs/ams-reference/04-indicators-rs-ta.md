# 04. 지표 / RS / TA — 계산 로직과 확장 로드맵

← [인덱스](00-index.md) · 관련: [05-clickhouse-data-layer.md](05-clickhouse-data-layer.md), [06-screener.md](06-screener.md)

> stock_app은 현재 MA/BB/RSI/MACD(고전 오버레이/오실레이터)만 계산한다. AMS는 **상대강도(RS) + 베이스 단계 스크리너**(Minervini/CANSLIM) 패러다임이다. 이 문서는 그쪽으로 확장하는 로드맵이다.

## 0. 아키텍처 원칙 (그대로 채택)

AMS는 두 종류의 계산을 분리한다:
- **종목별 pandas TA** (심볼 단위, 이식성 높음) — SMA·RS라인·ATR·수익률 등
- **모집단 전체 랭킹은 DB 윈도우 함수** (날짜별 전 종목 대상) — RS Rating, 산업/섹터 순위

→ **핵심 교훈**: RS *Rating*·산업/섹터 순위는 본질적으로 **횡단면(cross-sectional)** 이다. 심볼별 Python이 아니라 **날짜로 파티션한 SQL 윈도우 함수**로 전 종목 테이블에 대해 계산하라. 템플릿: `ntile(99) OVER (PARTITION BY country, date ORDER BY score, id)`. Postgres/ClickHouse 모두 동일하게 동작.

## 1. SMA (이동평균)

- **가격 SMA**: `10, 21, 50, 150, 200` / **거래량 VSMA**: `5, 50`
- **완결성 게이트** ⭐: 윈도우가 다 차야만 값을 낸다 (200-SMA는 200행 있어야 계산, 부분 평균 없음):
  ```sql
  CASE WHEN COUNT(close) OVER (... ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) = 200
       THEN ROUND(AVG(close) OVER (...), 2) ELSE NULL END
  ```
- **저장**: `stock_sma_daily`를 **long 레이아웃**으로 — `(stock_id, date, interval_days, value_type)` (PRICE/VOLUME 구분). 기간별 wide 컬럼이 아님.
- stock_app 참고: 150·200 SMA가 Minervini Trend Template의 핵심. 기존 MA 인프라에 기간만 추가.

## 2. ⭐ RS Score & Rating — 핵심 차별점

### RS Score (시장 대비 모멘텀 비율)
두 방식이 공존:

**(a) 레거시 가중 RS** (`stock_rs_daily`) — 5개 구간(12m/6m/3m/1m/9m) 가중, **시장 상대**:
```
rs_score = (stock_1d/stock_1y)/(index_1d/index_1y)*w1   # 12m
         + (stock_1d/stock_6m)/(index_1d/index_6m)*w2   # 6m
         + (stock_1d/stock_3m)/(index_1d/index_3m)*w3   # 3m
         + (stock_1d/stock_1m)/(index_1d/index_1m)*w4   # 1m
         + (stock_1d/stock_9m)/(index_1d/index_9m)*w5   # 9m
```
각 항 = (종목 수익률)/(지수 수익률) = 시장 상대 강도. 가중치는 `rs_weight_set` 테이블.

**(b) 분기 가중 RS(IBD식)** (`stock_rs_daily_qtr_weighted`) — **가격만(지수 나눗셈 없음)**, 최근 분기 2배 가중:
```
rs_score = (c/3m)*0.4 + (3m/6m)*0.2 + (6m/9m)*0.2 + (9m/1y)*0.2
```
→ **stock_app 시작점 추천**: (b)가 지수 불필요·CANSLIM 표준이라 도입이 쉽다.

### 참조일 사전계산 (`rs_ref_date_stock2`)
캘린더 오프셋(1d/1m/3m/6m/9m/1y)을 **실제 거래일**로 미리 변환해 저장 → score 쿼리가 join만 하면 됨. 1d는 과거로(`&lt;=`), 나머지는 가장 가까운 미래 거래일(`&gt;=`). (ta.md의 "가장 가까운 미래 날짜" 규칙과 일치)

### RS Rating (1~99) — 백분위
날짜×그룹 파티션에서 `rs_score`를 1~99로 랭크. **이중 방식**:
- 그룹 ≥99개 → `NTILE(99) OVER (PARTITION BY date, country_code ORDER BY rs_score, stock_id)`
- 그룹 &lt;99개 → `ROUND(1 + PERCENT_RANK() * 98)` (소그룹 NTILE 왜곡 방지)

국가/산업/섹터 각각에 대해 산출(`rs_rating_in_country/industry/sector`). 헤드라인은 country.

### 산업/섹터 RS
- `industry_rs_daily`: 산업별 `avg_rs_score` + **breadth 트리오**(`rs_90_count`=RS≥90 종목수, `rs_90_ratio`, `rs_90_avg_rs`), 그 후 국가 내 랭크.
- `sector_rs_daily`: 섹터별 평균 후 랭크.

## 3. 종목별 TA 컬럼 (카테고리별)

행 의미: 각 행의 "price"=`close`, `date = 거래일 + 1일`(계산일), 비거래일은 최대 30일 carry-forward.

**A. 위치/52주/ATH** — `price_52w_high/low`(+date), `is_new_52w_high`, `vs_52w_high`(52주고가 대비 %), `days_since_52wh`, `ath_price/date`, `is_new_ath`, `cr_daily`/`cr_weekly`(종가 위치 = (close−low)/(high−low)×100)
**B. 모멘텀** — `price_change`, `change_pct`, `change_pct_diff`(가속도), `change_1w/1m/3m/6m/12m/ytd_pct`, `high_low_1w/2w/3w/4w/8w_pct`(N주 저점 대비 런업 = HP 입력)
**C. RS 라인** — `rs_line`(=close/index_close), `rs_line_52w_high/low`, `rs_line_proximity`(52주고가 근접도, 신고가 선행신호), `is_rs_line_new_high/low`, `rs_score_1m/3m/6m/12m`(구간별), `rs_vs_index_*`
**D. 이평 위치** — `sma10/21/50/150/200`, `vs_smaN`(=(close−smaN)/smaN×100)
**E. 변동성** — `tr`(True Range %), `atr5/10/21/30/50`
**F. 거래량** — `vol_sma5/50`, `day_vs_vsma50`, `week_vs_vwsma10`
**G. 캔들/분산** — `dn_candle_cnt_5d`, `bad_dn_cnt_5d`(고거래량 하락일=분산일)
**H. 펀더멘털** — `eps_yoy`, `sales_yoy`, `eps_qoq`(EPS Rating용), `eps_cagr`(2년: `(eps_3y/eps_5y)^(1/2)−1`×100)

(공식 상세는 AMS `docs/ta.md` 참고 — 52주고가 대비, 각 기간 수익률, RS Line/Rating, ATR, EPS Rating 등 24항목)

## 4. ClickHouse 싱크 시점 레이팅 재계산

랭킹은 **스냅샷 날짜별 전 종목** 대상이라(임의 과거일 스크리닝/백테스트), ClickHouse에서 `PARTITION BY (country_code, date)` 윈도우로 재계산: `rs_rating*`, `eps_qoq_rating`, `eps_cagr_rating`, `eps_rating`, `industry/sector_rs_rating`, `industry_rs_rank`. **전체 행 재삽입**(ReplacingMergeTree 전체행 대체 안전). 헤드라인 `rs_rating`은 MySQL 권위값을 직접 가져와 GraphQL과 일치시킴. ClickHouse엔 `percent_rank()`가 없어 `(rank−1)/(n−1)` 수동 계산 + `round()`(banker's)로 DuckDB와 일치.

## 5. 차트 패턴 & HP (고난도, 후순위)

- **패턴**(`chart_pattern/`): cup / cup_with_handle / double_bottom(W) / flat_base / htf / ascending_base / consolidation. 핵심 엔진 `consolidation.py`의 `find_base`(~600줄 튜닝 휴리스틱: ATR 스케일 프로미넌스, 포물선 R² 적합, SMA50 추세 게이트). 출력 `{kind, hp_price, base_price, depth%, pivot_price, confidence, is_active}`. 베이스 단계(1st/2nd/3rd) 카운팅 → `stock_pattern_daily`.
- **HP(High Point)**: 최근 런업의 고점 앵커. 런업 조건 `high_low_8w_pct>=100 OR high_low_4w_pct>=30`(O'Neil 선행상승 게이트), gaps-and-islands로 최근 런 고점 앵커링. `vs_runup_hp`, `max_drawdown_runup`, `days_since_runup`. 52wh/ath 고정앵커 버전도 존재.
- **VCP**(Minervini 변동성 수축): VCP-A = 최근 N일 매일 거래량 ≤ 50일 거래량SMA(dry-up), VCP-B = 단기/장기 거래량SMA 비율.

## 6. ⭐ stock_app 확장 로드맵 (우선순위)

**Tier 0 — 토대 (먼저)**
1. SMA 10/21/50/150/200 + 거래량 50/10w (기존 MA 인프라에 기간 추가)
2. **종목별 벤치마크 지수 시계열** — RS의 필수 입력. 지수 join 없으면 RS 불가 (가장 큰 결핍)

**Tier 1 — RS 엔진 (핵심 차별점)**
3. `rs_line`(=close/index) + 52w고저 + `rs_line_proximity` + 신고가 플래그 (저비용·고신호, 순수 pandas)
4. 구간별 RS + **분기가중 블렌드**(`0.4·(c/3m)+0.2·(3m/6m)+0.2·(6m/9m)+0.2·(9m/1y)`, 지수 불필요)
5. **RS Rating 1~99** — 날짜별 전 종목 percentile (NTILE99 / 소그룹 percent_rank). CANSLIM "RS≥80" 게이트

**Tier 2 — 위치/추세 템플릿**
6. 52주 고가 + `price_vs_52w_high_pct` + `vs_smaN` (Minervini 8점 Trend Template)
7. `cr_daily/cr_weekly` + `tr`/`atr` (진입 품질/변동성 사이징)

**Tier 3 — 수급/펀더멘털**
8. 거래량 vs VSMA + 분산일 카운트(`bad_dn_cnt_5d`)
9. EPS QoQ/YoY/CAGR + EPS Rating (CANSLIM의 C·A, 펀더멘털 필요 → [05](05-clickhouse-data-layer.md))

**Tier 4 — 산업/섹터 RS & 베이스 (고급)**
10. 산업/섹터 RS (구성종목 평균 후 랭크, 산업 분류 체계 필요)
11. 런업 HP + 베이스/피벗 탐지 + VCP (최고 난도, 돌파 스크리닝 원할 때만. VCP-A가 가성비 최고)

**MVP 스크리너 최소셋**: SMA 50/150/200 + 52주고가 거리(Trend Template) + RS Rating 1~99 + EPS Rating. → 항목 1~6 + 9면 동작하는 스크리너.
