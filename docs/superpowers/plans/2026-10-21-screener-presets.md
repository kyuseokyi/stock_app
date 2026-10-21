# 스크리너 조건검색(프리셋 4종·커스텀 필터) 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬 — superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans 로 작업 단위 실행. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 매일 장 마감 후 분석 대상 보통주 전체의 기술·재무 지표를 CH `screener_daily` 에 미리 계산해 두고, 웹 스크리너 탭 '조건검색'(`/screener/finder`)과 앱 스크리너 칩 '조건검색'에서 프리셋 4종(거래량 급증·골든크로스·과매도·신고가)과 커스텀 필터로 종목을 고르게 한다.

**구조:** collector 에 순수 지표 함수(`screener/indicators.py`)와 종목별 행 조립(`screener/compute.py`), CH 입출력(`repositories/clickhouse_screener.py`), 태스크(`tasks/screener.py` — `compute_screener`·`backfill_screener`)를 두고 `daily_market_pipeline` 맨 끝(시장 그룹 다음)에 단계를 더한다. stock_api 는 `services/screener_query.py` 가 서버 상수(프리셋·정렬·필터 조각)로만 SQL 을 만들고 사용자 값은 바인딩한다. GraphQL `screenerScreen(preset, filters: ScreenerFilterInput, sort, limit, offset)` 하나로 웹·앱이 같은 계약을 쓴다. 웹·앱은 주도주 화면 골격(필터 패널/바텀시트·정렬 칩·50개씩 더 보기·상태 4종)을 따르고, 판단 로직(필터 기본값·입력 변환·적용 수·같은 조건 비교·배지 글자)은 순수 함수로 뺀다.

**기술:** Python 3.12 · Celery · ClickHouse(clickhouse-connect, `ReplacingMergeTree`) · FastAPI + Strawberry GraphQL · pytest(가짜 CH 클라이언트) · React 18 + Vite + Tailwind(웹, 테스트 러너 없음 → `tsc`·`eslint`) · Expo SDK 57 · React Native 0.86 · react-native-unistyles v3 · graphql-request(`stockRequest`) · jest(jest-expo, `*.test.ts` 순수 로직만)

**설계:** [`docs/superpowers/specs/2026-10-21-screener-presets-design.md`](../specs/2026-10-21-screener-presets-design.md) · **선행:** CANSLIM [`2026-10-18-canslim-design.md`](../specs/2026-10-18-canslim-design.md), 모바일 주도주 계획 [`2026-10-21-mobile-leaders.md`](2026-10-21-mobile-leaders.md)

---

## 설계와 다르게 정한 것 (코드 조사 결과 반영)

| 설계 | 실제 코드 | 이 계획 |
|---|---|---|
| §3.1 컬럼 목록에 업종 없음, §4 `ScreenerItem.sectorName` 은 있음 | `canslim_daily` 는 `sector_m` 컬럼을 저장하고 조회 때 PG `Sector` 로 이름을 붙인다 | `screener_daily` 에 **`sector_m String`** 컬럼을 더한다. 값은 `market_repo.group_profile_map` 의 업종 그룹 코드(시장 탭 업종과 같은 코드, `"0000"`은 빈 값)다. 조회는 `canslim_query` 와 같이 `Sector` 표로 이름을 붙인다 |
| §3.1 시총 `mcap` | 시총은 `종가 × 상장주식수(천 주) × 1000` 이다. 상장주식수는 `group_profile_map` 에만 있다(`market_groups.compute.stock_values` 와 같은 식). 거래대금 `value` 도 `종가 × 거래량` 근사다 | 같은 식을 쓴다. 필터 `mcapMin/Max`·`valueMin` 은 **억 원**으로 받고 조회 서비스가 `× 1e8` 해서 바인딩한다. 테스트로 고정한다 |
| §3.2 봉 로드 "date·open·high·low·close·volume" | open 을 쓰는 지표가 없다. 매물대 구간은 `chart.volume_profile` 처럼 **최저가~최고가** 범위라 `low` 가 필요하다(기존 `clickhouse_canslim.load_bars` 는 `(date, high, close, volume)` 만 읽음) | 새 로더 `clickhouse_screener.load_bars` 가 `(date, high, low, close, volume)` 를 읽는다(open 은 읽지 않음) |
| §3.1 재무 컬럼 | 기존 `clickhouse_canslim.load_fundamentals` 는 `eps`·`roe` 만 읽는다 | 새 로더 `clickhouse_screener.load_fundamentals` 가 **연간(Y) 최신 결산월 한 행**의 `eps·bps·roe·sales_growth·op_growth·debt_ratio` 를 읽는다 |
| §2 RSI "`wilder_rsi` 재사용" | Wilder 평활은 입력 길이에 따라 값이 조금 달라진다. 게임은 최근 100종가(`rsi_service.CLOSES_LOOKBACK = 100`)를 넣는다. `rsi_service` 는 표준 라이브러리만 import 하고, 모듈의 `ThreadPoolExecutor` 는 작업을 넣기 전에는 스레드를 만들지 않는다 | `apps.trading_game.services.rsi_service.wilder_rsi` 를 그대로 import 하고 **최근 100종가**를 넣는다(`RSI_LOOKBACK = 100`). 테스트로 원본 값과 같음을 고정한다 |
| §2 골든크로스 "최근 3거래일 이내", §3.1 `gc_days` "3일 초과·없으면 NULL" | 기존 `trading_game.services.indicators.golden_cross_within(within=3)` 은 **오늘 포함 마지막 3봉** 안의 교차를 본다 | `gc_days` 는 **0·1·2**(0 = 오늘 교차)이고, 그 밖은 NULL 이다. "`gc_days` 가 NULL 이 아님 ⇔ `golden_cross_within(closes, fast=20, slow=60, within=3)`" 을 무작위 시계열 50개로 테스트한다 |
| §2 매물대 "현재가보다 위 구간의 비율" | `chart.volume_profile` 은 종가가 든 구간에 거래량을 더하고, 범위 밖 값은 맨 끝 구간으로 붙인다 | **현재가가 든 구간은 넣지 않고 그보다 위 구간만** 센다(구간 번호 > 현재가 구간 번호). 120봉 미만이면 NULL, 가격 범위가 0이면 0.0 이다. 구간 거래량은 `chart.volume_profile` 결과와 같은지 테스트한다 |
| §2 신고가 | — | 봉 252개(직전 251 + 당일) 미만이면 `high_52w_prev` 는 NULL, `is_new_high` 는 0 이다. `max(highs[-252:-1])` 로 구한다 |
| §2 배열 "`chart.ma_order` 와 같은 정의" | `chart.moving_average` 는 소수 둘째 자리로 반올림한 뒤 비교한다 | 같은 반올림을 하고 비교한다. 테스트로 `chart.ma_order` 와 같은 값임을 고정한다 |
| §4 `ScreenerItem` 에 볼린저 필드 없음, §5.1 상세 표에는 "볼린저 위치" 가 있음 | — | 조회 서비스가 요청한 σ(없거나 목록 밖이면 2)로 **`bbPosition`(ABOVE·BELOW·INSIDE·null)과 `bbWidthPct`** 를 계산해 항목에 넣는다. 응답에 실제로 쓴 σ 를 **`bbSigma`** 로 돌려준다(화면에 "볼린저(2σ)" 표시) |
| §4 볼린저 σ "1~3" | — | σ 는 **{1, 1.5, 2, 2.5, 3}** 중 하나만 받는다. 그 밖의 값은 2로 본다. 밴드폭 % 는 `2 × σ × std20 × 100 / ma20` 이다. σ 는 바인딩 파라미터 `%(bb_k)s` 로 넣는다 |
| §4 범위 검증 "음수·뒤집힌 min/max 는 무시" | ROE·매출성장률은 음수가 정상 값이다 | ROE·매출성장률만 음수를 허용한다. 나머지(가격·시총·거래대금·거래량 비율·RSI·PER·PBR·부채비율·매물대·밴드폭)는 음수면 무시한다. 숫자가 아님·NaN·무한대·`bool` 도 무시한다. min > max 면 그 쌍을 둘 다 무시한다 |
| §4 정렬 `rsi` 방향 미정 | 설계는 `vp_above` 만 오름차순으로 적었다 | `rsi` 는 내림차순이다(설계 그대로). 과매도 프리셋은 결과가 이미 RSI ≤ 30 이라 기본 정렬(거래대금)로 본다 |
| §6 "계약 테스트: `test_market_query.py` 방식" | `test_market_query.py` 의 공용 헬퍼는 시장 탭 전용이다 | 새 파일 **`backend/tests/test_screener_contract.py`** 에 같은 정규식 방식으로 웹·모바일 테스트 2개를 둔다. 웹 쿼리는 기존 `api/screener.ts` 를 건드리지 않으려고 새 파일 **`web_client/src/api/finder.ts`** 에 둔다(`test_canslim_query.py` 가 `api/screener.ts` 글자를 그대로 비교함) |
| §6 웹 "타입 검사(+ 기존 테스트 방식이 있으면 순수 함수)" | `web_client` 에는 테스트 러너(vitest 등)가 없고, 패키지 설치는 금지다 | 웹은 **`npx tsc --noEmit`(오류 0)** 과 **`npx eslint src`(오류 0)** 로 확인한다. 지금 eslint 는 오류 0·경고 26 이다. 새 화면이 기존 주도주 화면과 같은 `useEffect` 안 `setState` 패턴을 쓰면 `react-hooks/set-state-in-effect` 경고가 늘 수 있다(오류 아님). 웹 순수 함수는 모바일과 같은 규칙이고, 모바일 jest 가 그 규칙을 고정한다 |
| §5.2 "`mergeLeaderPage` 일반화" | `mergeLeaderPage(prev: CanslimItem[], next: CanslimItem[])` | 이름은 그대로 두고 타입만 `<T extends { ticker: string }>` 로 넓힌다(기존 호출·jest 그대로). 조건검색은 `mergeLeaderPage`·`hasMoreLeaders`·`listView` 를 import 해서 쓴다(페이지 크기 50 같음) |
| §5.2 앱 행 → `/stock/[ticker]` | 라우트 `app/stock/[ticker].tsx` 와 `screener.tsx` 의 `openStock(ticker, name)` 이 이미 있다 | typedRoutes 재생성이 필요 없다. `FinderSection` 은 `onOpenStock` 콜백만 받고 칩 등록 때 기존 `openStock` 을 넘긴다 |
| §5.2 필터 바텀시트(숫자 입력) | `BottomSheet` 는 내용 높이만큼만 올라오고 스크롤이 없다. 숫자 입력은 `app/fund/index.tsx` 의 `TextInput` 패턴이 있다 | 시트 안에 `ScrollView`(최대 높이 = 화면 높이의 65%)를 두고, 입력은 `TextInput keyboardType="numeric"` 이다. 초안은 글자(`FinderDraft`)로 들고 [적용] 때 `fromDraft` 로 숫자로 바꾼다. iOS 숫자 키패드에는 `-` 가 없어 ROE·매출성장률 음수 입력이 어렵다(지금은 Android 먼저 — 위험 항목에 적음) |
| §5.1 웹 상세 | 웹 `StockDailyChart(ticker, high52w)` 는 `high52w=null` 이면 고점선을 그리지 않는다 | 상세는 `StockDailyChart high52w={null}` + 지표 표 + "주도주 분석 보기" 링크(`/screener/leaders?ticker=…`, 기존 기능)다. 추가 조회는 없다(목록 항목 값으로 표를 그림) |
| 관리자 데이터 현황·작업 버튼(설계에 없음) | 관리자 웹은 CANSLIM·시장 그룹 계산·백필 4개를 버튼으로 돌린다(`admin_jobs`) | **이번 범위 밖**이다. 백필은 README 의 `celery call` 명령으로 돌린다(작업 9). 버튼 추가는 후속으로 남긴다 |

