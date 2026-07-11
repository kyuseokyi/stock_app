# 03. 해외 주식 지원 — 거래소 매핑 & 국내/해외 차이

← [인덱스](00-index.md) · 관련: [02-data-collection.md](02-data-collection.md), [07-scheduling.md](07-scheduling.md)

> stock_app이 **해외 주식을 지원**하려면 국내와 다른 몇 가지 구조적 차이를 처음부터 반영해야 한다. AMS는 KRX + 미국(NYSE/NASDAQ/AMEX) + 일본(TSE) + 홍콩(HKEX) + 중국(SSE/SZSE) + 베트남(HOSE/HNX)을 지원한다.

## 1. 핵심 원칙 — `country_code` + `exchange` 추상화

수집 경로는 `country_code`로 분기한다: `KR` → 국내 엔드포인트, 그 외 → 해외 엔드포인트. `Exchange` 테이블 하나가 **라우팅 + 스케줄링의 단일 소스**다.

- `Exchange`: `code`, `country_code(CHAR2)`, `currency_code(CHAR3)`, `local_timezone`, `close_time`, `main_index_id`
→ **stock_app 권장**: `stock_meta`에 `country_code`, `exchange` 컬럼을 두고, 별도 `exchange` 마스터 테이블(코드/통화/타임존/대표지수)을 둔다. 지금 `stock_meta`는 국내 전용(KOSPI/KOSDAQ)이라, 해외 대비 **`market` enum을 `exchange` 참조로 일반화**해야 한다.

## 2. 거래소 코드 매핑 (내부 코드 → KIS 코드)

`app/common/constant.py`의 `EXCHANGE_CODE_MAP`:

| 내부 코드 | KIS 코드 | 시장 |
|---|---|---|
| `KRX` | `KRX` | 한국 |
| `NASDAQ` | `NAS` | 미국 나스닥 |
| `NYSE` | `NYS` | 미국 뉴욕 |
| `AMEX` | `AMS` | 미국 아멕스 |
| `TSE` | `TSE` | 일본 도쿄 |
| `HKEX` | `HKS` | 홍콩 |
| `SSE` | `SHS` | 중국 상하이 |
| `SZSE` | `SZS` | 중국 선전 |
| `HOSE` | `HSX` | 베트남 호치민 |
| `HNX` | `HNX` | 베트남 하노이 |

부가 매핑: `KIS_PRODUCT_TYPE_CODE_MAP`(상품유형 숫자코드, `search_info`용), `COUNTRY_TO_TIMEZONE`, `COUNTRY_TO_CURRENCY`, `COUNTRY_ALPHA2_to_ALPHA3`. KIS 해외 enum(`OverseasExchangeCode`)에는 미국 **주간거래 세션** 변형(`BAY`=NYSE주간, `BAQ`=NASDAQ주간, `BAA`=AMEX주간)도 있음.
> ⚠️ AMEX 상품코드가 `ProductTypeCode`에선 `514`, `OverseasProductTypeCode`에선 `529`로 **불일치** — 포팅 시 정리 필요.

## 3. ⭐ 국내 vs 해외 — 결정적 차이

| 항목 | 국내 (KR) | 해외 |
|---|---|---|
| OHLCV 엔드포인트 | `inquire-daily-itemchartprice` | `dailyprice` (`uapi/overseas-price/v1/quotations`) |
| 날짜 파라미터 | **start~end 범위** (`FID_INPUT_DATE_1/2`) | **end_date만** (`BYMD`) + period(`GUBN`) |
| 1회 응답량 | ~100행 | ~30행(D) |
| period 코드 | D/W/M/Y | **D/W/M만** (`OverseasPeriodCode` 0/1/2, **연봉 없음**) |
| 수정주가 플래그 | `FID_ORG_ADJ_PRC` | `MODP`('1'=수정주가 기본) |
| 백필 방식 | 날짜 범위 청킹 | **간격 둔 end_date 반복 호출** (`generate_period_end_dates`) |
| 소수 자릿수 | 정수 원화 | `zdiv`(소수 자릿수) 스케일링 필요, 통화 상이 |

### 해외 일봉 필드 매핑 (`daily_price` → `output2`)

