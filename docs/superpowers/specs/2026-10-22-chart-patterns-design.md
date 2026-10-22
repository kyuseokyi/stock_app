# 차트 패턴(베이스·피벗·돌파) 설계

- 작성: 2026-10-22 · 상태: 승인(사용자 "다음진행" + 일봉 3년 확장 선택. 아래 결정은 참고 코드·문서 조사로 정함)
- 근거: ROADMAP Phase 2 "차트 패턴(컵·컵핸들·쌍바닥·플랫 베이스·HTF)·베이스 카운트·돌파 리포트", 참고 엔진 `ams/workspace/api/app/services/chart_pattern/`(v2, MarketSurge 화면에 맞춘 기준값)
- 선행: 조건검색 설계 `2026-10-21-screener-presets-design.md`(사전 계산·조회·탭 구조를 그대로 따름)

## 1. 목표와 범위

매일 장 마감 후 분석 대상 보통주(~2,664)의 일봉에서 **베이스 패턴**을 찾아 피벗(매수점)·깊이·길이·단계(베이스 카운트)·돌파 여부를 저장하고, 웹 스크리너 **'패턴' 탭**과 앱 **'패턴' 칩**에서 리포트(오늘 돌파·최근 돌파·피벗 근접·형성 중)로 보여 준다.

**범위**: 엔진 이식(일봉), 결과 테이블 `chart_pattern_daily` + 계산 단계(매일 파이프라인·관리자 수동 실행), GraphQL `patternScreen`·`patternBases`, 웹 탭(목록 + 차트에 피벗·매수/손절 구간·꼭짓점 표시), 앱 칩(목록) + 종목 상세 '차트 패턴' 영역, 문서.
**범위 밖**: 주봉 패턴(주봉 테이블 없음 — 일봉 리샘플은 다음), Ascending Base(참고 엔진에서도 미등록), 패턴 알림, 과거 날짜 백필(리포트는 최신 스냅샷만으로 계산됨), 앱 차트 꼭짓점 마커.

## 2. 결정 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 엔진 | 참고 v2 감지 로직을 **그대로 이식**(기준값 포함), 데이터 입출력만 교체 | 감지기는 `List[OHLCV]` 만 받는 순수 로직. MS 화면과 맞춘 값을 임의로 바꾸면 근거가 사라짐 |
| 패턴 | 컵(cup)·컵핸들(cup_with_handle)·쌍바닥(double_bottom)·플랫 베이스(flat_base)·박스권(consolidation)·하이 타이트 플래그(htf) | 참고 엔진 등록 목록과 같음 |
| 시간 단위 | **일봉만** | 주봉 원천 없음. 리샘플 정확도(휴장 주) 검증은 별도 |
| 봉 수 | 종목당 최근 **770봉**(표시 520 + 앞쪽 여유 250). 일봉을 37개월로 백필(사용자 실행) | 표시 구간 앞에서 시작한 베이스의 왼쪽 고점이 잘리지 않게(참고 fetcher 근거) |
| 돌파 | 피벗 이후 첫 **고가 > 피벗** 봉. 림부터 최대 길이(250봉)를 넘긴 돌파는 무효 | 참고 엔진 그대로(거래량 조건 없음 — 돌파 거래량은 지표로만 표시) |
| 단계 | `count(sub)(total)`·라벨(`1`, `2`, `1a`…). 피벗 상승 20% 미만이면 베이스 위 베이스(sub+1), 이상이면 단계+1, 저점이 직전 저점보다 낮거나 경로가 직전 저점 −10% 를 깨면 1 로 리셋 | 참고 base_count 그대로 |
| 대상 | `market_repo.analysis_universe`(보통주) | CANSLIM·조건검색과 같은 범위 |
| 저장 | 새 테이블 `chart_pattern_daily` — 기준일(as_of)마다 그날 보이는 베이스 전부 | 참고 '모델 A'(스냅샷). 리포트는 최신 스냅샷만 씀 |
| 과거 백필 | 하지 않음. 최신일 계산만(관리자 수동 실행 + 매일 파이프라인) | 리포트·차트가 최신 스냅샷만 필요. 날짜마다 770봉 재감지는 비용이 큼 |
| 매매 구간 | 매수 = 피벗 ×1.00~1.05, 손절 = ×0.92~0.95, 돌파 후 고가 > 피벗×1.45 또는 저가 < 피벗×0.80 이면 숨김(현재 베이스만) | 참고 resolver 규칙 |
| 기준값 시장 | 미국 종목으로 맞춘 값을 국내에 그대로 적용 — 알려진 한계로 문서화 | 국내 보정 근거 없음. 실데이터 분포를 보고 다음에 조정 |