## 상시 규칙 (모든 작업)

- 모든 커밋은 `dev` 브랜치에 한다. `git add -A`·`git add .` 는 금지 — 파일을 **하나씩** 지정한다. `.serena/project.yml` 은 절대 스테이징하지 않는다(작업 트리에 수정분이 있음).
- 커밋 메시지는 한국어로 쓴다. 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- **테스트가 실패하면 커밋하지 않는다.** 타입 오류·eslint 오류가 있어도 커밋하지 않는다. amend 는 쓰지 않는다(고칠 것은 새 커밋).
- 검증 명령(작업 끝마다 해당하는 것):
  - 백엔드: `cd backend && uv run pytest -p no:warnings` — 기준 **1357개**. `pyproject.toml` 의 `addopts = "-q"` 때문에 명령에 `-q` 를 붙이지 않는다(붙이면 마지막 "N passed" 줄이 사라짐). 작업별 예상 누적: 작업 1 → 1376, 작업 2 → 1380, 작업 3 → 1389, 작업 4 → 1402, 작업 7 → 1404.
  - 웹: `cd web_client && npx tsc --noEmit`(출력 없음 = 통과) 와 `npx eslint src`(마지막 줄 `0 errors`). 테스트 러너는 없다.
  - 모바일: `cd mobile && npx jest` 와 `npm run typecheck` — 기준 **558개**, 실패 0, 타입 오류 0. 작업 6 → 571.
