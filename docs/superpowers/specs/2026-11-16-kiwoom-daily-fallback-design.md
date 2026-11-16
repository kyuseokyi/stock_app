# 일봉 키움 폴백 설계 (2026-11-16)

키움 연동 4단계 중 ③. 근거: [1단계 스펙](2026-11-16-kiwoom-client-probe-design.md), 실측 결과(`docs/kiwoom_setup_and_dev_spec.md` "실측 결과" — `_AL` = KRX+NXT 합산 = KIS UN, NXT 미상장 종목도 `_AL` 로 KRX 값).

## 동작
- 종목별 KIS 일봉 수집(`apps/collector/kis/fetcher.py` 의 일봉 수집 경로 — 20:30 파이프라인과 백필이 쓰는 곳)에서 **재시도 후에도 실패**(예외)하거나 **UN·J 모두 빈 응답**이면, 키움이 켜져 있을 때만 키움 `ka10081` 로 같은 기간을 받는다.
  - 종목코드는 항상 `{ticker}_AL`, `upd_stkpc_tp="1"`(수정주가), `base_dt`=기간 끝, 기간 시작보다 이른 행이 나올 때까지 연속조회(상한 있음) 후 기간으로 자른다.
  - `apps/collector/kiwoom/normalize.daily_row` 로 KIS 일봉과 같은 모양으로 바꿔 기존 저장 함수로 적재.
- 켜짐 조건: `get_kiwoom_config().is_configured` 이고 env `KIWOOM_FALLBACK_ENABLED` 가 false 가 아님(기본 true). 개발 서버는 키가 없어 자동 꺼짐 — 동작 그대로.
- 키움도 실패하면 기존 실패 처리 그대로(그 종목 실패로 집계). 키움 8010(IP)·미설정은 폴백을 조용히 끄고 경고 로그 1회.
- 키움 클라이언트는 수집 실행당 하나만 만들어 재사용(토큰 Redis 캐시), 자체 RateLimiter(`KIWOOM_RATE_PER_SEC`).

## 출처 기록
- CH `daily_prices` 에 `source LowCardinality(String) DEFAULT 'kis'` 추가 — `ALTER TABLE … ADD COLUMN IF NOT EXISTS`(기존 CH DDL 방식). KIS 적재는 'kis'(또는 생략=기본값), 키움 적재는 'kiwoom'.
- `ReplacingMergeTree(ingested_at)` 라 다음 날 KIS 겹침 수집이 같은 날짜를 다시 적재하면 KIS 행이 이긴다(값 동일, 출처만 kis 로 복귀).
- 기존 조회·응답은 `source` 를 쓰지 않는다(컬럼만 추가 — 응답 구조 무변경).

## 집계
- 일봉 단계 결과 dict 에 `kiwoom_fallback`(키움으로 채운 종목 수)·`kiwoom_failed` 추가. 어드민 파이프라인 카드가 결과 dict 를 그대로 보여 주면 별도 UI 작업 없음(아니면 라벨 한 줄).

## 하지 않는 것
지수·투자자·분봉 폴백, 분할 수집, `DATA_COLLECTOR_PROVIDER`.

## 테스트
- 폴백 호출 조건: KIS 성공 → 키움 안 부름 / KIS 예외 → 부름 / UN·J 빈 → 부름 / 키움 미설정·`KIWOOM_FALLBACK_ENABLED=false` → 안 부름
- 기간 자르기·연속조회 상한, 정규화 후 `source='kiwoom'` 적재
- 키움 실패·8010 → 그 종목 실패, 경고 1회, 나머지 계속
- CH DDL 에 `source` 컬럼 추가(멱등), 기존 적재 기본값 kis
- 결과 집계 키
