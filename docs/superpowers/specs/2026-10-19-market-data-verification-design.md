# 시장 데이터 검증 — 관리자 검증 화면 + 표본 점검 스크립트

작성일: 2026-10-19 · 상태: 승인(“응 서브에이전트 방식으로 진행해줘”)

## 목적

스크리너가 쓰는 데이터(일봉·계산값·투자자·재무·CANSLIM·테마/업종)가 맞는지 두 가지로 확인한다.

1. **관리자 "데이터 검증" 화면:** 종목 하나의 우리 값을 한 화면에 모으고, 외부 사이트(네이버·FnGuide·DART) 링크를 함께 둔다. 관리자가 눈으로 비교한다.
2. **표본 점검 스크립트(CLI):** 무작위 N 종목의 일봉을 KRX(pykrx)와 비교하고, 내부 계산값이 원천과 맞는지 기계적으로 검사한다. 보고서(마크다운)와 종료 코드를 남긴다.

둘 다 **읽기 전용**이다. KIS 는 호출하지 않는다.

## ① 관리자 "데이터 검증" 화면

### 화면 `/market/verify` (admin_web)

- 사이드바 그룹 **'시장 데이터'** 에 "데이터 검증" 메뉴를 추가한다(`components/Sidebar.tsx`, `App.tsx`). `Layout.tsx` 는 이미 `/market/` 을 넓은 화면으로 둔다.
- **입력:**
  - 종목 검색: 기존 `searchStocks`(`api/stockClient.ts`) 재사용, `country === 'KR'` 만, 300ms 디바운스(`components/market/StockSearchAdd.tsx` 와 같은 방식).
  - 날짜: 비우면 서버가 정한 날짜(아래 "날짜 결정")를 쓰고, 화면에 그 날짜를 채운다.
  - 선택한 종목·날짜는 주소 쿼리(`?ticker=&date=`)에 둔다. 새로고침·공유해도 같은 화면이 나온다.
- **카드(우리 값):**

| 카드 | 내용 | 출처 |
|---|---|---|
| 기본 정보 | 이름, 시장, 업종(코드·이름), 상장주식수(천 주), 거래정지·활성 여부 | PG stock_meta·stock_profile·sectors |
| 일봉 | 기준일 이하 최근 5행 OHLCV(최신이 위) | CH daily_prices FINAL |
| 계산값 | 종가, 1·5·20일 등락, 거래대금(근사), 시총 | CH market_stock_daily FINAL |
| 투자자 순매수 | 개인·외국인·기관 수량과 금액(KIS 원값 그대로, 단위 변환 없음) | CH investor_daily FINAL |
| 재무 | 최근 분기 8개·연간 5개 EPS·BPS·SPS·ROE·증가율·부채비율(최신이 위) | CH fundamentals_periodic FINAL |
| CANSLIM | 점수·통과 수·유동성, C·A·N·S·L·I·M 판정(통과/미달/판단 불가/준비 중), RS 등 | CH canslim_daily FINAL |
| 소속 그룹 | 업종 1개 + 소속 테마(숨김 테마·제외 종목 뺌), 그날 순위·1일 등락·구성 수 | PG themes·theme_stocks + CH market_group_daily FINAL |
| 외부 링크 | 네이버 종목·일별시세·투자자, FnGuide, DART | 서버가 만든 URL |

- 분기 EPS 는 누적·단독 여부를 관리자가 판단할 수 있게 **정렬된 원값**을 그대로 보여준다.
- 순위가 0 이면 "순위 제외(3종목 미만)" 로 표시한다(`market_groups/compute.py` `MIN_MEMBERS=3`).
- **비교 안내(고정 문구):**
  - "우리 일봉은 KRX+넥스트레이드 통합 시세 — 시가·거래량은 KRX 단독 사이트와 다를 수 있음(고가≥, 저가≤, 거래량≥ 가 정상)"
  - "테마·업종 등락은 구성 종목 단순 평균 — 사이트별 정의가 달라 흐름만 비교"
- 섹션 하나가 실패하면 그 카드에만 안내 문구(notes)를 보여준다.
- **모바일 390px:** 페이지 가로 넘침 없음. 그리드 자식 `min-w-0`, 표는 `overflow-x-auto` 안, 짧은 칸은 `whitespace-nowrap`, 한글 문장은 `break-keep`.

### API `GET /api/v1/admin/market/verify?ticker=&date=`