- 패키지 설치(`npm install`·`npx expo install`·`uv add`·`uv sync`)는 하지 않는다. 이 계획은 새 패키지가 필요 없다.
- 실제 env 파일(`.env.development`·`.env.production`·`.env.*.local` 등)은 **수정하지도 출력하지도 않는다**.
- **KIS 를 호출하지 않는다. 실제 수집·계산 태스크(`compute_screener`·`backfill_screener` 포함)를 실행하지 않는다.** 개발 DB(SSH 터널)에 쓰지 않는다. CH 는 가짜 클라이언트로만 테스트한다. 파이프라인 테스트는 **모든 단계를 가짜로 바꾼다**(진짜 단계가 돌면 터널이 열려 있을 때 개발 CH 에 쓸 수 있다).
- 로컬에서 Celery 워커·beat 를 띄우지 않는다.
- `daily_prices` 에는 컬럼을 추가하지 않는다(설계 §2 — 일봉 30일 겹침 재수집이 다른 단계가 채운 컬럼을 NULL 로 덮음).
- 디자인은 `docs/mobile_design_language.md`(토스식, 파스텔 C안)를 따른다. 상승 = 빨강 계열(앱 `theme.colors.up`, 웹 `text-up`), 하락 = 파랑 계열(앱 `theme.colors.down`, 웹 `text-down`). 앱 색은 테마 토큰(`theme.colors.*`)으로만 쓴다. 카드 = `surface`, 칩 = `Chip`(선택 `primarySoft`), 모달은 바텀시트(`BottomSheet`).
- 하위 에이전트 지시에 넣을 것: 보고·커밋 메시지는 한국어만 / Fact-Forcing Gate 훅이 파일 첫 수정마다 거부하면 요구 사실을 제시하고 같은 호출을 다시 할 것(훅 설정·env 변경 금지) / 패키지 설치 금지 / dev 브랜치·파일 개별 add·끝 두 줄 / 실제 태스크 실행 금지.

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `backend/apps/collector/screener/__init__.py` (새) | 패키지 표시 | 1 |
| `backend/apps/collector/screener/indicators.py` (새) | 지표 순수 함수: 이동평균·표준편차·RSI·등락률·거래량 비율·배열·직전 52주 고가·골든크로스 경과일·매물대 구간·위쪽 비율·PER/PBR | 1 |
| `backend/tests/test_screener_indicators.py` (새) | 지표 값 고정 + 원본(`wilder_rsi`·`chart.ma_order`·`chart.volume_profile`·`golden_cross_within`)과 같은지 | 1 |
| `backend/apps/collector/repositories/clickhouse_screener.py` (새) | `screener_daily` DDL·ensure, 봉 로드(고가·저가 포함), 최신 연간 재무 로드, 적재 | 2 |
| `backend/tests/test_clickhouse_screener.py` (새) | DDL 컬럼·적재 순서·로더 변환(가짜 CH) | 2 |
| `backend/apps/collector/screener/compute.py` (새) | 종목 한 줄 조립(`stock_row`)·하루치(`compute_day`) | 3 |
| `backend/tests/test_screener_compute.py` (새) | 행 값 고정·건너뛰기·종목별 실패 격리 | 3 |
| `backend/apps/collector/tasks/screener.py` (새) | `collector.compute_screener`·`collector.backfill_screener` | 3 |
| `backend/tests/test_screener_task.py` (새) | 태스크·백필 격리·include·파이프라인 마지막 단계 | 3 |
| `backend/apps/collector/tasks/market_data.py` (수정) | `daily_market_pipeline` 끝에 `screener` 단계 | 3 |
| `backend/apps/collector/celery_app.py` (수정) | include 에 `apps.collector.tasks.screener` | 3 |
| `backend/tests/test_market_tasks.py`, `backend/tests/test_canslim_task.py` (수정) | 파이프라인 단계 목록 단정에 `screener` 반영·가짜 단계 추가 | 3 |
| `backend/apps/stock_api/services/screener_query.py` (새) | 프리셋 상수·필터 화이트리스트·범위 검증·볼린저·정렬·페이징·이름 결합 | 4 |
| `backend/apps/stock_api/graphql/types.py` (수정) | `ScreenerFilterInput`(첫 input 타입)·`ScreenerItem`·`ScreenerScreen` | 4 |
| `backend/apps/stock_api/graphql/schema.py` (수정) | `screenerScreen` 리졸버 | 4 |
| `backend/tests/test_screener_query.py` (새) | 조회 서비스·GraphQL 연결 | 4 |
| `web_client/src/types/finder.ts` (새) | 조건검색 타입 | 5 |
| `web_client/src/lib/finder.ts` (새) | 프리셋·정렬 상수, 기본 필터, 입력 변환, 적용 수, 같은 조건, 배지 글자 | 5 |
| `web_client/src/api/finder.ts` (새) | `FINDER_QUERY`(계약 테스트 대상)·`getFinderScreen` | 5 |
| `web_client/src/components/finder/FinderFilters.tsx` (새) | 필터 패널(접기·초안·적용·초기화) | 5 |
| `web_client/src/components/finder/FinderList.tsx` (새) | 목록(배지·등락 색·펼침) | 5 |
| `web_client/src/components/finder/FinderDetail.tsx` (새) | 상세(일봉 차트 + 지표 표 + 주도주 링크) | 5 |
| `web_client/src/pages/screener/FinderTab.tsx` (새) | '조건검색' 탭 조립(프리셋 칩·정렬·상태·더 보기·스플릿) | 5 |
| `web_client/src/App.tsx`, `web_client/src/pages/screener/ScreenerLayout.tsx` (수정) | 라우트 `finder`·탭 | 5 |
| `mobile/src/features/leaders/canslim.ts` (수정) | `mergeLeaderPage` 타입 일반화 | 6 |
| `mobile/src/features/finder/types.ts` (새) | 조건검색 타입(웹과 같음) | 6 |
| `mobile/src/features/finder/finder.ts` (새) + `finder.test.ts` | 웹 `lib/finder.ts` 와 같은 순수 함수 + jest | 6 |
| `mobile/src/features/finder/api.ts` (새) | `FINDER_QUERY`(계약 테스트 대상)·`fetchFinderScreen` | 6 |
| `mobile/src/features/finder/use-finder-screen.ts` (새) | 조건·첫 페이지·새로고침·더 불러오기·옛 응답 무시 | 6 |
| `mobile/src/features/finder/components/preset-chips.tsx` (새) | 프리셋 칩 가로 스크롤 + 설명 한 줄 | 6 |
| `mobile/src/features/finder/components/finder-filter-sheet.tsx` (새) | 필터 바텀시트(스크롤·숫자 입력) | 6 |
| `mobile/src/features/finder/components/finder-row.tsx` (새) | 목록 한 줄 | 6 |
| `mobile/src/features/finder/sections/finder-section.tsx` (새) | '조건검색' 칩 화면 조립 | 6 |
| `mobile/src/app/(tabs)/screener.tsx` (수정) | '조건검색' 칩 등록 | 6 |
| `backend/tests/test_screener_contract.py` (새) | 웹·모바일 쿼리를 실제 스키마로 실행 | 7 |
| `README.md`, `docs/ROADMAP.md` (수정) | 조건검색 절·백필 명령·로드맵 | 8 |

---

### 작업 1: 지표 순수 함수 + 테스트

**파일:**
- 생성: `backend/apps/collector/screener/__init__.py`
- 생성: `backend/apps/collector/screener/indicators.py`
- 생성: `backend/tests/test_screener_indicators.py`

- [ ] **1-1. 실패하는 테스트 작성** — `backend/tests/test_screener_indicators.py`

```python
"""스크리너 지표 — 값 고정과 기존 정의(게임 RSI·차트 배열/매물대·골든크로스)와 같은지."""
import math
import random

import pytest

from apps.collector.screener import indicators as ind
from apps.stock_api.graphql.types import Candle
from apps.stock_api.services import chart
from apps.trading_game.services.indicators import golden_cross_within
from apps.trading_game.services.rsi_service import wilder_rsi


def test_sma_and_std_pop():
    vals = [float(x) for x in range(1, 21)]
    assert ind.sma(vals, 5) == 18.0
    assert ind.sma(vals, 21) is None
    assert ind.std_pop(vals, 20) == pytest.approx(math.sqrt(33.25))  # 1..20 모집단 표준편차
    assert ind.std_pop(vals[:19], 20) is None


def test_rsi14_uses_last_100_closes_of_wilder():
    closes = [100 + (i % 9) * 1.5 - (i % 4) for i in range(150)]
    assert ind.rsi14(closes) == wilder_rsi(closes[-100:], 14)
    assert ind.rsi14([float(x) for x in range(1, 16)]) == 100.0  # 15개(변화 14개)면 계산, 내린 날 없음
    assert ind.rsi14([float(x) for x in range(1, 15)]) is None


def test_chg_pct():
    assert ind.chg_pct([100.0, 110.0]) == pytest.approx(10.0)
    assert ind.chg_pct([110.0]) is None
    assert ind.chg_pct([0.0, 5.0]) is None


def test_vol_ratio():
    assert ind.vol_ratio([100.0] * 20 + [250.0]) == 2.5
    assert ind.vol_ratio([0.0] * 20 + [5.0]) is None  # 직전 평균 0
    assert ind.vol_ratio([100.0] * 20) is None         # 직전 20일 + 당일 = 21개 필요


@pytest.mark.parametrize("closes, expected", [
    ([float(x) for x in range(1, 131)], 1),                        # 계속 오름 → 정배열
    ([float(x) for x in range(130, 0, -1)], -1),                   # 계속 내림 → 역배열
    ([float(x) for x in range(1, 101)], 0),                        # 120일선 계산 불가
    ([100.0 + (5 if i % 2 else -5) for i in range(130)], 0),       # 들쭉날쭉 → 혼합
])
def test_ma_order_code_matches_chart(closes, expected):
    candles = [Candle(date=f"d{i}", open=c, high=c, low=c, close=c, volume=1) for i, c in enumerate(closes)]
    code = {"PERFECT": 1, "REVERSE": -1, "MIXED": 0}[chart.ma_order(candles)]
    assert ind.ma_order_code(closes) == expected == code


def test_prev_high_and_new_high():
    assert ind.prev_high([10.0] * 251 + [11.0]) == 10.0        # 직전 251봉 최고 10 → 당일 11 은 경신
    assert ind.prev_high([10.0] * 250 + [12.0, 11.0]) == 12.0
    assert ind.prev_high([10.0] * 251) is None                  # 252봉 미만
    assert ind.prev_high([99.0] + [10.0] * 251 + [11.0]) == 10.0  # 252봉보다 앞은 보지 않는다


@pytest.mark.parametrize("closes, expected", [
    ([100.0] * 70 + [130.0], 0),            # 오늘 20일선이 60일선 위로
    ([100.0] * 70 + [130.0] * 2, 1),
    ([100.0] * 70 + [130.0] * 3, 2),
    ([100.0] * 70 + [130.0] * 4, None),     # 교차가 3거래일보다 전
    ([100.0] * 60 + [130.0], None),         # 63봉 미만
    ([100.0] * 71, None),                   # 교차 없음(같은 값)
])
def test_gc_days(closes, expected):
    assert ind.gc_days(closes) == expected


def test_gc_days_agrees_with_golden_cross_within():
    rng = random.Random(7)
    for _ in range(50):
        closes, p = [], 100.0
        for _ in range(120):
            p = max(1.0, p + rng.uniform(-3, 3))
            closes.append(p)
        found = ind.gc_days(closes) is not None
        assert found == golden_cross_within(closes, fast=20, slow=60, within=3)


def test_volume_buckets_match_chart_volume_profile():
    rows = [(100 + (i % 7) * 3 + 5, 100 + (i % 7) * 3 - 5, 100 + (i % 7) * 3, 1000 + i * 10) for i in range(30)]
    candles = [Candle(date=f"2026-01-{i + 1:02d}", open=c, high=h, low=lo, close=c, volume=v)
               for i, (h, lo, c, v) in enumerate(rows)]
    mine = ind.volume_buckets([r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows], [r[3] for r in rows])
    assert mine == [float(b.volume) for b in chart.volume_profile(candles)]


def test_vp_above_pct():
    highs, lows = [200.0] * 120, [100.0] * 120
    closes = [190.0] * 60 + [110.0] * 59 + [150.0]   # 구간 폭 5 → 190 은 18번, 110 은 2번, 150 은 10번 구간
    volumes = [100.0] * 120
    assert ind.vp_above_pct(highs, lows, closes, volumes) == 50.0   # 위쪽 구간(18번) 6000 / 전체 12000
    assert ind.vp_above_pct(highs[1:], lows[1:], closes[1:], volumes[1:]) is None  # 120봉 미만
    flat = [100.0] * 120
    assert ind.vp_above_pct(flat, flat, flat, volumes) == 0.0       # 가격 범위 0
    assert ind.vp_above_pct(highs, lows, closes, [0.0] * 120) is None  # 거래량 0


def test_ratio_per_pbr():
    assert ind.ratio(10000.0, 500.0) == 20.0
    assert ind.ratio(10000.0, 0.0) is None
    assert ind.ratio(10000.0, -10.0) is None   # 적자·자본잠식은 배수 의미 없음
    assert ind.ratio(10000.0, None) is None
```

