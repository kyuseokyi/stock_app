---
name: kis-quote-endpoint
description: 한국투자증권(KIS) 국내 시세 API 호출을 새로 추가하거나 수집 코드를 고칠 때 사용 (현재가, 일봉·분봉, 순위, 스크리너, 차트 데이터 등). UN→J 폴백, 수정주가, ClickHouse 적재, 테스트 작성 절차를 담고 있다.
---

# KIS 국내 시세 엔드포인트 추가 절차

## 1. 계층을 나눈다
| 계층 | 위치 | 하는 일 |
|---|---|---|
| client | `apps/collector/kis/client.py` | HTTP 호출만. TR ID 상수, 요청 파라미터 |
| fetcher / ranking | `apps/collector/kis/fetcher.py`, `ranking.py` | 시장코드 폴백 + 도메인 dict 로 변환 |
| parser | `apps/collector/market_parsers.py` | 문자열 필드 → 숫자 (`"71,000"`, `"-"`, `""` 처리) |
| repository | `apps/collector/repositories/` | 적재 |

API 라우터에 로직을 넣지 않는다 (Router → Service → Repository).

## 2. 시장코드 폴백 (필수)
- `FID_COND_MRKT_DIV_CODE` 는 **`UN`(통합) 먼저**, 빈 응답이면 **`J`(KRX)로 재조회**. 순위처럼 UN 이 오류를 낼 수 있는 API 는 오류일 때도 J 로 폴백한다.
- 이유: MTS 차트는 UN 통합 시세를 보여주는데, NXT 미상장 종목은 UN 이 빈 응답이다.
- 참고 구현: `fetcher.fetch_domestic_daily` (빈 응답 폴백), `ranking.fetch_fluctuation` (빈 응답 + 오류 폴백)
- 실시간 체결(WS): 통합 `H0UNCNT0`, NXT 미상장은 `H0STCNT0` → `apps/collector/game_ws/tr_select.py`

## 3. 파라미터
- 일봉·차트: `FID_ORG_ADJ_PRC='0'` (수정주가). KIS 수정주가는 분할/병합만 반영하고 배당은 반영하지 않는다.
- 일봉은 한 번에 약 100행까지 → 기간을 나눠 호출한다 (`fetcher._chunk_ranges`).

## 4. 적재와 조회
- ClickHouse `daily_prices` 는 `ReplacingMergeTree(ingested_at)`. **조회는 항상 `FINAL`**.
- 전종목 목록은 KIS 가 주지 않는다 → `apps/collector/stock_master.py` (.mst 를 매 수집마다 다시 읽음).

## 5. 테스트를 먼저 쓴다 (실제 KIS 호출 금지)
`tests/test_kis_fluctuation.py` 의 `_Fake` / `_Recorder` 패턴을 따른다. 최소 케이스:
1. 파서: 콤마 숫자, `"-"`, 빈 종목코드 행 제외, `None` 입력 → `[]`
2. UN 에 데이터가 있으면 J 를 호출하지 않는다 (`calls == [... "UN"]`)
3. UN 빈 응답 → J 로 폴백
4. (해당 시) UN 예외 → J 로 폴백
5. 요청 파라미터(TR ID, 시장코드, 수정주가 플래그)가 의도대로 나가는지

실행: `cd backend && uv run pytest -q tests/test_<이름>.py`

## 6. 마무리
- `market-data-reviewer` 에이전트에게 변경분 검토를 맡긴다. 이번 세션에 고친 파일 목록을 같이 넘긴다.
- API 응답(REST·GraphQL) 형식까지 바뀌었으면 `api-contract-reviewer` 에이전트에게도 맡긴다.
- 새 서버·명령·환경변수가 생겼으면 루트 `README.md` 를 갱신한다 (CLAUDE.md 규칙 7).