| KIS 필드 | 의미 | OHLCV |
|---|---|---|
| `xymd` | 일자 | `date` |
| `open` | 시가 | `open` |
| `high` | 고가 | `high` |
| `low` | 저가 | `low` |
| `clos` | 종가 | `close` |
| `tvol` | 거래량 | `volume` |

`output1`엔 `zdiv`(소수 자릿수), `rsym`(실시간심볼) 등. **국내(`stck_*`)와 필드명이 완전히 다르므로** fetcher에서 국내/해외 매핑을 분리해야 한다.

### 해외 지수는 또 다른 엔드포인트
`inquire_daily_chartprice`(FID 방식) → `output2` 필드 `ovrs_nmix_oprc/hgpr/lwpr/prpr`(거래량 없음). 지수코드는 KIS `OverseasSectorCode`(`SPX`, `JP#NI225`, `HK#HS`, `SHANG`, `VN#VNI`, `KOSPI` 등).

## 4. 해외 백필의 핵심 — end_date 반복

해외 `daily_price`는 시작일이 없어 한 번에 ~30행(끝일 기준)만 준다. 긴 히스토리는 **간격을 둔 여러 end_date로 반복 호출**해야 한다(AMS `generate_period_end_dates`: 90일 이내면 `[end_date]`, 아니면 분기 경계 end_date들 생성).
→ **stock_app 권장**: "간격 둔 end_date 생성기"를 **1급 함수로 테스트**해 두고, 간격은 ~30행/호출 윈도우에 맞춰 정한다(분기 경계 맹신 금지).

## 5. 타임존 스케줄 — 시장별 로컬 22:00

각 거래소를 **자기 로컬 타임존 22:00**에 수집한다: `CronTrigger(hour=22, minute=0, timezone=exchange.local_timezone)`, 잡 id `f'{exchange.code}_OHLCV'`. 미국은 서머타임(EDT/EST)에 따라 KST 수집시각이 11시/12시로 달라진다. (전체 타임라인: [07-scheduling.md](07-scheduling.md))

## 6. 해외 특이사항 / 주의

- **수정주가 플래그(`MODP`)를 설정값으로** — AMS는 기본 수정주가 하드코딩. stock_app은 config로.
- **`zdiv` 소수 스케일링 + 통화** — 해외 가격은 문자열로 오고 소수 자릿수가 다름. Decimal로 스케일 저장 + 거래소별 통화 보관. AMS는 raw 문자열 저장(개선 여지).
- **해외는 `chk_holiday` 없음** — 국내에만 휴일조회 API 존재. 해외 휴일은 별도 소스 필요(AMS는 admin이 `ExchangeHoliday` 수기 입력). **처음부터 해외 휴일 데이터 소스를 정할 것.**
- **`kis_stock('production')` 하드코딩** — 해외 잡은 항상 production. mode를 config로 빼서 sandbox 사용 가능하게.
- **페이지네이션** — `tr_cont`/`NEXT`/`KEYB`. OHLCV 벌크는 페이지네이션 대신 end_date 반복에 의존(장기/분봉은 실제 페이지네이션 구현 권장).
- **엔드포인트 prefix 함정** — 해외 클래스 기본 prefix는 `overseas-stock`인데 실제 메서드는 매번 `overseas-price`로 override. 메서드 추가 시 override 누락 주의.

## 7. stock_app 채택 요약

**Adopt**
- 내부코드→KIS코드 간접 매핑(`EXCHANGE_CODE_MAP`) + `Exchange` 마스터(코드/국가/통화/타임존/대표지수)를 라우팅+스케줄 단일 소스로.
- 거래소별 **로컬 타임존 cron** 스케줄.
- 엔드포인트별 Pydantic 스키마(`tr_id`/params/`output1·output2`).
- 토큰 캐시(로컬+Redis) + 5xx 백오프, `tr_cont` 캡처, `LargeBatch` 버퍼 upsert.

**Adapt / 개선**
- 해외 백필을 **end_date+period 기반**으로 처음부터 설계(시작일 없음). 간격 생성기를 테스트된 1급 헬퍼로.
- `PeriodCode → OverseasPeriodCode` 변환을 **한 곳**으로 중앙화(현재 fetcher/job 중복), 해외 연봉은 명시적으로 거부.
- `zdiv` 소수 + 통화, `MODP` config, 실제 페이지네이션, 해외 휴일 소스, sandbox mode.