- [ ] **1-2. 실패 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_indicators.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.collector.screener'`

- [ ] **1-3. 패키지 표시** — `backend/apps/collector/screener/__init__.py`

```python
"""스크리너 조건검색 사전 계산(screener_daily) — 지표 순수 함수와 하루치 조립."""
```

- [ ] **1-4. 구현** — `backend/apps/collector/screener/indicators.py`

```python
"""스크리너 지표 — 순수 함수. 입력은 오래된 → 최신 순 목록, 데이터가 모자라면 None.

정의는 기존 화면·게임과 같게 맞춘다(테스트로 고정):
RSI = trading_game rsi_service.wilder_rsi(최근 100종가), 배열 = stock_api chart.ma_order,
매물대 구간 = chart.volume_profile, 골든크로스 = trading_game indicators.golden_cross_within.
"""
from __future__ import annotations

import math
from typing import Sequence

from apps.trading_game.services.rsi_service import wilder_rsi

RSI_PERIOD = 14
RSI_LOOKBACK = 100          # 게임 rsi_service.CLOSES_LOOKBACK 과 같은 길이(Wilder 평활은 입력 길이에 따라 값이 조금 다름)
VOL_AVG_DAYS = 20
HIGH_LOOKBACK = 251         # 직전 251거래일 + 당일 = 52주
GC_FAST, GC_SLOW, GC_WITHIN = 20, 60, 3
VP_BARS, VP_BINS = 120, 20


def sma(values: Sequence[float], n: int) -> float | None:
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def std_pop(values: Sequence[float], n: int = 20) -> float | None:
    """마지막 n개 모집단 표준편차(chart.bollinger_bands 와 같은 정의)."""
    if len(values) < n:
        return None
    window = values[-n:]
    m = sum(window) / n
    return math.sqrt(sum((x - m) ** 2 for x in window) / n)


def rsi14(closes: Sequence[float]) -> float | None:
    return wilder_rsi(list(closes[-RSI_LOOKBACK:]), RSI_PERIOD)


def chg_pct(closes: Sequence[float]) -> float | None:
    if len(closes) < 2 or not closes[-2]:
        return None
    return closes[-1] / closes[-2] * 100 - 100


def vol_ratio(volumes: Sequence[float], n: int = VOL_AVG_DAYS) -> float | None:
    """당일 거래량 / 직전 n거래일 평균(당일 제외). 평균이 0 이면 None."""
    if len(volumes) < n + 1:
        return None
    avg = sum(volumes[-n - 1:-1]) / n
    return volumes[-1] / avg if avg > 0 else None


def ma_order_code(closes: Sequence[float]) -> int:
    """1 정배열(MA5>20>50>120) · -1 역배열 · 0 혼합·판정 불가. chart.ma_order 처럼 소수 둘째 자리 반올림 후 비교."""
    vals = [sma(closes, n) for n in (5, 20, 50, 120)]
    if any(v is None for v in vals):
        return 0
    m5, m20, m50, m120 = (round(v, 2) for v in vals)
    if m5 > m20 > m50 > m120:
        return 1
    if m5 < m20 < m50 < m120:
        return -1
    return 0


def prev_high(highs: Sequence[float], n: int = HIGH_LOOKBACK) -> float | None:
    """당일을 뺀 직전 n거래일 최고가. 봉이 n+1개 미만이면 None."""
    if len(highs) < n + 1:
        return None
    return max(highs[-n - 1:-1])


def gc_days(closes: Sequence[float], fast: int = GC_FAST, slow: int = GC_SLOW, within: int = GC_WITHIN) -> int | None:
    """MA(fast) 가 MA(slow) 를 아래→위로 뚫은 뒤 지난 거래일 수(0 = 오늘). 오늘 포함 마지막 within 봉 안의 교차만 보고,
    지금도 fast > slow 여야 한다(golden_cross_within 과 같은 판정). 없거나 데이터 부족이면 None."""
    if len(closes) < slow + within:
        return None

    def ma(end: int, n: int) -> float:
        return sum(closes[end - n + 1:end + 1]) / n

    last = len(closes) - 1
    if not ma(last, fast) > ma(last, slow):
        return None
    for i in range(last, last - within, -1):
        if ma(i - 1, fast) <= ma(i - 1, slow) and ma(i, fast) > ma(i, slow):
            return last - i
    return None


def _bucket(price: float, p_min: float, width: float, bins: int) -> int:
    return max(0, min(bins - 1, int((price - p_min) / width)))


def volume_buckets(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float],
                   volumes: Sequence[float], bins: int = VP_BINS) -> list[float]:
    """가격 구간별 거래량(chart.volume_profile 과 같은 규칙 — 종가가 든 구간에 그날 거래량을 더한다)."""
    if not closes:
        return []
    p_min, p_max = min(lows), max(highs)
    if p_max <= p_min:
        return [float(sum(volumes))]
    width = (p_max - p_min) / bins
    buckets = [0.0] * bins
    for c, v in zip(closes, volumes):
        buckets[_bucket(c, p_min, width, bins)] += v
    return buckets


def vp_above_pct(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float],
                 volumes: Sequence[float], bars: int = VP_BARS, bins: int = VP_BINS) -> float | None:
    """최근 bars 봉 매물대에서 현재가가 든 구간보다 위 구간의 거래량 비율(%). 현재가 구간은 넣지 않는다."""
    if len(closes) < bars:
        return None
    h, lo, c, v = highs[-bars:], lows[-bars:], closes[-bars:], volumes[-bars:]
    total = sum(v)
    if total <= 0:
        return None
    p_min, p_max = min(lo), max(h)
    if p_max <= p_min:
        return 0.0
    buckets = volume_buckets(h, lo, c, v, bins)
    idx = _bucket(c[-1], p_min, (p_max - p_min) / bins, bins)
    return sum(buckets[idx + 1:]) / total * 100


def ratio(price: float, per_share: float | None) -> float | None:
    """PER·PBR = 종가 / 주당 값. 주당 값이 없거나 0 이하면 None(적자·자본잠식은 배수 의미 없음)."""
    if per_share is None or per_share <= 0:
        return None
    return price / per_share
```