## 3. 엔진 이식

위치 `backend/apps/collector/patterns/`(순수, numpy·pandas):
- `constants.py`(D 기준: min_len 25·max_len 250·win 5·k 2.25), `utils.py`(ms_base_length 등), `swing.py`(참고 base_finder 중 엔진이 쓰는 `_atr`·`_swing_high_idxs`·`_prominent_swing_highs` 만), `detector.py`(`detect(bars) -> list[Base]`: 전 구간 스캔·순위·병합·흡수·겹침 제거·형성 중 하나만), `base_count.py`, `kinds/{cup,cup_with_handle,double_bottom,flat_base,consolidation,htf}.py`.
- 입력: `[(date, open, high, low, close, volume)]` 오름차순. 출력 `Base`: pattern_type, rim_date, low_date, low_price, pivot, depth, length, is_active, breakout_date, breakout_price_pct, breakout_vol_pct, days_since_breakout, base_count, subcount, totalcount, label, prior_uptrend_pct, confidence, points[{role,date,price}].
- 참고 코드의 사내 의존(ORM·로거·`normalize_df`)은 제거하고 같은 동작을 직접 둔다. 미사용 코드(`find_last_base`, ascending_base)는 옮기지 않는다.
- HTF 의 "하루 종가 변동 50% 초과 제외"(수정주가 미반영 보호)는 유지 — 국내 일봉은 KIS 수정주가(분할·병합 반영)지만 안전장치로 둔다.

## 4. 데이터

### 4.1 `chart_pattern_daily` (ClickHouse)
`ReplacingMergeTree(ingested_at)`, `PARTITION BY toYYYYMM(date)`, `ORDER BY (date, ticker, rim_date)`. 조회는 `FINAL`.
컬럼: `date`(기준일), `ticker`, `market`, `pattern_type`, `rim_date`, `low_date`, `low_price`, `pivot`, `depth`, `length`, `is_active`(UInt8), `is_current`(UInt8: 그 종목의 가장 최근 베이스), `breakout_date`(Nullable), `breakout_price_pct`, `breakout_vol_pct`, `days_since_breakout`(Nullable Int32), `base_count`, `subcount`, `totalcount`, `label`, `prior_uptrend_pct`, `confidence`, `points`(String JSON), `close`(기준일 종가), `ingested_at`.
- 같은 기준일을 다시 계산하면 그 날짜 행을 먼저 지운 뒤 넣는다(경량 `DELETE FROM … WHERE date = d`) — 다시 계산해서 사라진 베이스가 남지 않게. ReplacingMergeTree 만으로는 사라진 행을 지울 수 없다.

### 4.2 계산 단계
- `repositories/clickhouse_patterns.py`: 봉 로드(open 포함, 종목별 최근 770봉 — `load_bars(as_of, bars=770, tickers)`), DDL, 기준일 삭제 후 적재.
- `tasks/patterns.py`: `compute_patterns(as_of=None)` — 날짜 하나. 종목별 예외 격리, 실패율 5% 이상·0행이면 `error`(조건검색과 같은 기준). 실행 시간을 실측해 필요하면 프로세스 병렬을 둔다.
- `daily_market_pipeline` 마지막(조건검색 다음)에 `patterns` 단계. 관리자 수동 실행 `patterns`("차트 패턴 계산").

## 5. API — GraphQL(stock_api)

```
patternScreen(report: String = "forming", patternType: String, market: String, sort: String = "pivot_dist", limit: Int = 50, offset: Int = 0): PatternScreen
patternBases(ticker: String!): PatternBases
```
- `report`(종목의 현재 베이스 `is_current=1` 기준):
  - `breakout_today`: `days_since_breakout = 1`
  - `recent_breakouts`: `days_since_breakout` 1~20
  - `near_pivot`: 돌파 전(`is_active=1`)이고 종가가 피벗 ×0.90 초과 ×1.05 미만
  - `forming`: 돌파 전 전부
  - 그 밖의 값은 `forming`.
