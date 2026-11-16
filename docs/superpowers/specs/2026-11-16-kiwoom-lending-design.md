# 종목별 대차잔고 추이 설계 (키움 ka20068, 2026-11-16)

키움 연동 ④단계의 첫 데이터(이후 테마 → 투자자 시장 단면 → 특징주). 근거: [1단계 스펙](2026-11-16-kiwoom-client-probe-design.md), 키움 공식 명세 `kiwoom_api_spec.json`(c7a3d25) `ka20068`.

## 수집
- `KiwoomClient` 에 `get_lending_trend(ticker, start, end)` — `ka20068` 대차거래추이(종목별), 경로·body·응답 배열 키·필드(체결/상환/증감/잔고주수/잔고금액)와 단위는 **명세에서 확인**. 종목코드 접미사가 필요한지(대차는 KRX 단독일 가능성)도 명세로 확인 — 확인 못 하면 접미사 없이.
- 정규화(순수 함수) → `{ticker, date, new_qty, repay_qty, net_qty, balance_qty, balance_amt}` (금액은 원 단위로 환산, 단위는 명세 기준).
- CH 새 테이블 `stock_lending_daily(ticker String, date Date, new_qty Int64, repay_qty Int64, net_qty Int64, balance_qty Int64, balance_amt Int64, ingested_at DateTime64(3) DEFAULT now64(3)) ENGINE ReplacingMergeTree(ingested_at) PARTITION BY toYYYYMM(date) ORDER BY (ticker, date)` — 조회는 `FINAL`.
- 20:30 파이프라인에 단계 `lending` 추가 — **키움 설정(`get_kiwoom_config().is_configured`)일 때만**, 아니면 `{"skipped": "키움 키 없음"}`(개발 서버). 대상은 investor 단계와 같은 보통주. 매일 최근 5거래일 겹침. 키움 RateLimiter(`KIWOOM_RATE_PER_SEC`).
- 수동 백필 태스크 `collector.backfill_lending(days=60)`. 매일 단계는 자동 장기 백필을 하지 않는다(연기금과 같은 원칙).
- 키움 8010(IP)·미설정은 단계 전체를 skipped 로(경고 1회). 시간 제한 같은 rt 오류가 첫 종목에서 나오면 나머지를 부르지 않고 멈춘다(헛호출 방지 — 연기금 15:40 사례).

## 소량 실측
- 기존 `apps.collector.kiwoom.probe` 에 `--lending` 옵션: 2~3종목(기본 005930, 000660)의 최근 10거래일 대차 추이를 표로 출력(필드·단위·접미사 필요 여부·오류 코드 확인용). 키·토큰 미출력.

## 조회 API·화면
- stock_api `GET /api/v1/stocks/{ticker}/lending?days=120` → `[{date, balance_qty, net_qty, balance_amt}]`(오래된 순). 없으면 `[]`.
- 웹·앱 종목 상세: "대차잔고" 섹션 — 잔고 주수 선 + 일별 증감 막대(기존 차트 라이브러리·스타일 재사용), 데이터 없으면 섹션 숨김. 설명 한 줄: "대차잔고는 빌려 간 주식 수예요. 줄어들면 공매도 물량이 상환되는 중일 수 있어요(참고용)."

## 스크리너
- `screener_daily.lending_chg5`(대차잔고 5거래일 증감률 %, 5일 전 잔고가 0·없으면 NULL) — 기존 수급 컬럼 계산 방식을 따름.
- 프리셋 `lending_drop`: `lending_chg5 <= -20`(`LENDING_DROP_PCT = -20`), 웹·앱 프리셋 칩 "대차잔고 급감".

## 범위 밖
공매도 거래량(ka10014), 시장 전체 대차(ka10068), 알림.

## 테스트
클라이언트 body·연속조회, 정규화(단위·부호·빈 값), CH DDL·적재, 파이프라인 단계(키움 없음 skipped, 8010 skipped, 첫 종목 rt 오류 시 중단), 백필, `lending_chg5` 경계, 프리셋, API 응답, 웹·앱 섹션 숨김 조건.

## 반영
상용에서만 데이터가 생긴다(키움 IP). 배포 후 순서: `probe --lending` 소량 실측 → `backfill_lending` → `backfill_screener`. 문서: `docs/data-collection.md`, `docs/kiwoom_setup_and_dev_spec.md`(④-1), README.