- [ ] **1-5. 통과 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_indicators.py`
Expected: `19 passed`

- [ ] **1-6. 전체 확인**

Run: `cd backend && uv run pytest -p no:warnings`
Expected: `1376 passed`

- [ ] **1-7. 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/apps/collector/screener/__init__.py
git add backend/apps/collector/screener/indicators.py
git add backend/tests/test_screener_indicators.py
git commit -m "$(cat <<'EOF'
feat(collector): 스크리너 지표 순수 함수 — RSI·표준편차·이동평균·골든크로스 경과일·신고가·매물대 위쪽 비율·PER/PBR

게임 RSI·차트 배열/매물대·골든크로스 판정과 같은 값인지 테스트로 고정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 2: `screener_daily` DDL · 저장소(봉·재무 로드, 적재)

**파일:**
- 생성: `backend/apps/collector/repositories/clickhouse_screener.py`
- 생성: `backend/tests/test_clickhouse_screener.py`

테이블은 마이그레이션이 없다. `clickhouse_canslim.ensure_canslim_tables` 처럼 태스크 시작 때 `CREATE TABLE IF NOT EXISTS` 로 만든다(작업 3 의 `_prepare`).

- [ ] **2-1. 실패하는 테스트 작성** — `backend/tests/test_clickhouse_screener.py`

```python
"""스크리너 CH 입출력 — DDL·적재 컬럼 순서·로더 변환(가짜 CH 클라이언트)."""
from datetime import date, timedelta

from apps.collector.repositories import clickhouse_screener as cs

D1, D2 = date(2026, 10, 15), date(2026, 10, 16)


class _FakeCH:
    def __init__(self, results=None):
        self.commands, self.inserts, self.queries = [], [], []
        self._results = list(results or [])

    def command(self, sql):
        self.commands.append(sql)

    def insert(self, table, rows, column_names):
        self.inserts.append((table, rows, column_names))

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters))
        rows = self._results.pop(0) if self._results else []
        return type("R", (), {"result_rows": rows})()


def test_ensure_table_columns():
    ch = _FakeCH()
    cs.ensure_screener_table(ch)
    ddl = ch.commands[0]
    assert ".screener_daily" in ddl and "ReplacingMergeTree(ingested_at)" in ddl
    assert "PARTITION BY toYYYYMM(date)" in ddl and "ORDER BY (date, ticker)" in ddl
    for col in cs.ROW_COLUMNS:
        assert f"\n    {col} " in ddl, col
    assert "gc_days Nullable(Int16)" in ddl and "ma_order Int8" in ddl and "is_new_high UInt8" in ddl


def test_upsert_rows_uses_column_order():
    ch = _FakeCH()
    assert cs.upsert_rows([], ch) == 0 and ch.inserts == []
    row = {c: None for c in cs.ROW_COLUMNS} | {"date": D2, "ticker": "AAA", "close": 1.0}
    assert cs.upsert_rows([row], ch) == 1
    table, rows, cols = ch.inserts[0]
    assert table.endswith(".screener_daily") and cols == cs.ROW_COLUMNS
    assert rows == [[row[c] for c in cs.ROW_COLUMNS]]


def test_load_bars_sorted_per_ticker_with_low():
    ch = _FakeCH([[("BBB", D2, 11.0, 9.0, 10.0, 100), ("AAA", D2, 21, 19, 20, 5), ("AAA", D1, 11, 9, 10, 3)]])
    out = cs.load_bars(D2, client=ch)
    assert out == {"AAA": [(D1, 11.0, 9.0, 10.0, 3.0), (D2, 21.0, 19.0, 20.0, 5.0)],
                   "BBB": [(D2, 11.0, 9.0, 10.0, 100.0)]}
    sql, params = ch.queries[0]
    assert "high, low, close, volume" in sql and "daily_prices FINAL" in sql
    assert params == {"d": D2, "since": D2 - timedelta(days=400)}


def test_load_fundamentals_keeps_latest_year():
    ch = _FakeCH([[("AAA", "202312", 100.0, 1000.0, 10.0, 5.0, 3.0, 80.0),
                   ("AAA", "202412", 120.0, 1100.0, 11.0, 6.0, 4.0, 70.0),
                   ("BBB", "202412", None, None, None, None, None, None)]])
    out = cs.load_fundamentals(ch)
    assert out["AAA"] == {"yymm": "202412", "eps": 120.0, "bps": 1100.0, "roe": 11.0, "sales_growth": 6.0,
                          "op_growth": 4.0, "debt_ratio": 70.0}
    assert out["BBB"]["eps"] is None
    assert "period = 'Y'" in ch.queries[0][0] and "ORDER BY ticker, stac_yymm" in ch.queries[0][0]
```

- [ ] **2-2. 실패 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_clickhouse_screener.py`
Expected: FAIL — `ImportError: cannot import name 'clickhouse_screener'`

- [ ] **2-3. 구현** — `backend/apps/collector/repositories/clickhouse_screener.py`

```python
"""스크리너 CH 입출력 — 일봉 로드(고가·저가 포함)·최신 연간 재무 로드·screener_daily 적재.

결과 테이블은 ReplacingMergeTree(ingested_at): 같은 (date, ticker) 를 다시 계산하면 최신 행이 남는다(멱등, 조회는 FINAL).
daily_prices 에 컬럼을 더하지 않는다 — 일봉 30일 겹침 재수집이 다른 단계가 채운 컬럼을 NULL 로 덮기 때문.
"""
from __future__ import annotations

from datetime import date

from apps.collector.repositories.clickhouse_canslim import _since, latest_trading_date, trading_dates  # noqa: F401
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

ROW_COLUMNS = [
    "date", "ticker", "market", "sector_m", "close", "chg_1d", "volume", "value", "mcap", "vol_ratio20", "rsi14",
    "ma5", "ma20", "ma50", "ma60", "ma120", "std20", "ma_order", "high_52w_prev", "is_new_high", "gc_days",
    "vp_above_pct", "roe", "eps", "per", "pbr", "sales_growth", "op_growth", "debt_ratio", "liquid",
]

DAILY_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLICKHOUSE_DB}.screener_daily
(
    date Date,
    ticker String,
    market LowCardinality(String),
    sector_m String,
    close Float64,
    chg_1d Nullable(Float64),
    volume Float64,
    value Float64,
    mcap Nullable(Float64),
    vol_ratio20 Nullable(Float64),
    rsi14 Nullable(Float64),
    ma5 Nullable(Float64),
    ma20 Nullable(Float64),
    ma50 Nullable(Float64),
    ma60 Nullable(Float64),
    ma120 Nullable(Float64),
    std20 Nullable(Float64),
    ma_order Int8,
    high_52w_prev Nullable(Float64),
    is_new_high UInt8,
    gc_days Nullable(Int16),
    vp_above_pct Nullable(Float64),
    roe Nullable(Float64),
    eps Nullable(Float64),
    per Nullable(Float64),
    pbr Nullable(Float64),
    sales_growth Nullable(Float64),
    op_growth Nullable(Float64),
    debt_ratio Nullable(Float64),
    liquid UInt8,
    ingested_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(date)
ORDER BY (date, ticker)
"""

_FIN_FIELDS = ("eps", "bps", "roe", "sales_growth", "op_growth", "debt_ratio")


def ensure_screener_table(client=None) -> None:
    (client or get_client()).command(DAILY_DDL)


def _rows(sql: str, params: dict | None, client) -> list:
    return (client or get_client()).query(sql, parameters=params or {}).result_rows


def load_bars(as_of: date, days: int = 400, client=None) -> dict[str, list[tuple]]:
    """{ticker: [(date, high, low, close, volume)]} — as_of 이하 최근 days(달력일 ≈ 275거래일), 날짜 오름차순."""
    rows = _rows(f"SELECT ticker, date, high, low, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
                 "WHERE date <= %(d)s AND date > %(since)s", {"d": as_of, "since": _since(as_of, days)}, client)
    out: dict[str, list[tuple]] = {}
    for ticker, d, high, low, close, volume in rows:
        out.setdefault(ticker, []).append((d, float(high), float(low), float(close), float(volume)))
    for bars in out.values():
        bars.sort(key=lambda b: b[0])
    return out


def load_fundamentals(client=None) -> dict[str, dict]:
    """{ticker: {yymm, eps, bps, roe, sales_growth, op_growth, debt_ratio}} — 연간(Y) 최신 결산월 한 행.
    분기(Q) 누적 여부가 확인되지 않아 연간만 쓴다. 과거 기준일 백필도 최신 값을 쓴다."""
    rows = _rows(f"SELECT ticker, stac_yymm, eps, bps, roe, sales_growth, op_growth, debt_ratio "
                 f"FROM {CLICKHOUSE_DB}.fundamentals_periodic FINAL WHERE period = 'Y' ORDER BY ticker, stac_yymm",
                 None, client)
    out: dict[str, dict] = {}
    for ticker, ym, *vals in rows:
        out[ticker] = {"yymm": ym, **dict(zip(_FIN_FIELDS, vals))}  # 오름차순이라 마지막 = 최신
    return out


def upsert_rows(rows: list[dict], client=None) -> int:
    if not rows:
        return 0
    (client or get_client()).insert(f"{CLICKHOUSE_DB}.screener_daily",
                                    [[r.get(c) for c in ROW_COLUMNS] for r in rows], column_names=ROW_COLUMNS)
    return len(rows)
```