- `patternType`: 6종 키 또는 null(전체). `market`: KOSPI/KOSDAQ/null.
- `sort`: `pivot_dist`(피벗까지 거리 오름차순, 기본) · `breakout_vol`(돌파 거래량 내림차순) · `depth`(오름차순) · `length`(내림차순). 그 밖은 기본.
- `PatternScreen { date, total, items: [PatternItem] }`, `PatternItem { ticker name market sectorName close patternType label stage(=base_count) pivot pivotDistPct depth length isActive breakoutDate breakoutPricePct breakoutVolPct daysSinceBreakout }`.
- `patternBases(ticker)`: 최신 기준일의 그 종목 베이스 전부(오래된 → 최신, `points` 포함) + 현재 베이스의 매매 구간(숨김 규칙 적용). 종목이 없거나 기준일이 없으면 빈 목록.
- 구현 `services/pattern_query.py` — `screener_query` 패턴(화이트리스트·값 바인딩·count 별도·`MAX_LIMIT=200`·이름/업종은 PG·테이블 없음만 '준비 중').

## 6. 화면

### 6.1 웹 — 스크리너 탭 '패턴'(`/screener/patterns`, 조건검색 다음)
- 리포트 칩 4개(형성 중·피벗 근접·오늘 돌파·최근 돌파) + 패턴 칩(전체·컵·컵핸들·쌍바닥·플랫·박스권·HTF) + 시장 + 정렬.
- 목록: 종목명·티커·패턴 이름·단계 라벨·피벗·피벗까지 %·깊이·길이(일)·돌파 정보(돌파일·거래량 +%).
- 상세(넓은 화면 오른쪽 / 좁은 화면 펼침): 일봉 차트에 **피벗 선·매수 구간 상단(+5%)·손절 선(−8%)**, 베이스 꼭짓점 마커(림·저점·피벗·돌파), 베이스 이력 표(패턴·단계·깊이·길이·피벗·돌파일).
- `StockDailyChart` 에 선택 prop `priceLines`·`markers` 를 더한다(기존 사용처 영향 없음).
- 상태: 준비 중·0건·오류. 하단 "기준일 종가 · 매일 20:30 갱신 · 패턴 판정은 참고용이며 투자 권유가 아닙니다".

### 6.2 앱 — 스크리너 칩 '패턴'
- 리포트 칩 + 패턴 칩 가로 스크롤 + FlatList 무한 스크롤(조건검색 구조 재사용). 행 → `/stock/[ticker]`.
- 종목 상세에 '차트 패턴' 영역: 현재 베이스(패턴·단계·피벗·피벗까지 %·상태), 차트에 피벗·매수 구간 상단·손절 선(기존 `lines` 메시지 — WebView 변경 없음). 베이스가 없으면 영역 숨김.

## 7. 테스트
- 엔진: 합성 봉으로 패턴별 감지·비감지(참고 validation 스크립트의 시나리오를 pytest 로), 돌파 판정·길이·깊이, 겹침 제거·병합, 단계 계산(리셋·베이스 위 베이스·단계 증가), HTF 피벗이 깃대 고점이 아닌 두 번째 고점.
- 저장·태스크: 기준일 삭제 후 적재, 실패 격리·실패율, 파이프라인 단계(실패 격리).
- 조회: 리포트·패턴·시장·정렬 화이트리스트, 페이징, 준비 중, 매매 구간 숨김 규칙. 계약 테스트(웹·모바일 `*_QUERY`).
- 모바일 jest·웹 타입 검사.
- 실데이터(백필 후): 패턴별 건수·대표 종목 차트 눈 확인·1회 계산 시간.

## 8. 알려진 한계
- 기준값은 미국 종목 MarketSurge 화면에 맞춘 값이다. 국내 상·하한가(±30%)·변동성 차이는 반영하지 않았다.
- 주봉 패턴 없음. 과거 날짜 스냅샷 없음(차트의 베이스 이력은 최신 기준일에서 본 이력).
- 돌파는 장중 고가 기준이라 종가가 피벗 아래로 끝난 날도 돌파로 잡힌다(참고 엔진·MS 와 같음).