- 기존 라우터 `backend/apps/stock_api/routers/market_admin.py` 에 추가한다(`require_admin`, `run_in_threadpool`).
- 서비스 `backend/apps/stock_api/services/verify_ticker.py` 는 `data_status.py`·`market_query.py` 의 `_ch`/`_query` 관례를 따른다. PG 접근도 함수(`_stock_info`, `_theme_memberships`)로 분리해 테스트에서 바꿔 끼운다.
- **검증(직접 처리 — FastAPI 기본 422 배열 형식을 쓰지 않는다):**

| 조건 | 응답 |
|---|---|
| ticker 가 영문 대문자·숫자 6자리가 아님(소문자는 대문자로 바꿔 받음) | `422 {code:"INVALID_TICKER", message}` |
| date 가 `YYYY-MM-DD` 가 아님 | `422 {code:"INVALID_DATE", message}` |
| stock_meta 에 없고 일봉도 없음(두 조회 모두 성공한 경우만) | `404 {code:"STOCK_NOT_FOUND", message}` |

- **날짜 결정:** `date` 가 있으면 그 날짜를 쓴다. 없으면 **그 종목의** `max(date)` daily_prices 를 쓴다. 거래정지 종목도 마지막 거래일 값이 보인다. 응답에 결정된 `date` 와 요청한 `requested_date` 를 함께 준다.
- **조회 원칙:**
  - 모든 CH 조회는 ticker 로 거른다. ReplacingMergeTree 테이블은 `FINAL` 을 쓴다.
  - market_group_daily 는 `members > 0` 만 본다(숨김 테마 tombstone 제외).
  - 섹션마다 실패를 격리한다. 실패하면 그 섹션은 `null`, `notes[섹션]="조회에 실패했어요(서버 로그 확인)"`.
  - CH 테이블이 없으면(Code 60 / UNKNOWN_TABLE) 빈 값이다. 객체 섹션은 `null`, 재무는 빈 목록이다. `notes[섹션]="아직 계산·수집된 적이 없어요(테이블 없음)"`(`data_status._missing_table` 와 같은 판정).
  - 일봉이 없어 날짜를 정할 수 없으면 날짜가 필요한 섹션은 `null`, `notes.date` 에 안내를 넣는다.
- **응답 예(이 형태를 테스트와 TS 타입이 그대로 따른다):**

```json
{
  "ticker": "005930", "date": "2026-10-16", "requested_date": null,
  "profile": {"name": "삼성전자", "market": "KOSPI", "is_active": true, "sector_code": "0013",
              "sector_name": "전기·전자", "listed_shares_k": 5969783, "is_halted": false},
  "bars": [{"date": "2026-10-16", "open": 70000.0, "high": 71000.0, "low": 69500.0, "close": 70500.0, "volume": 12345678}],
  "computed": {"close": 70500.0, "chg_1d": 0.71, "chg_5d": 2.1, "chg_20d": null, "value": 870370299000.0,
               "mcap": 420869701500000.0, "sector_m": "0013"},
  "investor": {"prsn_qty": -1000, "frgn_qty": 800, "orgn_qty": 200, "prsn_amt": -70, "frgn_amt": 56, "orgn_amt": 14},
  "fundamentals": {"quarterly": [{"stac_yymm": "202606", "eps": 1200.0, "bps": 55000.0, "sps": 12000.0, "roe": 9.1,
                                  "sales_growth": 3.2, "op_growth": 10.5, "ni_growth": 8.0, "debt_ratio": 26.0}],
                   "annual": []},
  "canslim": {"score": 65, "pass_count": 4, "liquid": 1, "c": 1, "a": 0, "n": 1, "s": -1, "l": 1, "i": 1, "m": -2,
              "c_growth": 32.5, "c_quarter": "202606", "c_turnaround": 0, "a_cagr": 12.0, "a_roe": 9.1,
              "n_pct_from_high": -3.2, "n_high_52w": 72800.0, "s_ud_ratio": 1.3, "l_rs": 88, "l_rs_raw": 1.21,
              "sector_rs_rank": 3, "sector_rs_count": 40, "i_net_qty": 1500000.0, "i_buy_days": 6,
              "m_dist_days": 3.0, "avg_value_20d": 900000000000.0},
  "memberships": [{"kind": "sector", "group_id": "0013", "name": "전기·전자", "rank": 4, "chg_1d": 0.9, "members": 120},
                  {"kind": "theme", "group_id": "7", "name": "반도체", "rank": null, "chg_1d": null, "members": null}],
  "links": [{"label": "네이버 종목", "url": "https://finance.naver.com/item/main.naver?code=005930"}],
  "notes": {}
}
```