- [ ] **2-4. 통과 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_clickhouse_screener.py`
Expected: `4 passed`

- [ ] **2-5. 전체 확인**

Run: `cd backend && uv run pytest -p no:warnings`
Expected: `1380 passed`

- [ ] **2-6. 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/apps/collector/repositories/clickhouse_screener.py
git add backend/tests/test_clickhouse_screener.py
git commit -m "$(cat <<'EOF'
feat(collector): screener_daily 테이블·저장소 — 일봉(고가·저가) 로드, 최신 연간 재무 로드, 적재

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 3: 하루치 조립(compute) + 태스크 + 일일 파이프라인 단계 + celery include

**파일:**
- 생성: `backend/apps/collector/screener/compute.py`
- 생성: `backend/tests/test_screener_compute.py`
- 생성: `backend/apps/collector/tasks/screener.py`
- 생성: `backend/tests/test_screener_task.py`
- 수정: `backend/apps/collector/tasks/market_data.py`(import 1줄, `daily_market_pipeline` 문서 문자열·`steps`)
- 수정: `backend/apps/collector/celery_app.py`(include 1줄)
- 수정: `backend/tests/test_market_tasks.py`(파이프라인 테스트 4곳 + `_stub_steps`)
- 수정: `backend/tests/test_canslim_task.py`(`test_daily_pipeline_runs_canslim_last` 에 가짜 단계 2줄)

커밋은 두 번이다(3-A compute, 3-B 태스크·파이프라인).

#### 3-A. compute

- [ ] **3-1. 실패하는 테스트 작성** — `backend/tests/test_screener_compute.py`

```python
"""스크리너 하루치 조립 — 종목 한 줄 값, 짧은 이력, 건너뛰기·프로필 반영, 종목별 실패 격리."""
import math
from datetime import date, timedelta

import pytest

from apps.collector.screener import compute
from shared.sector_group import NO_SECTOR

START = date(2025, 6, 1)


def _bars(n, last_volume=1_000_000.0, volume=400_000.0):
    """종가 1000 + 10·i(계속 오름), 고가 +5, 저가 -5. 마지막 날만 거래량이 다르다."""
    out = []
    for i in range(n):
        c = 1000.0 + 10 * i
        out.append((START + timedelta(days=i), c + 5, c - 5, c, last_volume if i == n - 1 else volume))
    return out


def test_stock_row_full_history():
    bars = _bars(260)
    as_of = bars[-1][0]
    fin = {"yymm": "202512", "eps": 359.0, "bps": 1795.0, "roe": 12.0, "sales_growth": 5.0, "op_growth": -3.0,
           "debt_ratio": 80.0}
    r = compute.stock_row(as_of, "AAA", "KOSPI", "0013", bars, 1000, fin)
    assert r["date"] == as_of and r["ticker"] == "AAA" and r["market"] == "KOSPI" and r["sector_m"] == "0013"
    assert r["close"] == 3590.0 and r["volume"] == 1_000_000.0
    assert r["chg_1d"] == pytest.approx(3590 / 3580 * 100 - 100)
    assert r["value"] == 3590.0 * 1_000_000           # 거래대금 근사 = 종가 × 거래량
    assert r["mcap"] == 3590.0 * 1000 * 1000           # 종가 × 상장주식수(천 주) × 1000
    assert r["vol_ratio20"] == 2.5
    assert r["rsi14"] == 100.0                          # 내린 날 없음
    assert (r["ma5"], r["ma20"], r["ma50"], r["ma60"], r["ma120"]) == (3570.0, 3495.0, 3345.0, 3295.0, 2995.0)
    assert r["std20"] == pytest.approx(10 * math.sqrt(33.25))
    assert r["ma_order"] == 1
    assert r["high_52w_prev"] == 3585.0 and r["is_new_high"] == 1
    assert r["gc_days"] is None                         # 계속 20일선 > 60일선 — 최근 교차 없음
    assert r["vp_above_pct"] == 0.0                     # 최고가 근처 — 위쪽 매물 없음
    assert (r["roe"], r["eps"], r["sales_growth"], r["op_growth"], r["debt_ratio"]) == (12.0, 359.0, 5.0, -3.0, 80.0)
    assert r["per"] == 10.0 and r["pbr"] == 2.0
    assert r["liquid"] == 1                             # 20일 평균 거래대금 10억 이상·종가 1,000원 이상
    assert set(r) == set(compute.ROW_KEYS)


def test_stock_row_short_history():
    bars = _bars(30, last_volume=400_000.0)
    r = compute.stock_row(bars[-1][0], "BBB", "KOSDAQ", "", bars, None, None)
    assert r["rsi14"] == 100.0 and r["std20"] is not None and r["vol_ratio20"] == 1.0
    assert r["ma60"] is None and r["ma120"] is None and r["ma_order"] == 0
    assert r["gc_days"] is None and r["vp_above_pct"] is None
    assert r["high_52w_prev"] is None and r["is_new_high"] == 0
    assert r["mcap"] is None and r["per"] is None and r["pbr"] is None and r["roe"] is None
    assert r["liquid"] == 0                             # 평균 거래대금 10억 미만


def test_compute_day_skips_and_maps_profile():
    bars = _bars(30)
    as_of = bars[-1][0]
    universe = [("AAA", "에이", "KOSPI"), ("BBB", "비", "KOSDAQ"), ("CCC", "씨", "KOSPI"), ("DDD", "디", "KOSPI")]
    profiles = {"AAA": ("KOSDAQ", "0013", 1000, False), "DDD": ("", NO_SECTOR, None, False)}
    all_bars = {"AAA": bars, "BBB": bars[:-1], "DDD": bars}   # BBB 는 기준일 봉 없음(거래정지 등), CCC 는 일봉 없음
    rows = compute.compute_day(as_of, universe, profiles, all_bars, {"AAA": {"eps": 100.0}})
    assert [r["ticker"] for r in rows] == ["AAA", "DDD"]
    a, d = rows
    assert a["market"] == "KOSDAQ" and a["sector_m"] == "0013" and a["eps"] == 100.0  # 프로필 시장이 우선
    assert d["market"] == "KOSPI" and d["sector_m"] == ""      # 프로필 시장이 비면 마스터 시장, "0000" 은 업종 없음


def test_compute_day_isolates_bad_ticker(monkeypatch):
    bars = _bars(30)
    as_of = bars[-1][0]
    real = compute.stock_row

    def flaky(as_of_, ticker, *args):
        if ticker == "AAA":
            raise ValueError("bad data")
        return real(as_of_, ticker, *args)

    monkeypatch.setattr(compute, "stock_row", flaky)
    rows = compute.compute_day(as_of, [("AAA", "에이", "KOSPI"), ("BBB", "비", "KOSPI")], {},
                               {"AAA": bars, "BBB": bars}, {})
    assert [r["ticker"] for r in rows] == ["BBB"]
```

- [ ] **3-2. 실패 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_compute.py`
Expected: FAIL — `ImportError: cannot import name 'compute' from 'apps.collector.screener'`

- [ ] **3-3. 구현** — `backend/apps/collector/screener/compute.py`

