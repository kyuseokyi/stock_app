# 연기금 10일 연속 매집 프리셋 설계 (2026-11-16)

키움 연동 4단계 중 ②([키움 1단계 스펙](2026-11-16-kiwoom-client-probe-design.md)). 키움 없이 **KIS 만** 쓴다. 로드맵 "연기금 10일 연속 매집 프리셋"(`docs/ROADMAP.md`, 기획 `2026-10-30-market-analyst-service-spec.md` [B]).

## 배경
지금 투자자 수급은 KIS `FHKST01010900`(개인·외국인·기관 3분류) → CH `investor_daily`. 연기금이 없어 프리셋을 못 만든다. KIS `FHPTJ04160001`(종목별 투자자매매동향 일별)은 기금·사모·투신·은행·보험·기타금융 등으로 나눠 준다(공식 예제 `koreainvestment/open-trading-api` `examples_llm/domestic_stock/investor_trade_by_stock_daily`).

## 수집
- `KISClient.get_investor_trade_daily(ticker, date_yyyymmdd, market_code)` — TR `FHPTJ04160001`, 경로·파라미터·응답 키는 **공식 예제에서 확인**해 그대로. 국내 시세 규칙대로 UN 먼저 → 빈 응답이면 J(CLAUDE.md "KIS 데이터 수집 규칙").
- 정규화: 날짜별 행 → `{ticker, date, pension_qty, pension_amt, private_eq_qty, private_eq_amt, invtrust_qty, invtrust_amt, bank_qty, bank_amt, insurance_qty, insurance_amt, other_fin_qty, other_fin_amt}` — 순매수(매수−매도). 필드 대응(기금→pension 등)은 예제 필드 설명으로 확정하고 표로 남긴다.
- 금액 단위: 기존 `investor_flow.KIS_AMT_TO_WON` 과 같은 방법으로 검증 가능한 형태로 두고(상수 하나), 확인 전에는 수량 기준으로 판정한다(프리셋은 **수량** 순매수 > 0 으로 셈 — 단위 문제 회피).
- 저장: CH 새 테이블 `investor_detail_daily(ticker, date, …qty/amt Int64, ingested_at DateTime64(3) DEFAULT now64(3)) ENGINE ReplacingMergeTree(ingested_at) PARTITION BY toYYYYMM(date) ORDER BY (ticker, date)` — 기존 `investor_daily` 는 그대로. 조회는 `FINAL`.
- 일정: 20:30 파이프라인에서 기존 투자자 수집 다음 단계로 보통주 유니버스(ETF·스팩·우선주 제외 — 기존 investor 단계와 같은 대상) 수집. 공유 `RateLimiter` 사용.
- 백필: 첫 실행·수동 태스크로 최근 30거래일(TR 이 기간 이력을 주면 한 번, 아니면 날짜별). 관리자 '초기 데이터 준비' 단계에도 추가(기존 단계 목록 패턴을 따름).

## 스크리너
- `screener_daily` 에 `pension_buy_days`(연기금 **수량** 순매수가 양수인 연속 거래일 수, 기준일부터 거꾸로) 추가 — 계산 위치·방식은 기존 `frgn_buy_days` 를 그대로 따른다. 데이터가 없는 종목은 0.
- 프리셋 `pension_buy_10d`: `pension_buy_days >= 10`(`PENSION_BUY_DAYS = 10`), `screener_query.PRESETS` 에 추가.
- 웹·앱 프리셋 상수(키 문자열 같게)에 "연기금 10일 연속 매집" 추가 — 기존 `foreign_buy_5d` 칩과 같은 위치·방식.

## 범위 밖
CANSLIM I 항목 연기금 반영, 시황 수급 전광판의 pykrx 대체, 키움 데이터.

## 테스트
- 클라이언트: 파라미터·UN→J 폴백(가짜 HTTP)
- 정규화: 필드 대응, 빈 값, 부호
- CH 저장소: 테이블 생성 DDL, 적재·FINAL 조회(기존 CH 테스트 방식)
- 연속 일수: 경계(10일 정확히, 중간 0·음수 끊김, 데이터 공백)
- 프리셋: WHERE 조합
- 웹·앱: 프리셋 목록에 키 포함

## 반영
- CH 테이블·컬럼은 코드가 `CREATE TABLE IF NOT EXISTS` / `ALTER … ADD COLUMN IF NOT EXISTS` 로 만드는 기존 방식을 따른다(PG alembic 아님).
- 개발·상용 둘 다 동작(KIS 키 각자). 데이터가 10거래일 쌓이기 전에는 프리셋 결과가 비는 게 정상 → 백필로 바로 채움.
- 문서: `docs/data-collection.md`, README, ROADMAP(항목 체크).