- **외부 링크(서버가 생성):**
  - 네이버 종목 `https://finance.naver.com/item/main.naver?code={t}`
  - 네이버 일별시세 `https://finance.naver.com/item/sise_day.naver?code={t}`
  - 네이버 투자자별 매매 `https://finance.naver.com/item/frgn.naver?code={t}`
  - FnGuide `https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=A{t}`
  - DART `https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm={URL 인코딩한 이름}` (이름을 모르면 뺀다)
- 소속 테마는 `market_repo.theme_groups`(숨김 테마·제외 종목 뺌)를 재사용해 파이썬에서 거른다. 테마 수천 행이라 부담이 없다. 업종은 stock_profile.sector_m 이다.

## ② 표본 점검 스크립트 (CLI, 운영 이미지 밖)

- **모듈:**
  - `backend/apps/collector/verify/__init__.py`
  - `checks.py`(판정 순수 함수 — I/O 없음)
  - `spot_check.py`(CH·PG·pykrx 읽기, 보고서, CLI)
- **실행(로컬, 개발 DB 터널 `scripts/dev-db-tunnel.sh` 필요):**
  ```bash
  cd backend && uv run --with pykrx python -m apps.collector.verify.spot_check --n 30 [--date YYYY-MM-DD] [--seed S] [--out PATH]
  ```
  - pykrx 는 외부 조회 함수 안에서만 import 한다. **pyproject 에 넣지 않는다.**
  - `shared` 를 import 하면 `backend/.env.development` 가 자동 로드된다. 그래서 터널 포트(15432·18123)로 붙고, env 를 수정할 필요가 없다.

### 외부 비교 — KRX 단독(pykrx `stock.get_market_ohlcv(d, d, ticker, adjusted=True)`)

- 로그인 없이 되는 개별 종목 OHLCV 만 쓴다. 지수·투자자 엔드포인트는 KRX 로그인이 필요해 제외한다.
- `adjusted=True`(수정주가)로 고정한다. 우리 일봉도 수정주가(`FID_ORG_ADJ_PRC='0'`)이므로 과거 날짜에서도 기준이 같다.
- **표본:** 그날 daily_prices 의 종목을 **정렬한 뒤** `random.Random(seed).sample` 로 N 개를 뽑는다. 같은 seed 면 같은 표본이다. seed 를 주지 않으면 만들어서 보고서와 출력에 남긴다.
  - pykrx 가 빈 값을 주는 종목(그날 KRX 거래 없음 등)은 `missing` 으로 분류된다(위반 아님). ETF 도 pykrx 가 값을 준다(2026-10-16 069500 확인).
  - pykrx 가 "KRX 로그인 실패: KRX_ID 또는 KRX_PW…" 경고를 출력하지만, 개별 종목 OHLCV 는 그대로 된다(확인함). KRX 계정은 설정하지 않는다.
- **판정(`checks.judge_bar`):** 우리 값은 UN(KRX+NXT 통합) 기준이다.

| 분류 | 조건 |
|---|---|
| `missing` | KRX 행 없음 또는 KRX 거래량 0 |
| `exact` | 거래량이 같고(NXT 미상장) 시가·고가·저가·종가도 모두 같음 |
| `consistent` | 거래량이 다르고, 고가 ≥ KRX 고가, 저가 ≤ KRX 저가, 거래량 ≥ KRX 거래량 |
| `violation` | 위 규칙 중 하나라도 어긋남(사유 목록) |
| `error` | KRX 조회 예외(한 종목 실패가 점검 전체를 막지 않음) |

- 종목 사이 대기는 기본 0.3초다. 함수 인자 `pause`·`throttle` 로 주입해 테스트에서는 기다리지 않는다. 파이썬 `time.sleep` 이고, 셸 `sleep` 명령은 쓰지 않는다.

### 내부 일관성(CH + PG, 기준일 하루)

| 검사 | 내용 | 실패 시 |
|---|---|---|
| (a) 종가 | market_stock_daily.close == daily_prices.close(FINAL). 일봉이 없으면 불일치 | 불일치 |
| (b) 1일 등락 | chg_1d == close / 직전 봉 종가 × 100 − 100. 직전 봉은 **그 종목의** 기준일 이전 마지막 행(45일 창, `clickhouse_market_groups.load_bars(days=45)` 와 같음). 직전 봉이 없거나 0 이면 None 이어야 한다. 허용 오차 rel 1e-6·abs 1e-6 | 불일치 |
| (c) 그룹 1일 평균 | market_group_daily(`members > 0`) 의 chg_1d == 구성 종목 market_stock_daily.chg_1d 단순 평균(None 제외) | 불일치 / 구성 변경 추정 |
| (d) 이름 중복 | 같은 날·같은 kind 안에서 이름이 같은 그룹. 알려진 사례: 업종 "의료·정밀기기" 2개 | 경고만(고치지 않음) |