```python
"""스크리너 하루치 조립 — 일봉·프로필·연간 재무를 받아 screener_daily 행을 만든다(순수).

CH 조회·저장은 repositories/clickhouse_screener, 태스크는 tasks/screener 가 맡는다.
데이터가 모자란 지표는 None — 조회에서 그 지표 조건이 걸리면 결과에서 빠진다.
"""
from __future__ import annotations

import logging
from datetime import date

from apps.collector.canslim.rules import is_liquid
from apps.collector.repositories.clickhouse_screener import ROW_COLUMNS
from apps.collector.screener import indicators as ind
from shared.sector_group import NO_SECTOR

log = logging.getLogger(__name__)

ROW_KEYS = tuple(ROW_COLUMNS)
_FIN_KEYS = ("roe", "eps", "sales_growth", "op_growth", "debt_ratio")


def stock_row(as_of: date, ticker: str, market: str, sector_m: str, bars: list[tuple],
              listed_shares_k: int | None, fin: dict | None) -> dict:
    """bars: [(date, high, low, close, volume)] 오름차순(마지막 = as_of). fin: 최신 연간 재무(없으면 None)."""
    highs = [b[1] for b in bars]
    lows = [b[2] for b in bars]
    closes = [b[3] for b in bars]
    volumes = [b[4] for b in bars]
    close, volume = closes[-1], volumes[-1]
    fin = fin or {}
    prev = ind.prev_high(highs)
    liquid, _avg = is_liquid(closes, volumes)
    return {
        "date": as_of, "ticker": ticker, "market": market, "sector_m": sector_m,
        "close": close, "chg_1d": ind.chg_pct(closes), "volume": volume, "value": close * volume,
        "mcap": close * listed_shares_k * 1000 if listed_shares_k else None,
        "vol_ratio20": ind.vol_ratio(volumes), "rsi14": ind.rsi14(closes),
        "ma5": ind.sma(closes, 5), "ma20": ind.sma(closes, 20), "ma50": ind.sma(closes, 50),
        "ma60": ind.sma(closes, 60), "ma120": ind.sma(closes, 120), "std20": ind.std_pop(closes, 20),
        "ma_order": ind.ma_order_code(closes),
        "high_52w_prev": prev, "is_new_high": int(prev is not None and highs[-1] > prev),
        "gc_days": ind.gc_days(closes), "vp_above_pct": ind.vp_above_pct(highs, lows, closes, volumes),
        **{k: fin.get(k) for k in _FIN_KEYS},
        "per": ind.ratio(close, fin.get("eps")), "pbr": ind.ratio(close, fin.get("bps")),
        "liquid": int(liquid),
    }


def compute_day(as_of: date, universe: list[tuple], profiles: dict, bars: dict, fundamentals: dict) -> list[dict]:
    """universe: [(ticker, name, market)], profiles: {ticker: (시장, 업종 그룹 코드, 상장주식수(천 주), 거래정지)}
    (market_repo.group_profile_map), bars: {ticker: [(date, high, low, close, volume)]}, fundamentals: {ticker: dict}.
    기준일 봉이 없는 종목(거래정지 등)은 건너뛴다. 한 종목 오류는 그 종목만 뺀다."""
    rows: list[dict] = []
    for ticker, _name, market in universe:
        b = bars.get(ticker)
        if not b or b[-1][0] != as_of:
            continue
        p_market, sector, shares, _halted = profiles.get(ticker, (market, "", None, False))
        sector = "" if (sector or "").strip() in ("", NO_SECTOR) else sector.strip()
        try:
            rows.append(stock_row(as_of, ticker, p_market or market, sector, b, shares, fundamentals.get(ticker)))
        except Exception:  # noqa: BLE001 — 한 종목 데이터 이상이 하루 계산 전체를 막지 않게
            log.exception("스크리너 계산 실패 ticker=%s date=%s", ticker, as_of)
    return rows
```

- [ ] **3-4. 통과 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_compute.py`
Expected: `4 passed`

- [ ] **3-5. 전체 확인**

Run: `cd backend && uv run pytest -p no:warnings`
Expected: `1384 passed`

- [ ] **3-6. 커밋(3-A)**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/apps/collector/screener/compute.py
git add backend/tests/test_screener_compute.py
git commit -m "$(cat <<'EOF'
feat(collector): 스크리너 하루치 조립 — 종목별 지표·재무 한 줄, 기준일 봉 없는 종목 건너뛰기·종목별 실패 격리

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

#### 3-B. 태스크 · 파이프라인 · include

- [ ] **3-7. 실패하는 테스트 작성** — `backend/tests/test_screener_task.py`

```python
"""스크리너 태스크 — 하루 계산·저장, 60일 백필(날짜별 격리), celery include, 일일 파이프라인 마지막 단계(실패 격리)."""
from datetime import date

import fakeredis
import pytest

from apps.collector.tasks import screener as task

D1, D2 = date(2026, 10, 15), date(2026, 10, 16)


@pytest.fixture
def fake(monkeypatch):
    calls = {"compute": [], "rows": []}
    monkeypatch.setattr(task.chm, "ensure_market_tables", lambda: None)
    monkeypatch.setattr(task.cs, "ensure_screener_table", lambda: None)
    monkeypatch.setattr(task.cs, "latest_trading_date", lambda: D2)
    monkeypatch.setattr(task.cs, "trading_dates", lambda as_of, n: [D1, D2][-n:])
    monkeypatch.setattr(task.cs, "load_bars", lambda as_of: {"AAA": as_of})
    monkeypatch.setattr(task.cs, "load_fundamentals", lambda: {"AAA": {"eps": 1.0}})
    monkeypatch.setattr(task, "_universe", lambda: [("AAA", "에이", "KOSPI")])
    monkeypatch.setattr(task, "_profiles", lambda: {"AAA": ("KOSPI", "0013", 100, False)})

    def compute_day(as_of, universe, profiles, bars, fundamentals):
        calls["compute"].append((as_of, bars, fundamentals))
        if as_of == calls.get("fail_on"):
            raise RuntimeError("bad day")
        return [{"ticker": "AAA", "is_new_high": 1, "gc_days": None}]

    monkeypatch.setattr(task, "compute_day", compute_day)
    monkeypatch.setattr(task.cs, "upsert_rows", lambda rows: calls["rows"].append(rows) or len(rows))
    return calls


def test_compute_latest_day(fake):
    out = task.compute_screener()
    assert out == {"date": "2026-10-16", "rows": 1, "new_high": 1, "golden_cross": 0}
    assert fake["compute"] == [(D2, {"AAA": D2}, {"AAA": {"eps": 1.0}})]


def test_compute_specific_day_and_no_data(fake, monkeypatch):
    assert task.compute_screener("2026-10-15")["date"] == "2026-10-15"
    monkeypatch.setattr(task.cs, "latest_trading_date", lambda: None)
    assert task.compute_screener() == {"skipped": "일봉 없음"}


def test_backfill_isolates_bad_day(fake):
    fake["fail_on"] = D1
    out = task.backfill_screener(days=2)
    assert out["ok"] == ["2026-10-16"] and out["failed"][0]["date"] == "2026-10-15"
    assert [c[0] for c in fake["compute"]] == [D1, D2]


def test_celery_include():
    from apps.collector.celery_app import celery_app

    assert "apps.collector.tasks.screener" in celery_app.conf.include


def test_daily_pipeline_runs_screener_last_even_if_groups_fail(monkeypatch):
    from apps.collector.tasks import market_data as md

    order = []
    monkeypatch.setattr(md, "get_sync_redis", lambda: fakeredis.FakeRedis(decode_responses=True))
    monkeypatch.setattr(md, "_daily_ohlcv", lambda: order.append("daily") or {})
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": order.append("idx") or {})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: order.append("investor") or {})
    monkeypatch.setattr(md, "compute_canslim", lambda: order.append("canslim") or {})

    def groups_boom():
        order.append("groups")
        raise RuntimeError("groups down")

    monkeypatch.setattr(md, "compute_market_groups", groups_boom)
    monkeypatch.setattr(md, "compute_screener", lambda: order.append("screener") or {"rows": 7})
    out = md.daily_market_pipeline()
    assert order == ["daily", "idx", "investor", "canslim", "groups", "screener"]
    assert "error" in out["market_groups"] and out["screener"] == {"rows": 7}
    assert list(out)[-1] == "screener"
```

- [ ] **3-8. 실패 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_task.py`
Expected: FAIL — `ImportError: cannot import name 'screener' from 'apps.collector.tasks'`

- [ ] **3-9. 태스크 구현** — `backend/apps/collector/tasks/screener.py`

```python
"""스크리너(조건검색) 계산 태스크 — 일일 파이프라인 맨 끝(시장 그룹 뒤), 60일 백필.

과거 기준일 백필도 재무는 최신 연간 값, 상장주식수·업종은 현재 프로필을 쓴다(근사).
"""
from __future__ import annotations

import logging
from datetime import date

from apps.collector.celery_app import celery_app
from apps.collector.repositories import clickhouse_market as chm
from apps.collector.repositories import clickhouse_screener as cs
from apps.collector.screener.compute import compute_day
from shared import market_repo
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)


def _universe() -> list[tuple[str, str, str]]:
    with SyncSessionLocal() as db:
        return market_repo.analysis_universe(db)


def _profiles() -> dict:
    with SyncSessionLocal() as db:
        return market_repo.group_profile_map(db)


def _run_day(as_of: date, universe, profiles, fundamentals) -> dict:
    rows = compute_day(as_of, universe, profiles, cs.load_bars(as_of), fundamentals)
    n = cs.upsert_rows(rows)
    return {"date": as_of.isoformat(), "rows": n, "new_high": sum(1 for r in rows if r["is_new_high"]),
            "golden_cross": sum(1 for r in rows if r["gc_days"] is not None)}


def _prepare():
    chm.ensure_market_tables()  # 재무 테이블이 아직 없어도 로드가 실패하지 않게
    cs.ensure_screener_table()
    return _universe(), _profiles(), cs.load_fundamentals()


@celery_app.task(name="collector.compute_screener")
def compute_screener(as_of: str | None = None) -> dict:
    """기준일(기본: 일봉 최신 거래일) 스크리너 지표 계산·저장 — 같은 날을 다시 돌려도 멱등."""
    universe, profiles, fundamentals = _prepare()
    d = date.fromisoformat(as_of) if as_of else cs.latest_trading_date()
    if d is None:
        return {"skipped": "일봉 없음"}
    out = _run_day(d, universe, profiles, fundamentals)
    log.info("스크리너 계산: %s", out)
    return out


@celery_app.task(name="collector.backfill_screener")
def backfill_screener(days: int = 60) -> dict:
    """최근 days 거래일을 채운다(날짜별 실패 격리)."""
    universe, profiles, fundamentals = _prepare()
    latest = cs.latest_trading_date()
    if latest is None:
        return {"skipped": "일봉 없음"}
    ok, failed = [], []
    for d in cs.trading_dates(latest, int(days)):
        try:
            _run_day(d, universe, profiles, fundamentals)
            ok.append(d.isoformat())
        except Exception as e:  # noqa: BLE001
            log.exception("스크리너 백필 실패 date=%s", d)
            failed.append({"date": d.isoformat(), "error": repr(e)[:300]})
    log.info("스크리너 백필: ok=%d failed=%d", len(ok), len(failed))
    return {"ok": ok, "failed": failed}
```

- [ ] **3-10. 파이프라인 단계 추가** — `backend/apps/collector/tasks/market_data.py`

(1) import — 바꾸기 전:
```python
from apps.collector.tasks.market_groups import compute_market_groups
```
바꾼 뒤:
```python
from apps.collector.tasks.market_groups import compute_market_groups
from apps.collector.tasks.screener import compute_screener
```

(2) 문서 문자열과 단계 — 바꾸기 전:
```python
    """20:30 — 전종목 일봉 → 국내 지수 → 투자자별 순매수 → CANSLIM → 시장 그룹(차례로, 앞 단계 예외와 무관하게 진행).
```
바꾼 뒤:
```python
    """20:30 — 전종목 일봉 → 국내 지수 → 투자자별 순매수 → CANSLIM → 시장 그룹 → 스크리너(차례로, 앞 단계 예외와 무관하게 진행).
```

바꾸기 전:
```python
             ("market_groups", lambda: compute_market_groups()))
```
바꾼 뒤(모듈 전역 이름을 람다 안에서 부른다 — 테스트의 monkeypatch 가 먹게):
```python
             ("market_groups", lambda: compute_market_groups()), ("screener", lambda: compute_screener()))
```

- [ ] **3-11. celery include** — `backend/apps/collector/celery_app.py`

바꾸기 전:
```python
        "apps.collector.tasks.market_groups",
        "apps.collector.tasks.push_sends",
```
바꾼 뒤:
```python
        "apps.collector.tasks.market_groups",
        "apps.collector.tasks.screener",
        "apps.collector.tasks.push_sends",
```

- [ ] **3-12. 기존 파이프라인 테스트 고치기** — `backend/tests/test_market_tasks.py`

(1) `test_daily_pipeline_continues_after_failure` — 바꾸기 전:
```python
    monkeypatch.setattr(md, "compute_market_groups", lambda: order.append("groups") or {})
    out = md.daily_market_pipeline()
    assert order == ["daily", "idx:KR", "investor", "canslim", "groups"]
```
바꾼 뒤:
```python
    monkeypatch.setattr(md, "compute_market_groups", lambda: order.append("groups") or {})
    monkeypatch.setattr(md, "compute_screener", lambda: order.append("screener") or {})
    out = md.daily_market_pipeline()
    assert order == ["daily", "idx:KR", "investor", "canslim", "groups", "screener"]
```

(2) `_stub_steps` — 바꾸기 전:
```python
    monkeypatch.setattr(md, "compute_market_groups", lambda: {"error": "no bars"})


def test_daily_pipeline_records_steps(monkeypatch):
```
바꾼 뒤:
```python
    monkeypatch.setattr(md, "compute_market_groups", lambda: {"error": "no bars"})
    monkeypatch.setattr(md, "compute_screener", lambda: {"rows": 5})


def test_daily_pipeline_records_steps(monkeypatch):
```

(3) `test_daily_pipeline_records_steps` — 바꾸기 전:
```python
    assert list(out) == ["daily", "indices_kr", "investor", "canslim", "market_groups"]
```
바꾼 뒤:
```python
    assert list(out) == ["daily", "indices_kr", "investor", "canslim", "market_groups", "screener"]
```
바꾸기 전:
```python
    assert [s["ok"] for s in rec["steps"]] == [False, True, True, True, False]
```
바꾼 뒤:
```python
    assert [s["ok"] for s in rec["steps"]] == [False, True, True, True, False, True]
```

(4) `test_daily_pipeline_result_unchanged_when_redis_down`·`test_daily_pipeline_result_unchanged_when_redis_client_fails` 두 곳 — 바꾸기 전(두 번 나온다, 둘 다 바꾼다):
```python
                   "canslim": {"rows": 10}, "market_groups": {"error": "no bars"}}
```
바꾼 뒤:
```python
                   "canslim": {"rows": 10}, "market_groups": {"error": "no bars"}, "screener": {"rows": 5}}
```

- [ ] **3-13. 기존 CANSLIM 파이프라인 테스트 고치기** — `backend/tests/test_canslim_task.py`

이 테스트는 시장 그룹 단계를 가짜로 바꾸지 않아 진짜 `compute_market_groups` 가 돌았다(CH 가 없으면 예외로 끝남). 스크리너 단계가 더해지면 진짜 계산이 하나 더 돈다. 둘 다 가짜로 바꾼다(단정은 그대로).

바꾸기 전:
```python
    monkeypatch.setattr(md, "compute_canslim", lambda: order.append("canslim") or {"rows": 1})
    out = md.daily_market_pipeline()
```
바꾼 뒤:
```python
    monkeypatch.setattr(md, "compute_canslim", lambda: order.append("canslim") or {"rows": 1})
    monkeypatch.setattr(md, "compute_market_groups", lambda: {})
    monkeypatch.setattr(md, "compute_screener", lambda: {})
    out = md.daily_market_pipeline()
```

- [ ] **3-14. 통과 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_task.py tests/test_market_tasks.py tests/test_canslim_task.py`
Expected: 실패 0. `test_screener_task.py` 5개 통과.

- [ ] **3-15. 전체 확인**

Run: `cd backend && uv run pytest -p no:warnings`
Expected: `1389 passed`

- [ ] **3-16. 커밋(3-B)**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/apps/collector/tasks/screener.py
git add backend/tests/test_screener_task.py
git add backend/apps/collector/tasks/market_data.py
git add backend/apps/collector/celery_app.py
git add backend/tests/test_market_tasks.py
git add backend/tests/test_canslim_task.py
git commit -m "$(cat <<'EOF'
feat(collector): 스크리너 계산 태스크 — compute_screener·backfill_screener, 일일 파이프라인 마지막 단계(실패 격리)

파이프라인 테스트는 스크리너·시장 그룹 단계도 가짜로 바꿔 진짜 계산이 돌지 않게 함

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---