- **(c) 구성 재현** — `market_groups/compute.py` `compute_day`·`aggregate` 와 같은 규칙을 쓴다.
  - 구성 = 그날 market_stock_daily 에 있는 종목 중 거래정지가 아닌 것. 중복 티커는 한 번만 센다.
  - 업종: `sector_m` 코드로 묶는다(group_id = 코드).
  - 테마: PG `market_repo.theme_groups` 로 묶는다(숨김 테마·제외 종목 뺌).
  - 거래정지: PG `market_repo.group_profile_map` 의 `is_halted` 를 쓴다.
- **구성 변경 추정(drift):**
  - 테마 소속과 거래정지는 **현재 PG 값**이다. 관리자 보정은 최신일만 다시 계산하므로, 과거 날짜는 계산 당시와 다를 수 있다.
  - 그래서 재현한 구성 수가 저장된 `members` 와 다르거나 재현한 그룹이 없으면 **drift**(경고)로 분류하고 평균은 비교하지 않는다.
  - 구성 수가 같을 때만 평균을 비교한다. 다르면 **불일치**(실패)다.
  - 업종·테마 둘 다 검사한다. PG 테마 조회가 실패하면 업종만 검사하고 보고서에 적는다.
- 테이블이 없거나 그날 행이 없으면 해당 검사를 건너뛰고 보고서 notes 에 적는다.

### 출력

- **마크다운 보고서**(`--out`, 기본 현재 디렉터리 `spot_check_<date>.md`)
  - 요약 표: 외부 분류별 수, 내부 검사 수·불일치 수, drift 수, 이름 중복 수
  - 위반 표(종목, 사유, 우리 OHLCV, KRX OHLCV), 조회 오류, 내부 불일치 표, drift 표(각 최대 50행), 이름 중복, notes, 비교 안내
- 터미널에 요약과 보고서 경로를 출력한다.
- **종료 코드:**
  - 외부 `violation` 이나 내부 불일치(a·b·c)가 하나라도 있거나, 내부 점검 자체가 실패하면 `1`(보고서는 남김)
  - drift·이름 중복·missing·error 만 있으면 `0`
  - 일봉이 아예 없거나 지정한 날짜에 일봉이 없으면 `2`
  - 위반·불일치는 없지만 KRX 조회 `error` 가 표본의 과반이면 `3`(외부 비교를 믿을 수 없음)

## 테스트

- **백엔드(pytest, 네트워크 없음):**
  - `checks`: 분류 5종, 종가·등락 불일치, 그룹 재현(거래정지 제외·중복 티커·None 제외), drift 와 불일치 구분, 이름 중복, 종료 코드
  - `spot_check`:
    - 표본 재현성(정렬 + seed)과 대기 주입(호출 수·간격)
    - 조회 예외 → error, pykrx 행 → Bar 변환
    - 내부 검사 연결(가짜 CH 를 SQL 문자열로 라우팅)과 테이블 없음 처리
    - `main` 의 보고서 파일·종료 코드
  - `verify_ticker`:
    - 입력 검증, 404, 날짜 결정(그 종목 최신일)
    - 응답 형태(위 예와 같은 키), 섹션 실패 격리, 테이블 없음 → 빈 값 + note
    - PG 실패 격리, 링크 인코딩
  - 라우터: 관리자만(403), 200·422·422·404 코드와 `{code,message}` 형태
- **관리자 웹:** 테스트 프레임워크가 없어 `npx tsc --noEmit` 으로 검사한다. 로컬 브라우저에서 데스크톱과 390px 폭을 확인한다.
- **실데이터 확인:** 로컬 터널로 `spot_check --n 30` 을 한 번 돌려 보고서를 확인한다(커밋하지 않음). 화면은 005930·293490(NXT 미상장)으로 확인한다.

## 범위 밖

- 데이터 자동 수정, 이름 중복 업종 정리, 배당 수정주가
- 지수·투자자 외부 비교(KRX 로그인 필요)
- 스케줄 실행(beat)·알림 연동 — 지금은 사람이 필요할 때 돌린다
