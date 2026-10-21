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

### 작업 4: 조회 서비스 `screener_query.py` + GraphQL `screenerScreen`

**파일:**
- 생성: `backend/apps/stock_api/services/screener_query.py`
- 생성: `backend/tests/test_screener_query.py`
- 수정: `backend/apps/stock_api/graphql/types.py`(`CanslimScore` 클래스 바로 뒤에 3개 추가)
- 수정: `backend/apps/stock_api/graphql/schema.py`(import 2곳, 리졸버 1개)

- [ ] **4-1. 실패하는 테스트 작성** — `backend/tests/test_screener_query.py`

```python
"""스크리너 조건검색 조회 — 프리셋·필터 WHERE, 화이트리스트, 범위 검증, 볼린저, 페이징·이름, GraphQL 연결(가짜 CH·PG)."""
from datetime import date

import pytest

from apps.stock_api.graphql.schema import schema
from apps.stock_api.services import screener_query as sq

D = date(2026, 10, 16)


class _FakeCH:
    def __init__(self, results):
        self.results, self.queries = list(results), []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        return type("R", (), {"result_rows": self.results.pop(0) if self.results else []})()


@pytest.fixture
def ch(monkeypatch):
    holder = {}

    def use(results=None):
        holder["ch"] = _FakeCH([[(D,)], [(0,)], []] if results is None else results)
        monkeypatch.setattr(sq, "_ch", lambda: holder["ch"])
        return holder["ch"]

    monkeypatch.setattr(sq, "_names", lambda tickers: {"AAA": "에이"})
    monkeypatch.setattr(sq, "_sector_names", lambda codes: {"0013": "전기·전자"})
    return use


def test_no_data_yet(ch, monkeypatch):
    ch([[(date(1970, 1, 1),)]])
    assert sq.screen() == {"date": None, "total": 0, "bb_sigma": 2.0, "items": []}

    class Boom:
        def query(self, sql, parameters=None):
            raise RuntimeError("table missing")  # 첫 계산 전(테이블 없음)

    monkeypatch.setattr(sq, "_ch", lambda: Boom())
    assert sq.screen(filters={"bb_sigma": 3}) == {"date": None, "total": 0, "bb_sigma": 3.0, "items": []}


@pytest.mark.parametrize("preset, cond", [
    ("volume_surge", "vol_ratio20 >= 2.0"),
    ("golden_cross", "gc_days IS NOT NULL"),
    ("oversold", "rsi14 <= 30.0"),
    ("new_high", "is_new_high = 1"),
])
def test_preset_adds_condition(ch, preset, cond):
    fake = ch()
    sq.screen(preset=preset)
    assert cond in fake.queries[1][0] and cond in fake.queries[2][0]   # count·목록 둘 다


def test_unknown_preset_and_sort_ignored(ch):
    fake = ch()
    sq.screen(preset="x; DROP TABLE t", sort="ticker; --")
    count_sql, rows_sql = fake.queries[1][0], fake.queries[2][0]
    assert count_sql.endswith("WHERE date = %(d)s AND liquid = 1")
    assert "DROP" not in rows_sql and "ORDER BY value DESC, ticker" in rows_sql


def test_filters_bound_as_params(ch):
    fake = ch()
    sq.screen(filters={"market": "KOSDAQ", "price_min": 1000, "price_max": 50000, "mcap_min": 500, "value_min": 10,
                       "vol_ratio_min": 1.5, "rsi_min": 20, "rsi_max": 40, "ma_order": "PERFECT", "roe_min": -5,
                       "sales_growth_min": -10, "per_max": 15, "pbr_max": 1.2, "debt_ratio_max": 100,
                       "vp_above_max": 30}, sort="vp_above")
    sql, params = fake.queries[2]
    for frag in ("market = %(market)s", "liquid = 1", "close >= %(price_min)s", "close <= %(price_max)s",
                 "mcap >= %(mcap_min)s", "value >= %(value_min)s", "vol_ratio20 >= %(vol_ratio_min)s",
                 "rsi14 >= %(rsi_min)s", "rsi14 <= %(rsi_max)s", "ma_order = %(ma_order)s", "roe >= %(roe_min)s",
                 "sales_growth >= %(sales_growth_min)s", "per <= %(per_max)s", "pbr <= %(pbr_max)s",
                 "debt_ratio <= %(debt_ratio_max)s", "vp_above_pct <= %(vp_above_max)s"):
        assert frag in sql, frag
    assert params["market"] == "KOSDAQ" and params["ma_order"] == 1
    assert params["mcap_min"] == 500 * 1e8 and params["value_min"] == 10 * 1e8   # 억 원 → 원
    assert params["price_min"] == 1000.0 and params["roe_min"] == -5.0 and params["sales_growth_min"] == -10.0
    assert "ORDER BY vp_above_pct ASC NULLS LAST" in sql
    assert "KOSDAQ" not in sql and "1000" not in sql                            # 사용자 값은 바인딩만


def test_invalid_ranges_ignored(ch):
    fake = ch()
    sq.screen(filters={"price_min": -1, "rsi_min": 60, "rsi_max": 40, "per_min": float("nan"), "mcap_max": True,
                       "ma_order": "SIDEWAYS", "market": "NYSE", "debt_ratio_max": "abc", "bb_position": "LEFT"})
    sql, params = fake.queries[1]
    assert sql.endswith("WHERE date = %(d)s AND liquid = 1")
    assert set(params) == {"d", "limit", "offset"}


def test_liquid_only_false(ch):
    fake = ch()
    sq.screen(filters={"liquid_only": False})
    assert "liquid" not in fake.queries[1][0]


def test_bollinger_filters(ch):
    fake = ch()
    out = sq.screen(filters={"bb_sigma": 2.5, "bb_position": "ABOVE", "bb_width_max": 10})
    sql, params = fake.queries[2]
    assert "close > ma20 + %(bb_k)s * std20" in sql
    assert "ma20 > 0 AND 2 * %(bb_k)s * std20 * 100 / ma20 <= %(bb_width_max)s" in sql
    assert params["bb_k"] == 2.5 and params["bb_width_max"] == 10.0 and out["bb_sigma"] == 2.5

    fake = ch()
    out = sq.screen(filters={"bb_sigma": 7, "bb_position": "INSIDE"})   # 목록 밖 σ → 2
    sql, params = fake.queries[2]
    assert "close BETWEEN ma20 - %(bb_k)s * std20 AND ma20 + %(bb_k)s * std20" in sql
    assert params["bb_k"] == 2.0 and out["bb_sigma"] == 2.0

    fake = ch()
    sq.screen(filters={"bb_position": "BELOW"})
    assert "close < ma20 - %(bb_k)s * std20" in fake.queries[2][0]


def test_items_mapping_and_paging(ch):
    rows = [("AAA", "KOSPI", "0013", 10500.0, 3.2, 5e9, 1e12, 2.4, 55.0, 10000.0, 200.0, 1, 1, 0, 12.5, 9.5, 1.1, 14.0),
            ("BBB", "KOSDAQ", "", 900.0, None, 1e8, None, None, None, None, None, 0, 0, None, None, None, None, None)]
    fake = ch([[(D,)], [(2,)], rows])
    out = sq.screen(limit=500, offset=-3)
    assert out["date"] == "2026-10-16" and out["total"] == 2 and out["bb_sigma"] == 2.0
    assert out["items"][0] == {
        "ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 10500.0, "chg_1d": 3.2,
        "value": 5e9, "mcap": 1e12, "vol_ratio20": 2.4, "rsi14": 55.0, "ma_order": 1, "is_new_high": True,
        "gc_days": 0, "vp_above_pct": 12.5, "per": 9.5, "pbr": 1.1, "roe": 14.0,
        "bb_position": "ABOVE", "bb_width_pct": 8.0}
    b = out["items"][1]
    assert b["name"] == "BBB" and b["sector_name"] is None and b["is_new_high"] is False
    assert b["bb_position"] is None and b["bb_width_pct"] is None
    sql, params = fake.queries[2]
    assert params["limit"] == 200 and params["offset"] == 0                    # 상한·음수 보정
    assert "screener_daily FINAL" in sql and "ORDER BY value DESC, ticker" in sql
    assert params["d"] == D


def test_bb_helpers():
    assert sq.bb_position(10500.0, 10000.0, 200.0, 2.0) == "ABOVE"
    assert sq.bb_position(9500.0, 10000.0, 200.0, 2.0) == "BELOW"
    assert sq.bb_position(10400.0, 10000.0, 200.0, 2.0) == "INSIDE"            # 경계값은 밴드 안
    assert sq.bb_position(1.0, None, 1.0, 2.0) is None
    assert sq.bb_width_pct(10000.0, 200.0, 2.0) == 8.0
    assert sq.bb_width_pct(0.0, 1.0, 2.0) is None and sq.bb_width_pct(None, 1.0, 2.0) is None


ITEM = {"ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 1.0, "chg_1d": -2.5,
        "value": 1e9, "mcap": None, "vol_ratio20": 2.1, "rsi14": 28.0, "ma_order": -1, "is_new_high": False,
        "gc_days": None, "vp_above_pct": 40.0, "per": None, "pbr": 0.8, "roe": -3.0, "bb_position": "BELOW",
        "bb_width_pct": 12.0}


def test_graphql_wiring(monkeypatch):
    seen = []

    def fake_screen(**kw):
        seen.append(kw)
        return {"date": "2026-10-16", "total": 1, "bb_sigma": 1.5, "items": [ITEM]}

    monkeypatch.setattr(sq, "screen", fake_screen)
    q = """query($f: ScreenerFilterInput) { screenerScreen(preset: "oversold", filters: $f) {
      date total bbSigma
      items { ticker chg1d volRatio20 rsi14 isNewHigh gcDays vpAbovePct bbPosition bbWidthPct maOrder sectorName } } }"""
    res = schema.execute_sync(q, variable_values={"f": {"market": "KOSPI", "priceMin": 1000, "bbSigma": 1.5,
                                                         "bbPosition": "BELOW", "liquidOnly": False}})
    assert res.errors is None, res.errors
    kw = seen[0]
    assert kw["preset"] == "oversold" and kw["sort"] == "value" and kw["limit"] == 50 and kw["offset"] == 0
    f = kw["filters"]
    assert f["market"] == "KOSPI" and f["price_min"] == 1000 and f["bb_sigma"] == 1.5 and f["bb_position"] == "BELOW"
    assert f["liquid_only"] is False and f["rsi_max"] is None
    data = res.data["screenerScreen"]
    assert data["bbSigma"] == 1.5 and data["total"] == 1
    assert data["items"][0] == {"ticker": "AAA", "chg1d": -2.5, "volRatio20": 2.1, "rsi14": 28.0, "isNewHigh": False,
                                "gcDays": None, "vpAbovePct": 40.0, "bbPosition": "BELOW", "bbWidthPct": 12.0,
                                "maOrder": -1, "sectorName": "전기·전자"}

    res = schema.execute_sync("{ screenerScreen { total } }")
    assert res.errors is None
    assert seen[1]["filters"] == {} and seen[1]["preset"] is None              # 필터 없음 = 빈 사전(거래 활발 기본 켬)
```

- [ ] **4-2. 실패 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_query.py`
Expected: FAIL — `ImportError: cannot import name 'screener_query'`

- [ ] **4-3. 조회 서비스 구현** — `backend/apps/stock_api/services/screener_query.py`

```python
"""스크리너 조건검색 조회 — screener_daily(CH) 최신 기준일 + 종목명·업종명(PG). GraphQL screenerScreen 이 쓴다.

계산은 collector(tasks/screener) 가 매일 해 둔다. SQL 에 들어가는 글자는 이 파일의 상수(프리셋·정렬·필터 조각)뿐이고,
사용자 값은 모두 바인딩 파라미터로 넣는다. 범위 값이 이상하면(음수·뒤집힌 min/max·숫자 아님) 그 조건만 무시한다.
"""
from __future__ import annotations

import math
from datetime import date

from sqlalchemy import select

from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.database import SyncSessionLocal
from shared.market_models import Sector

_EPOCH = date(1970, 1, 1)
MAX_LIMIT = 200
EOK = 1e8                    # 억 원 — 시총·거래대금 필터 단위
VOLUME_SURGE_RATIO = 2.0     # 차트 퀴즈 신호(scripts/generate_chart_quiz.VOLUME_SURGE_RATIO)와 같은 기준
OVERSOLD_RSI = 30.0
BB_SIGMAS = (1.0, 1.5, 2.0, 2.5, 3.0)
DEFAULT_BB_SIGMA = 2.0

# 프리셋 = 서버 상수 조건 묶음(필터와 AND). 키는 웹·앱 상수와 같은 문자열
PRESETS = {
    "volume_surge": f"vol_ratio20 >= {VOLUME_SURGE_RATIO}",
    "golden_cross": "gc_days IS NOT NULL",
    "oversold": f"rsi14 <= {OVERSOLD_RSI}",
    "new_high": "is_new_high = 1",
}
SORTS = {
    "value": "value DESC, ticker",
    "chg": "chg_1d DESC NULLS LAST, ticker",
    "vol_ratio": "vol_ratio20 DESC NULLS LAST, ticker",
    "rsi": "rsi14 DESC NULLS LAST, ticker",
    "mcap": "mcap DESC NULLS LAST, ticker",
    "vp_above": "vp_above_pct ASC NULLS LAST, ticker",
}
# (입력 키, 컬럼, 비교, 배수, 음수 허용) — ROE·매출성장률만 음수가 정상 값
_RANGES = (
    ("price_min", "close", ">=", 1, False), ("price_max", "close", "<=", 1, False),
    ("mcap_min", "mcap", ">=", EOK, False), ("mcap_max", "mcap", "<=", EOK, False),
    ("value_min", "value", ">=", EOK, False),
    ("vol_ratio_min", "vol_ratio20", ">=", 1, False),
    ("rsi_min", "rsi14", ">=", 1, False), ("rsi_max", "rsi14", "<=", 1, False),
    ("vp_above_max", "vp_above_pct", "<=", 1, False),
    ("roe_min", "roe", ">=", 1, True),
    ("per_min", "per", ">=", 1, False), ("per_max", "per", "<=", 1, False),
    ("pbr_min", "pbr", ">=", 1, False), ("pbr_max", "pbr", "<=", 1, False),
    ("debt_ratio_max", "debt_ratio", "<=", 1, False),
    ("sales_growth_min", "sales_growth", ">=", 1, True),
)
_PAIRS = (("price_min", "price_max"), ("mcap_min", "mcap_max"), ("rsi_min", "rsi_max"), ("per_min", "per_max"),
          ("pbr_min", "pbr_max"))
_MA_ORDERS = {"PERFECT": 1, "REVERSE": -1}
_BB_POSITION_SQL = {
    "ABOVE": "close > ma20 + %(bb_k)s * std20",
    "BELOW": "close < ma20 - %(bb_k)s * std20",
    "INSIDE": "close BETWEEN ma20 - %(bb_k)s * std20 AND ma20 + %(bb_k)s * std20",
}
_SCREEN_COLUMNS = ["ticker", "market", "sector_m", "close", "chg_1d", "value", "mcap", "vol_ratio20", "rsi14", "ma20",
                   "std20", "ma_order", "is_new_high", "gc_days", "vp_above_pct", "per", "pbr", "roe"]


def _ch():
    return get_client()


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def _names(tickers: list[str]) -> dict[str, str]:
    with SyncSessionLocal() as db:
        return market_repo.names_for(db, tickers)


def _sector_names(codes: list[str]) -> dict[str, str]:
    codes = [c for c in codes if c]
    if not codes:
        return {}
    with SyncSessionLocal() as db:
        return dict(db.execute(select(Sector.code, Sector.name).where(Sector.code.in_(codes))).all())


def latest_date() -> date | None:
    try:
        rows = _query(f"SELECT max(date) FROM {CLICKHOUSE_DB}.screener_daily")
    except Exception:  # noqa: BLE001 — 첫 계산 전(테이블 없음)이면 '준비 중'
        return None
    d = rows[0][0] if rows else None
    return None if d is None or d == _EPOCH else d


def _num(v, allow_negative: bool) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x) or (x < 0 and not allow_negative):
        return None
    return x


def bb_sigma(filters: dict) -> float:
    s = _num(filters.get("bb_sigma"), False)
    return s if s in BB_SIGMAS else DEFAULT_BB_SIGMA


def bb_position(close: float, ma20: float | None, std20: float | None, k: float) -> str | None:
    if ma20 is None or std20 is None:
        return None
    if close > ma20 + k * std20:
        return "ABOVE"
    if close < ma20 - k * std20:
        return "BELOW"
    return "INSIDE"


def bb_width_pct(ma20: float | None, std20: float | None, k: float) -> float | None:
    if ma20 is None or std20 is None or ma20 <= 0:
        return None
    return 2 * k * std20 * 100 / ma20


def build_where(preset: str | None, filters: dict) -> tuple[list[str], dict]:
    """프리셋(서버 상수) + 필터(화이트리스트) → WHERE 조각과 바인딩 값. 맨 앞은 기준일 조건."""
    where, params = ["date = %(d)s"], {}
    if preset in PRESETS:
        where.append(PRESETS[preset])
    if filters.get("market") in ("KOSPI", "KOSDAQ"):
        where.append("market = %(market)s")
        params["market"] = filters["market"]
    if filters.get("liquid_only", True) is not False:
        where.append("liquid = 1")
    values = {key: _num(filters.get(key), neg) for key, _col, _op, _mult, neg in _RANGES}
    for lo, hi in _PAIRS:
        if values[lo] is not None and values[hi] is not None and values[lo] > values[hi]:
            values[lo] = values[hi] = None  # 뒤집힌 범위는 둘 다 무시
    for key, col, op, mult, _neg in _RANGES:
        if values[key] is not None:
            where.append(f"{col} {op} %({key})s")
            params[key] = values[key] * mult
    if filters.get("ma_order") in _MA_ORDERS:
        where.append("ma_order = %(ma_order)s")
        params["ma_order"] = _MA_ORDERS[filters["ma_order"]]
    k = bb_sigma(filters)
    if filters.get("bb_position") in _BB_POSITION_SQL:
        where.append(_BB_POSITION_SQL[filters["bb_position"]])
        params["bb_k"] = k
    width = _num(filters.get("bb_width_max"), False)
    if width is not None:
        where.append("ma20 > 0 AND 2 * %(bb_k)s * std20 * 100 / ma20 <= %(bb_width_max)s")
        params.update({"bb_k": k, "bb_width_max": width})
    return where, params


def screen(preset: str | None = None, filters: dict | None = None, sort: str = "value", limit: int = 50,
           offset: int = 0) -> dict:
    f = filters or {}
    k = bb_sigma(f)
    d = latest_date()
    if d is None:
        return {"date": None, "total": 0, "bb_sigma": k, "items": []}
    where, params = build_where(preset, f)
    params.update({"d": d, "limit": max(1, min(int(limit), MAX_LIMIT)), "offset": max(0, int(offset))})
    cond = " AND ".join(where)
    table = f"{CLICKHOUSE_DB}.screener_daily FINAL"
    total = int(_query(f"SELECT count() FROM {table} WHERE {cond}", params)[0][0])
    rows = _query(f"SELECT {', '.join(_SCREEN_COLUMNS)} FROM {table} WHERE {cond} "
                  f"ORDER BY {SORTS.get(sort, SORTS['value'])} LIMIT %(limit)s OFFSET %(offset)s", params)
    records = [dict(zip(_SCREEN_COLUMNS, r)) for r in rows]
    names = _names([r["ticker"] for r in records])
    sectors = _sector_names(sorted({r["sector_m"] for r in records}))
    items = [{
        "ticker": r["ticker"], "name": names.get(r["ticker"], r["ticker"]), "market": r["market"],
        "sector_name": sectors.get(r["sector_m"]), "close": r["close"], "chg_1d": r["chg_1d"], "value": r["value"],
        "mcap": r["mcap"], "vol_ratio20": r["vol_ratio20"], "rsi14": r["rsi14"], "ma_order": int(r["ma_order"]),
        "is_new_high": bool(r["is_new_high"]), "gc_days": r["gc_days"], "vp_above_pct": r["vp_above_pct"],
        "per": r["per"], "pbr": r["pbr"], "roe": r["roe"],
        "bb_position": bb_position(r["close"], r["ma20"], r["std20"], k),
        "bb_width_pct": bb_width_pct(r["ma20"], r["std20"], k),
    } for r in records]
    return {"date": d.isoformat(), "total": total, "bb_sigma": k, "items": items}
```

- [ ] **4-4. GraphQL 타입** — `backend/apps/stock_api/graphql/types.py`

바꾸기 전(`CanslimScore` 끝):
```python
    history: list[CanslimHistoryPoint]
    market_status: str | None
```
바꾼 뒤:
```python
    history: list[CanslimHistoryPoint]
    market_status: str | None


@strawberry.input(description="조건검색 필터 — 모두 선택. 금액은 억 원, 비율은 %(거래량 비율은 배)")
class ScreenerFilterInput:
    market: str | None = None  # ALL | KOSPI | KOSDAQ
    price_min: float | None = None
    price_max: float | None = None
    mcap_min: float | None = None
    mcap_max: float | None = None
    value_min: float | None = None
    liquid_only: bool = True  # 20일 평균 거래대금 10억·종가 1,000원 이상만
    vol_ratio_min: float | None = None
    rsi_min: float | None = None
    rsi_max: float | None = None
    ma_order: str | None = None  # PERFECT | REVERSE
    bb_sigma: float | None = None  # 1 · 1.5 · 2 · 2.5 · 3 (그 밖은 2)
    bb_position: str | None = None  # ABOVE | BELOW | INSIDE
    bb_width_max: float | None = None
    vp_above_max: float | None = None
    roe_min: float | None = None
    per_min: float | None = None
    per_max: float | None = None
    pbr_min: float | None = None
    pbr_max: float | None = None
    debt_ratio_max: float | None = None
    sales_growth_min: float | None = None


@strawberry.type
class ScreenerItem:
    ticker: str
    name: str
    market: str
    sector_name: str | None
    close: float
    chg_1d: float | None
    value: float  # 거래대금(원, 종가×거래량 근사)
    mcap: float | None  # 시가총액(원)
    vol_ratio20: float | None  # 당일 거래량 / 직전 20일 평균
    rsi14: float | None
    ma_order: int  # 1 정배열 · -1 역배열 · 0 혼합
    is_new_high: bool
    gc_days: int | None  # 골든크로스(20/60) 뒤 지난 거래일 0~2
    vp_above_pct: float | None  # 현재가 위 매물 비율(%)
    per: float | None
    pbr: float | None
    roe: float | None
    bb_position: str | None  # 요청 σ 기준 ABOVE | BELOW | INSIDE
    bb_width_pct: float | None


@strawberry.type
class ScreenerScreen:
    date: str | None  # 계산된 날이 없으면 null(준비 중)
    total: int
    bb_sigma: float  # 볼린저 위치·폭에 쓴 σ
    items: list[ScreenerItem]
```

- [ ] **4-5. 리졸버** — `backend/apps/stock_api/graphql/schema.py`

(1) 타입 import — 바꾸기 전:
```python
    MarketOverview,
    Stock,
```
바꾼 뒤:
```python
    MarketOverview,
    ScreenerFilterInput,
    ScreenerItem,
    ScreenerScreen,
    Stock,
```

(2) 서비스 import — 바꾸기 전:
```python
from apps.stock_api.services import market_query
```
바꾼 뒤:
```python
from apps.stock_api.services import market_query
from apps.stock_api.services import screener_query
```

(3) 리졸버 — 바꾸기 전:
```python
    # ------------------------------------------------------------ 시장 탭 (공개)
```
바꾼 뒤:
```python
    # ------------------------------------------------------------ 조건검색 (공개)
    @strawberry.field(description="조건검색 — 프리셋(volume_surge·golden_cross·oversold·new_high)과 필터(AND), "
                                  "최신 기준일. sort: value|chg|vol_ratio|rsi|mcap|vp_above")
    def screener_screen(
        self,
        preset: str | None = None,
        filters: ScreenerFilterInput | None = None,
        sort: str = "value",
        limit: int = 50,
        offset: int = 0,
    ) -> ScreenerScreen:
        out = screener_query.screen(preset=preset, filters=dict(vars(filters)) if filters else {}, sort=sort,
                                    limit=limit, offset=offset)
        return ScreenerScreen(date=out["date"], total=out["total"], bb_sigma=out["bb_sigma"],
                              items=[ScreenerItem(**it) for it in out["items"]])

    # ------------------------------------------------------------ 시장 탭 (공개)
```

- [ ] **4-6. 통과 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_query.py`
Expected: `13 passed`

`test_graphql_wiring` 이 `filters` 사전에서 `KeyError`·`AttributeError` 로 실패하면(Strawberry input 객체에 필드 외 속성이 있거나 없는 경우) `dict(vars(filters))` 를 `{k: getattr(filters, k) for k in ScreenerFilterInput.__annotations__}` 로 바꾸고 다시 돌린다. 이 경우 `schema.py` 의 해당 한 줄만 바꾼다.

- [ ] **4-7. 전체 확인**

Run: `cd backend && uv run pytest -p no:warnings`
Expected: `1402 passed`

- [ ] **4-8. 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/apps/stock_api/services/screener_query.py
git add backend/tests/test_screener_query.py
git add backend/apps/stock_api/graphql/types.py
git add backend/apps/stock_api/graphql/schema.py
git commit -m "$(cat <<'EOF'
feat(stock_api): 조건검색 GraphQL screenerScreen — 프리셋 4종(서버 상수)·필터 화이트리스트·범위 검증·볼린저 σ·정렬·페이징

사용자 값은 바인딩만, 억 원 단위 시총·거래대금은 원으로 바꿔 비교

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 5: 웹 — 타입 · API · 순수 함수 + 조건검색 탭(프리셋 칩·필터 패널·목록·상세) + 라우트

**파일:**
- 생성: `web_client/src/types/finder.ts`
- 생성: `web_client/src/lib/finder.ts`
- 생성: `web_client/src/api/finder.ts`
- 생성: `web_client/src/components/finder/FinderFilters.tsx`
- 생성: `web_client/src/components/finder/FinderList.tsx`
- 생성: `web_client/src/components/finder/FinderDetail.tsx`
- 생성: `web_client/src/pages/screener/FinderTab.tsx`
- 수정: `web_client/src/App.tsx`(lazy import 1줄, 라우트 1줄, 주석)
- 수정: `web_client/src/pages/screener/ScreenerLayout.tsx`(TABS 1줄, 주석)

웹에는 테스트 러너가 없다. 같은 규칙의 모바일 순수 함수를 작업 6 에서 jest 로 고정한다. 커밋은 두 번이다(5-A 타입·API·순수 함수, 5-B 화면·라우트).

#### 5-A. 타입 · 순수 함수 · API

- [ ] **5-1. 타입** — `web_client/src/types/finder.ts`

```ts
// 조건검색(stock_api GraphQL screenerScreen) 타입 — 모바일 mobile/src/features/finder/types.ts 와 같다.
import type { MarketFilter } from './screener'

export type FinderPreset = 'volume_surge' | 'golden_cross' | 'oversold' | 'new_high'
export type FinderSort = 'value' | 'chg' | 'vol_ratio' | 'rsi' | 'mcap' | 'vp_above'
export type MaOrderFilter = 'PERFECT' | 'REVERSE'
export type BbPosition = 'ABOVE' | 'BELOW' | 'INSIDE'

/** 숫자 입력 필터 — 금액은 억 원, 비율은 %(거래량 비율은 배). 빈칸(null)이면 조건 없음 */
export type NumKey =
  | 'priceMin' | 'priceMax' | 'mcapMin' | 'mcapMax' | 'valueMin' | 'volRatioMin' | 'rsiMin' | 'rsiMax'
  | 'bbWidthMax' | 'vpAboveMax' | 'roeMin' | 'perMin' | 'perMax' | 'pbrMin' | 'pbrMax' | 'debtRatioMax'
  | 'salesGrowthMin'

export interface FinderChoices {
  market: MarketFilter
  liquidOnly: boolean
  maOrder: MaOrderFilter | null
  bbSigma: number // 1 · 1.5 · 2 · 2.5 · 3
  bbPosition: BbPosition | null
}

export type FinderFilters = FinderChoices & Record<NumKey, number | null>
/** 입력 중인 초안 — 숫자 칸은 글자 그대로 들고 [적용] 때 숫자로 바꾼다 */
export type FinderDraft = FinderChoices & Record<NumKey, string>

export interface FinderQuery {
  preset: FinderPreset | null
  sort: FinderSort
  filters: FinderFilters
}

export interface FinderItem {
  ticker: string
  name: string
  market: string
  sectorName: string | null
  close: number
  chg1d: number | null
  value: number // 거래대금(원)
  mcap: number | null // 시가총액(원)
  volRatio20: number | null
  rsi14: number | null
  maOrder: number // 1 정배열 · -1 역배열 · 0 혼합
  isNewHigh: boolean
  gcDays: number | null
  vpAbovePct: number | null
  per: number | null
  pbr: number | null
  roe: number | null
  bbPosition: BbPosition | null
  bbWidthPct: number | null
}

export interface FinderScreen {
  date: string | null // null 이면 아직 계산 전(준비 중)
  total: number
  bbSigma: number
  items: FinderItem[]
}
```

- [ ] **5-2. 순수 함수** — `web_client/src/lib/finder.ts`

```ts
// 조건검색 화면용 순수 함수 — 프리셋·정렬 상수, 기본 필터, 입력 변환, 적용 수, 같은 조건 비교, 배지 글자.
// 모바일 mobile/src/features/finder/finder.ts 와 같은 규칙이다(모바일 jest 가 고정 — 바꾸면 둘 다 바꿀 것).
import type {
  BbPosition,
  FinderDraft,
  FinderFilters,
  FinderPreset,
  FinderQuery,
  FinderSort,
  NumKey,
} from '../types/finder'

/** 한 번에 받는 개수(서버 MAX_LIMIT 200 이하) */
export const FINDER_PAGE = 50

/** 프리셋 — 키는 서버 screener_query.PRESETS 와 같은 문자열 */
export const PRESETS: { key: FinderPreset; label: string; description: string }[] = [
  { key: 'volume_surge', label: '거래량 급증', description: '오늘 거래량이 최근 20거래일 평균의 2배 이상인 종목' },
  { key: 'golden_cross', label: '골든크로스', description: '20일선이 60일선을 뚫고 올라선 지 3거래일 이내인 종목' },
  { key: 'oversold', label: '과매도', description: 'RSI(14)가 30 이하로 많이 떨어진 종목' },
  { key: 'new_high', label: '신고가', description: '오늘 고가가 직전 1년(52주) 최고가를 넘긴 종목' },
]

export const FINDER_SORTS: { key: FinderSort; label: string }[] = [
  { key: 'value', label: '거래대금' },
  { key: 'chg', label: '등락률' },
  { key: 'vol_ratio', label: '거래량 비율' },
  { key: 'rsi', label: 'RSI' },
  { key: 'mcap', label: '시가총액' },
  { key: 'vp_above', label: '위쪽 매물 적은 순' },
]

export const BB_SIGMAS = [1, 1.5, 2, 2.5, 3]

export const NUM_KEYS: NumKey[] = [
  'priceMin', 'priceMax', 'mcapMin', 'mcapMax', 'valueMin', 'volRatioMin', 'rsiMin', 'rsiMax', 'bbWidthMax',
  'vpAboveMax', 'roeMin', 'perMin', 'perMax', 'pbrMin', 'pbrMax', 'debtRatioMax', 'salesGrowthMin',
]

const EMPTY_NUMS = Object.fromEntries(NUM_KEYS.map((k) => [k, null])) as Record<NumKey, number | null>

export const DEFAULT_FINDER_FILTERS: FinderFilters = {
  market: 'ALL',
  liquidOnly: true,
  maOrder: null,
  bbSigma: 2,
  bbPosition: null,
  ...EMPTY_NUMS,
}

/** 입력 글자 → 숫자. 콤마·앞뒤 공백은 무시, 빈칸·숫자 아님·무한대는 null */
export function parseNum(text: string): number | null {
  const t = text.replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function toDraft(f: FinderFilters): FinderDraft {
  const nums = Object.fromEntries(NUM_KEYS.map((k) => [k, f[k] === null ? '' : String(f[k])])) as Record<NumKey, string>
  return { market: f.market, liquidOnly: f.liquidOnly, maOrder: f.maOrder, bbSigma: f.bbSigma, bbPosition: f.bbPosition, ...nums }
}

export function fromDraft(d: FinderDraft): FinderFilters {
  const nums = Object.fromEntries(NUM_KEYS.map((k) => [k, parseNum(d[k])])) as Record<NumKey, number | null>
  return { market: d.market, liquidOnly: d.liquidOnly, maOrder: d.maOrder, bbSigma: d.bbSigma, bbPosition: d.bbPosition, ...nums }
}

/** GraphQL ScreenerFilterInput 변수 — 빈 조건은 빼고, σ 는 볼린저 조건이 있을 때만 보낸다 */
export function toFilterInput(f: FinderFilters): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { market: f.market, liquidOnly: f.liquidOnly }
  if (f.maOrder) out.maOrder = f.maOrder
  if (f.bbPosition) out.bbPosition = f.bbPosition
  for (const k of NUM_KEYS) {
    const v = f[k]
    if (v !== null) out[k] = v
  }
  if (f.bbPosition || f.bbWidthMax !== null) out.bbSigma = f.bbSigma
  return out
}

/** 적용 중인 필터 수 — 시장(전체 아님)·거래 활발 끔·배열·볼린저 위치·숫자 칸마다 1. σ 만 바꾼 것·정렬·프리셋은 세지 않음 */
export function activeFilterCount(f: FinderFilters): number {
  let n = 0
  if (f.market !== 'ALL') n += 1
  if (!f.liquidOnly) n += 1
  if (f.maOrder) n += 1
  if (f.bbPosition) n += 1
  for (const k of NUM_KEYS) if (f[k] !== null) n += 1
  return n
}

/** 프리셋·정렬·필터가 모두 같으면 다시 조회할 필요가 없다 */
export function sameFinderQuery(a: FinderQuery, b: FinderQuery): boolean {
  if (a.preset !== b.preset || a.sort !== b.sort) return false
  const keys = Object.keys(a.filters) as (keyof FinderFilters)[]
  return keys.every((k) => a.filters[k] === b.filters[k])
}

export function sigmaLabel(s: number): string {
  return `${s}σ`
}

export function maOrderLabel(order: number): string | null {
  if (order === 1) return '정배열'
  if (order === -1) return '역배열'
  return null
}

export function gcLabel(days: number | null): string | null {
  if (days === null) return null
  return days === 0 ? '골든크로스 오늘' : `골든크로스 ${days}일 전`
}

export function bbPositionLabel(p: BbPosition | null): string {
  if (p === 'ABOVE') return '상단 돌파'
  if (p === 'BELOW') return '하단 이탈'
  if (p === 'INSIDE') return '밴드 안'
  return '–'
}
```

- [ ] **5-3. API** — `web_client/src/api/finder.ts`

```ts
import { gql } from './screener'
import { FINDER_PAGE, toFilterInput } from '../lib/finder'
import type { FinderQuery, FinderScreen } from '../types/finder'

// stock_api GraphQL 조건검색(공개 — 로그인 불필요). 쿼리 문자열은 backend/tests/test_screener_contract.py 가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.
// 문자열 안에 ${...} 끼워 넣기·백틱을 쓰지 말 것(테스트가 글자 그대로 실행한다).

export const FINDER_QUERY = `query ScreenerScreen($preset: String, $filters: ScreenerFilterInput, $sort: String!,
  $limit: Int!, $offset: Int!) {
  screenerScreen(preset: $preset, filters: $filters, sort: $sort, limit: $limit, offset: $offset) {
    date total bbSigma
    items {
      ticker name market sectorName close chg1d value mcap volRatio20 rsi14 maOrder isNewHigh gcDays vpAbovePct
      per pbr roe bbPosition bbWidthPct
    }
  }
}`

/** 조건검색 목록(offset 부터 50개) */
export async function getFinderScreen(q: FinderQuery, offset = 0): Promise<FinderScreen> {
  const res = await gql<{ screenerScreen: FinderScreen }>(FINDER_QUERY, {
    preset: q.preset,
    filters: toFilterInput(q.filters),
    sort: q.sort,
    limit: FINDER_PAGE,
    offset,
  })
  return res.screenerScreen
}
```

- [ ] **5-4. 타입 검사**

Run: `cd web_client && npx tsc --noEmit`
Expected: 출력 없음(오류 0)

- [ ] **5-5. 커밋(5-A)**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/types/finder.ts
git add web_client/src/lib/finder.ts
git add web_client/src/api/finder.ts
git commit -m "$(cat <<'EOF'
feat(web): 조건검색 타입·순수 함수·API — 프리셋·정렬 상수, 필터 기본값·입력 변환·적용 수, screenerScreen 쿼리

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

#### 5-B. 화면 · 라우트

- [ ] **5-6. 필터 패널** — `web_client/src/components/finder/FinderFilters.tsx`

```tsx
import { useState, type ReactNode } from 'react'
import Button from '../ui/Button'
import { chipClass } from '../ui/Chip'
import { BB_SIGMAS, DEFAULT_FINDER_FILTERS, fromDraft, sigmaLabel, toDraft } from '../../lib/finder'
import type { BbPosition, FinderDraft, FinderFilters as Filters, MaOrderFilter, NumKey } from '../../types/finder'
import type { MarketFilter } from '../../types/screener'

const MARKETS: { key: MarketFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'KOSPI', label: 'KOSPI' },
  { key: 'KOSDAQ', label: 'KOSDAQ' },
]
const MA_ORDERS: { key: MaOrderFilter | null; label: string }[] = [
  { key: null, label: '무관' },
  { key: 'PERFECT', label: '정배열' },
  { key: 'REVERSE', label: '역배열' },
]
const BB_POSITIONS: { key: BbPosition | null; label: string }[] = [
  { key: null, label: '무관' },
  { key: 'ABOVE', label: '상단 돌파' },
  { key: 'BELOW', label: '하단 이탈' },
  { key: 'INSIDE', label: '밴드 안' },
]

// 한 줄 — 왼쪽 제목 + 오른쪽 입력들(좁은 화면에서는 줄바꿈)
function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-xs font-medium text-ink-muted">{title}</span>
      {children}
    </div>
  )
}

// 숫자 입력 한 칸 — 빈칸이면 조건 없음
function NumField({ label, value, unit, onChange }: { label: string; value: string; unit?: string; onChange: (v: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={label}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded-btn bg-fill px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted/70 focus:outline-none focus:ring-1 focus:ring-brand"
      />
      {unit && <span className="text-xs text-ink-muted">{unit}</span>}
    </span>
  )
}

interface Props {
  value: Filters
  onApply: (f: Filters) => void
}

// 커스텀 필터 패널 — 초안만 바꾸고 [적용]에서 반영. [초기화]는 초안을 기본값으로(적용은 따로). 패널을 닫으면 초안은 버린다.
export default function FinderFilters({ value, onApply }: Props) {
  const [draft, setDraft] = useState<FinderDraft>(() => toDraft(value))
  const set = (patch: Partial<FinderDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const num = (key: NumKey, label: string, unit?: string) => (
    <NumField label={label} unit={unit} value={draft[key]} onChange={(v) => set({ [key]: v } as Partial<FinderDraft>)} />
  )

  return (
    <div className="space-y-3">
      <Row title="시장">
        {MARKETS.map((m) => (
          <button key={m.key} type="button" className={chipClass(draft.market === m.key)} onClick={() => set({ market: m.key })}>
            {m.label}
          </button>
        ))}
      </Row>
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" checked={draft.liquidOnly} onChange={(e) => set({ liquidOnly: e.target.checked })} />
        거래가 활발한 종목만(하루 평균 거래대금 10억 원·주가 1,000원 이상)
      </label>
      <Row title="가격">{num('priceMin', '최소', '원')}<span className="text-ink-muted">~</span>{num('priceMax', '최대', '원')}</Row>
      <Row title="시가총액">{num('mcapMin', '최소', '억')}<span className="text-ink-muted">~</span>{num('mcapMax', '최대', '억')}</Row>
      <Row title="거래대금">{num('valueMin', '최소', '억 이상')}</Row>
      <Row title="거래량(20일 평균 대비)">{num('volRatioMin', '예: 2', '배 이상')}</Row>
      <Row title="RSI(14)">{num('rsiMin', '최소')}<span className="text-ink-muted">~</span>{num('rsiMax', '최대')}</Row>
      <Row title="이동평균 배열">
        {MA_ORDERS.map((m) => (
          <button key={m.label} type="button" className={chipClass(draft.maOrder === m.key)} onClick={() => set({ maOrder: m.key })}>
            {m.label}
          </button>
        ))}
      </Row>
      <Row title="볼린저 σ">
        {BB_SIGMAS.map((s) => (
          <button key={s} type="button" className={chipClass(draft.bbSigma === s)} onClick={() => set({ bbSigma: s })}>
            {sigmaLabel(s)}
          </button>
        ))}
      </Row>
      <Row title="볼린저 위치">
        {BB_POSITIONS.map((p) => (
          <button key={p.label} type="button" className={chipClass(draft.bbPosition === p.key)} onClick={() => set({ bbPosition: p.key })}>
            {p.label}
          </button>
        ))}
      </Row>
      <Row title="볼린저 밴드폭">{num('bbWidthMax', '예: 10', '% 이하')}</Row>
      <Row title="위쪽 매물(120일)">{num('vpAboveMax', '예: 20', '% 이하')}</Row>
      <Row title="ROE">{num('roeMin', '최소', '% 이상')}</Row>
      <Row title="PER">{num('perMin', '최소', '배')}<span className="text-ink-muted">~</span>{num('perMax', '최대', '배')}</Row>
      <Row title="PBR">{num('pbrMin', '최소', '배')}<span className="text-ink-muted">~</span>{num('pbrMax', '최대', '배')}</Row>
      <Row title="부채비율">{num('debtRatioMax', '최대', '% 이하')}</Row>
      <Row title="매출 성장률">{num('salesGrowthMin', '최소', '% 이상')}</Row>
      <p className="text-xs text-ink-muted">재무(ROE·PER·PBR·부채비율·매출 성장률)는 최신 연간 결산 기준이에요. 빈칸은 조건 없음.</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setDraft(toDraft(DEFAULT_FINDER_FILTERS))}>초기화</Button>
        <Button onClick={() => onApply(fromDraft(draft))}>적용</Button>
      </div>
    </div>
  )
}
```

- [ ] **5-7. 목록** — `web_client/src/components/finder/FinderList.tsx`

```tsx
import type { ReactNode } from 'react'
import { gcLabel, maOrderLabel } from '../../lib/finder'
import { formatAmount, formatPct, formatPrice, pnlClass } from '../../lib/format'
import type { FinderItem } from '../../types/finder'

type Tone = 'up' | 'down' | 'brand' | 'muted'
const TONE: Record<Tone, string> = {
  up: 'bg-up-soft text-up',
  down: 'bg-down-soft text-down',
  brand: 'bg-brand-soft text-brand',
  muted: 'bg-fill text-ink-muted',
}

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TONE[tone]}`}>{children}</span>
}

// 지표 배지 — 신고가·골든크로스·RSI(과매도 파랑·과열 빨강)·배열(정배열 빨강·역배열 파랑)
function Badges({ it }: { it: FinderItem }) {
  const gc = gcLabel(it.gcDays)
  const order = maOrderLabel(it.maOrder)
  return (
    <>
      {it.isNewHigh && <Badge tone="up">신고가</Badge>}
      {gc && <Badge tone="brand">{gc}</Badge>}
      {it.rsi14 !== null && (
        <Badge tone={it.rsi14 <= 30 ? 'down' : it.rsi14 >= 70 ? 'up' : 'muted'}>RSI {Math.round(it.rsi14)}</Badge>
      )}
      {order && <Badge tone={it.maOrder === 1 ? 'up' : 'down'}>{order}</Badge>}
    </>
  )
}

interface Props {
  items: FinderItem[]
  selected: string | null
  onSelect: (ticker: string) => void
  /** 좁은 화면: 선택한 행 아래에 펼쳐 보일 상세(넓은 화면은 오른쪽 패널이라 없음) */
  renderInline?: (item: FinderItem) => ReactNode
}

// 조건검색 목록 — 종목·시장/업종·배지·종가·등락률(상승 빨강·하락 파랑)·거래대금
export default function FinderList({ items, selected, onSelect, renderInline }: Props) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => {
        const active = it.ticker === selected
        return (
          <li key={it.ticker}>
            <button
              type="button"
              onClick={() => onSelect(it.ticker)}
              aria-expanded={renderInline ? active : undefined}
              className={`flex w-full items-center gap-3 px-1 py-3 text-left transition ${active ? 'bg-brand-soft/60' : 'hover:bg-fill/60'}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-bold text-ink">{it.name}</span>
                  <span className="shrink-0 text-xs text-ink-muted">{it.ticker}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badges it={it} />
                  <span className="text-xs text-ink-muted">{it.sectorName ?? it.market}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium text-ink">{formatPrice(it.close)}</div>
                <div className={`text-xs font-medium ${pnlClass(it.chg1d)}`}>{it.chg1d === null ? '–' : formatPct(it.chg1d)}</div>
                <div className="text-[11px] text-ink-muted">{formatAmount(it.value)}</div>
              </div>
            </button>
            {renderInline && active && <div className="pb-4">{renderInline(it)}</div>}
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **5-8. 상세** — `web_client/src/components/finder/FinderDetail.tsx`

```tsx
import { Link } from 'react-router-dom'
import StockDailyChart from '../screener/StockDailyChart'
import { bbPositionLabel, gcLabel, maOrderLabel, sigmaLabel } from '../../lib/finder'
import { formatAmount, formatPct, formatPrice, pnlClass } from '../../lib/format'
import type { FinderItem } from '../../types/finder'

const fixed = (n: number | null, digits: number, suffix: string) => (n === null ? '–' : `${n.toFixed(digits)}${suffix}`)

// 조건검색 상세 — 일봉 차트(50일선) + 지표 표 + 주도주 분석 링크. 목록 값으로 그려 추가 조회가 없다.
export default function FinderDetail({ item, bbSigma, date }: { item: FinderItem; bbSigma: number; date: string | null }) {
  const sigma = sigmaLabel(bbSigma)
  const rows: [string, string][] = [
    ['거래대금', formatAmount(item.value)],
    ['시가총액', item.mcap === null ? '–' : formatAmount(item.mcap)],
    ['거래량(20일 평균 대비)', fixed(item.volRatio20, 1, '배')],
    ['RSI(14)', fixed(item.rsi14, 1, '')],
    ['이동평균 배열', maOrderLabel(item.maOrder) ?? '혼합'],
    [`볼린저(${sigma}) 위치`, bbPositionLabel(item.bbPosition)],
    [`볼린저(${sigma}) 밴드폭`, fixed(item.bbWidthPct, 1, '%')],
    ['위쪽 매물(최근 120일)', fixed(item.vpAbovePct, 1, '%')],
    ['골든크로스(20·60일선)', gcLabel(item.gcDays) ?? '없음'],
    ['52주 신고가', item.isNewHigh ? '오늘 경신' : '아님'],
    ['PER', fixed(item.per, 1, '배')],
    ['PBR', fixed(item.pbr, 2, '배')],
    ['ROE', fixed(item.roe, 1, '%')],
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <h2 className="text-lg font-bold text-ink">{item.name}</h2>
            <span className="text-xs text-ink-muted">{item.ticker} · {item.sectorName ?? item.market}</span>
          </div>
          <p className="text-sm text-ink-muted">{formatPrice(item.close)}원 · {date ?? '–'} 종가</p>
        </div>
        <div className={`text-lg font-bold ${pnlClass(item.chg1d)}`}>{item.chg1d === null ? '–' : formatPct(item.chg1d)}</div>
      </div>

      <StockDailyChart ticker={item.ticker} high52w={null} />

      <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-line/60 py-1.5 text-sm">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <Link to={`/screener/leaders?ticker=${encodeURIComponent(item.ticker)}`} className="inline-block text-sm font-medium text-brand">
        주도주 분석(CANSLIM) 보기 →
      </Link>
      <p className="text-xs text-ink-muted">재무는 최신 연간 결산 기준이에요.</p>
    </div>
  )
}
```

- [ ] **5-9. 탭 화면** — `web_client/src/pages/screener/FinderTab.tsx`

```tsx
import { useEffect, useRef, useState } from 'react'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { chipClass } from '../../components/ui/Chip'
import FinderDetail from '../../components/finder/FinderDetail'
import FinderFilters from '../../components/finder/FinderFilters'
import FinderList from '../../components/finder/FinderList'
import { getFinderScreen } from '../../api/finder'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { DEFAULT_FINDER_FILTERS, FINDER_PAGE, FINDER_SORTS, PRESETS, activeFilterCount, sameFinderQuery } from '../../lib/finder'
import type { FinderItem, FinderPreset, FinderQuery } from '../../types/finder'

const INITIAL_QUERY: FinderQuery = { preset: null, sort: 'value', filters: DEFAULT_FINDER_FILTERS }

// 스크리너 '조건검색' 탭 — 프리셋 칩(하나만)·필터 패널·정렬 칩·목록(50개씩 더 보기). 넓은 화면은 오른쪽 상세, 좁은 화면은 행 펼침.
export default function FinderTab() {
  const wide = useMediaQuery('(min-width: 1024px)')
  const [query, setQuery] = useState<FinderQuery>(INITIAL_QUERY)
  const [panelOpen, setPanelOpen] = useState(false)
  const [date, setDate] = useState<string | null>(null)
  const [bbSigma, setBbSigma] = useState(2)
  const [items, setItems] = useState<FinderItem[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  // 요청 번호 — 조건을 바꾼 뒤 늦게 온 '더 보기' 응답이 새 목록에 붙지 않게
  const seq = useRef(0)

  useEffect(() => {
    let cancelled = false
    seq.current += 1
    setState('loading')
    getFinderScreen(query)
      .then((s) => {
        if (cancelled) return
        setDate(s.date)
        setBbSigma(s.bbSigma)
        setItems(s.items)
        setTotal(s.total)
        setSelected((cur) => (s.items.some((i) => i.ticker === cur) ? cur : null))
        setState('ready')
      })
      .catch(() => !cancelled && setState('failed'))
    return () => {
      cancelled = true
    }
  }, [query])

  const update = (next: FinderQuery) => setQuery((cur) => (sameFinderQuery(cur, next) ? cur : next))
  const togglePreset = (p: FinderPreset) => update({ ...query, preset: query.preset === p ? null : p })

  const loadMore = () => {
    const id = seq.current
    setLoadingMore(true)
    getFinderScreen(query, items.length)
      .then((s) => {
        if (id !== seq.current) return
        setItems((cur) => {
          const seen = new Set(cur.map((x) => x.ticker))
          return [...cur, ...s.items.filter((x) => !seen.has(x.ticker))]
        })
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false))
  }

  // 넓은 화면은 첫 종목을 오른쪽에 바로 보여준다(좁은 화면은 누를 때만 펼침)
  const shown = selected ?? (wide ? items[0]?.ticker ?? null : null)
  const shownItem = items.find((i) => i.ticker === shown) ?? null
  const onSelect = (ticker: string) => setSelected((cur) => (!wide && cur === ticker ? null : ticker))
  const preset = PRESETS.find((p) => p.key === query.preset)
  const filterCount = activeFilterCount(query.filters)

  return (
    <div className="space-y-3 sm:space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">조건검색</h1>
        <p className="mt-0.5 text-sm text-ink-muted">자주 쓰는 조건(프리셋)이나 직접 고른 조건으로 종목을 찾습니다.</p>
      </div>

      <Card>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={query.preset === p.key}
              className={chipClass(query.preset === p.key)}
              onClick={() => togglePreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-ink-muted">{preset ? preset.description : '프리셋을 고르거나 필터로 조건을 정해 보세요.'}</p>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            aria-expanded={panelOpen}
            className={chipClass(panelOpen || filterCount > 0)}
            onClick={() => setPanelOpen((o) => !o)}
          >
            필터{filterCount > 0 ? ` ${filterCount}` : ''} {panelOpen ? '▲' : '▼'}
          </button>
          <span className="mx-1 w-px shrink-0 self-stretch bg-line" aria-hidden />
          {FINDER_SORTS.map((s) => (
            <button key={s.key} type="button" className={chipClass(query.sort === s.key)} onClick={() => update({ ...query, sort: s.key })}>
              {s.label}
            </button>
          ))}
        </div>
        {panelOpen && (
          <div className="mt-3 border-t border-line pt-3">
            <FinderFilters
              value={query.filters}
              onApply={(f) => {
                update({ ...query, filters: f })
                setPanelOpen(false)
              }}
            />
          </div>
        )}
      </Card>

      {state === 'failed' && (
        <Card><EmptyState emoji="⚠️" title="목록을 불러오지 못했어요" description="잠시 뒤 다시 시도해 주세요." /></Card>
      )}
      {state === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {state === 'ready' && date === null && (
        <Card><EmptyState emoji="🛠️" title="조건검색 데이터를 준비하고 있어요" description="매일 장 마감 후 계산돼요." /></Card>
      )}
      {state === 'ready' && date !== null && items.length === 0 && (
        <Card><EmptyState emoji="🔎" title="조건에 맞는 종목이 없어요" description="조건을 줄여 보세요." /></Card>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-4">
          <Card>
            <p className="mb-1 text-xs text-ink-muted">{total.toLocaleString('ko-KR')}개 종목</p>
            <FinderList
              items={items}
              selected={shown}
              onSelect={onSelect}
              renderInline={wide ? undefined : (it) => <FinderDetail item={it} bbSigma={bbSigma} date={date} />}
            />
            {items.length < total && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-2 w-full rounded-btn bg-fill py-2.5 text-sm font-medium text-ink disabled:opacity-60"
              >
                {loadingMore ? '불러오는 중…' : `더 보기 (${Math.min(FINDER_PAGE, total - items.length)}개)`}
              </button>
            )}
          </Card>
          {wide && shownItem && (
            <Card as="aside" className="lg:sticky lg:top-[7.5rem]">
              <FinderDetail item={shownItem} bbSigma={bbSigma} date={date} />
            </Card>
          )}
        </div>
      )}

      <p className="text-xs text-ink-muted">{date ?? '–'} 종가 기준 · 매일 20:30 갱신 · 투자 권유가 아닙니다</p>
    </div>
  )
}
```

- [ ] **5-10. 라우트** — `web_client/src/App.tsx`

(1) 바꾸기 전:
```tsx
const CalendarTab = lazy(() => import('./pages/screener/CalendarTab'))
```
바꾼 뒤:
```tsx
const CalendarTab = lazy(() => import('./pages/screener/CalendarTab'))
const FinderTab = lazy(() => import('./pages/screener/FinderTab'))
```

(2) 바꾸기 전:
```tsx
          {/* 탭: 시장 · 테마 · 업종 · 일정 · 주도주(CANSLIM). /screener 는 시장 탭으로 */}
```
바꾼 뒤:
```tsx
          {/* 탭: 시장 · 테마 · 업종 · 일정 · 주도주(CANSLIM) · 조건검색. /screener 는 시장 탭으로 */}
```

(3) 바꾸기 전:
```tsx
          <Route path="leaders" element={<ScreenerPage />} />
```
바꾼 뒤:
```tsx
          <Route path="leaders" element={<ScreenerPage />} />
          <Route path="finder" element={<FinderTab />} />
```

- [ ] **5-11. 탭** — `web_client/src/pages/screener/ScreenerLayout.tsx`

바꾸기 전:
```tsx
// 스크리너 공통 틀 — 탭(시장·테마·업종·일정·주도주) + 탭 화면. 탭마다 주소가 있어 새로고침·뒤로 가기·공유가 그대로 된다.
```
바꾼 뒤:
```tsx
// 스크리너 공통 틀 — 탭(시장·테마·업종·일정·주도주·조건검색) + 탭 화면. 탭마다 주소가 있어 새로고침·뒤로 가기·공유가 그대로 된다.
```

바꾸기 전:
```tsx
  { to: 'leaders', label: '주도주' },
]
```
바꾼 뒤:
```tsx
  { to: 'leaders', label: '주도주' },
  { to: 'finder', label: '조건검색' },
]
```

- [ ] **5-12. 타입 검사·린트**

Run: `cd web_client && npx tsc --noEmit`
Expected: 출력 없음(오류 0)

Run: `cd web_client && npx eslint src`
Expected: 마지막 줄 `✖ N problems (0 errors, N warnings)` — **errors 0**. 경고는 기존 26개에 `FinderTab.tsx` 의 `react-hooks/set-state-in-effect`(주도주 화면과 같은 패턴)가 더해질 수 있다.

- [ ] **5-13. 커밋(5-B)**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/components/finder/FinderFilters.tsx
git add web_client/src/components/finder/FinderList.tsx
git add web_client/src/components/finder/FinderDetail.tsx
git add web_client/src/pages/screener/FinderTab.tsx
git add web_client/src/App.tsx
git add web_client/src/pages/screener/ScreenerLayout.tsx
git commit -m "$(cat <<'EOF'
feat(web): 스크리너 '조건검색' 탭 — 프리셋 칩·필터 패널·정렬·목록(50개씩)·상세(일봉 차트·지표 표), /screener/finder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 6: 모바일 — 순수 로직 · 쿼리 · 훅 · 컴포넌트 · 섹션 · 칩 등록

**파일:**
- 수정: `mobile/src/features/leaders/canslim.ts`(`mergeLeaderPage` 타입 일반화, import 1줄)
- 생성: `mobile/src/features/finder/types.ts`
- 생성: `mobile/src/features/finder/finder.ts`
- 생성: `mobile/src/features/finder/finder.test.ts`
- 생성: `mobile/src/features/finder/api.ts`
- 생성: `mobile/src/features/finder/use-finder-screen.ts`
- 생성: `mobile/src/features/finder/components/preset-chips.tsx`
- 생성: `mobile/src/features/finder/components/finder-row.tsx`
- 생성: `mobile/src/features/finder/components/finder-filter-sheet.tsx`
- 생성: `mobile/src/features/finder/sections/finder-section.tsx`
- 수정: `mobile/src/app/(tabs)/screener.tsx`

jest 는 순수 로직(`*.test.ts`)만 본다. 화면은 타입 검사와 작업 9(실기기)로 확인한다. 커밋은 두 번이다(6-A 순수 로직·쿼리, 6-B 훅·화면).

#### 6-A. 순수 로직 · 쿼리

- [ ] **6-1. 페이지 병합 일반화** — `mobile/src/features/leaders/canslim.ts`

바꾸기 전:
```ts
import type { CanslimHistoryPoint, CanslimItem, LetterKey, LetterStatus, ScreenFilters } from './types';
```
바꾼 뒤(`CanslimItem` 은 이제 이 파일에서 쓰지 않는다):
```ts
import type { CanslimHistoryPoint, LetterKey, LetterStatus, ScreenFilters } from './types';
```

바꾸기 전:
```ts
/** 다음 페이지 이어 붙이기 — 같은 티커는 한 번만(순위가 밀려 겹쳐 와도 중복 행 없음) */
export function mergeLeaderPage(prev: CanslimItem[], next: CanslimItem[]): CanslimItem[] {
```
바꾼 뒤:
```ts
/** 다음 페이지 이어 붙이기 — 같은 티커는 한 번만(순위가 밀려 겹쳐 와도 중복 행 없음). 주도주·조건검색 공용 */
export function mergeLeaderPage<T extends { ticker: string }>(prev: T[], next: T[]): T[] {
```
(함수 본문은 그대로다. 기존 호출과 `canslim.test.ts` 는 타입 추론으로 그대로 통과한다.)

- [ ] **6-2. 타입** — `mobile/src/features/finder/types.ts`

```ts
// 조건검색(stock_api GraphQL screenerScreen) 타입 — 웹 web_client/src/types/finder.ts 와 같다.
import type { MarketFilter } from '@/features/leaders/types';

export type FinderPreset = 'volume_surge' | 'golden_cross' | 'oversold' | 'new_high';
export type FinderSort = 'value' | 'chg' | 'vol_ratio' | 'rsi' | 'mcap' | 'vp_above';
export type MaOrderFilter = 'PERFECT' | 'REVERSE';
export type BbPosition = 'ABOVE' | 'BELOW' | 'INSIDE';

/** 숫자 입력 필터 — 금액은 억 원, 비율은 %(거래량 비율은 배). 빈칸(null)이면 조건 없음 */
export type NumKey =
  | 'priceMin' | 'priceMax' | 'mcapMin' | 'mcapMax' | 'valueMin' | 'volRatioMin' | 'rsiMin' | 'rsiMax'
  | 'bbWidthMax' | 'vpAboveMax' | 'roeMin' | 'perMin' | 'perMax' | 'pbrMin' | 'pbrMax' | 'debtRatioMax'
  | 'salesGrowthMin';

export interface FinderChoices {
  market: MarketFilter;
  liquidOnly: boolean;
  maOrder: MaOrderFilter | null;
  bbSigma: number; // 1 · 1.5 · 2 · 2.5 · 3
  bbPosition: BbPosition | null;
}

export type FinderFilters = FinderChoices & Record<NumKey, number | null>;
/** 입력 중인 초안 — 숫자 칸은 글자 그대로 들고 [적용] 때 숫자로 바꾼다 */
export type FinderDraft = FinderChoices & Record<NumKey, string>;

export interface FinderQuery {
  preset: FinderPreset | null;
  sort: FinderSort;
  filters: FinderFilters;
}

export interface FinderItem {
  ticker: string;
  name: string;
  market: string;
  sectorName: string | null;
  close: number;
  chg1d: number | null;
  value: number; // 거래대금(원)
  mcap: number | null; // 시가총액(원)
  volRatio20: number | null;
  rsi14: number | null;
  maOrder: number; // 1 정배열 · -1 역배열 · 0 혼합
  isNewHigh: boolean;
  gcDays: number | null;
  vpAbovePct: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  bbPosition: BbPosition | null;
  bbWidthPct: number | null;
}

export interface FinderScreen {
  date: string | null; // null 이면 아직 계산 전(준비 중)
  total: number;
  bbSigma: number;
  items: FinderItem[];
}
```

- [ ] **6-3. 실패하는 테스트 작성** — `mobile/src/features/finder/finder.test.ts`

```ts
import { mergeLeaderPage } from '@/features/leaders/canslim';

import {
  activeFilterCount,
  BB_SIGMAS,
  bbPositionLabel,
  DEFAULT_FINDER_FILTERS,
  FINDER_PAGE,
  fromDraft,
  gcLabel,
  INITIAL_QUERY,
  maOrderLabel,
  NUM_KEYS,
  parseNum,
  PRESETS,
  rsiTone,
  sameFinderQuery,
  sigmaLabel,
  toDraft,
  toFilterInput,
  togglePreset,
} from './finder';
import type { FinderFilters, FinderItem } from './types';

const item = (ticker: string): FinderItem => ({
  ticker,
  name: ticker,
  market: 'KOSPI',
  sectorName: null,
  close: 1000,
  chg1d: 1.5,
  value: 1e9,
  mcap: null,
  volRatio20: 2.1,
  rsi14: 45,
  maOrder: 0,
  isNewHigh: false,
  gcDays: null,
  vpAbovePct: null,
  per: null,
  pbr: null,
  roe: null,
  bbPosition: null,
  bbWidthPct: null,
});

describe('조건검색 순수 함수', () => {
  it('parseNum — 빈칸·공백·콤마·음수·숫자 아님·무한대', () => {
    expect(parseNum('')).toBeNull();
    expect(parseNum('   ')).toBeNull();
    expect(parseNum(' 1,000 ')).toBe(1000);
    expect(parseNum('-3.5')).toBe(-3.5);
    expect(parseNum('abc')).toBeNull();
    expect(parseNum('1e999')).toBeNull();
  });

  it('toDraft → fromDraft 왕복', () => {
    const d = toDraft(DEFAULT_FINDER_FILTERS);
    expect(d.priceMin).toBe('');
    expect(fromDraft(d)).toEqual(DEFAULT_FINDER_FILTERS);
    const f: FinderFilters = { ...DEFAULT_FINDER_FILTERS, market: 'KOSDAQ', rsiMax: 30, roeMin: -5, bbSigma: 1.5 };
    expect(fromDraft(toDraft(f))).toEqual(f);
  });

  it('fromDraft — 잘못 쓴 숫자 칸은 조건 없음(null)', () => {
    const f = fromDraft({ ...toDraft(DEFAULT_FINDER_FILTERS), priceMin: '만원', perMax: '15' });
    expect(f.priceMin).toBeNull();
    expect(f.perMax).toBe(15);
  });

  it('toFilterInput — 기본값은 시장·거래 활발만 보낸다', () => {
    expect(toFilterInput(DEFAULT_FINDER_FILTERS)).toEqual({ market: 'ALL', liquidOnly: true });
  });

  it('toFilterInput — 값 있는 칸만, σ 는 볼린저 조건이 있을 때만', () => {
    const f: FinderFilters = { ...DEFAULT_FINDER_FILTERS, liquidOnly: false, mcapMin: 500, maOrder: 'PERFECT', bbSigma: 2.5 };
    expect(toFilterInput(f)).toEqual({ market: 'ALL', liquidOnly: false, mcapMin: 500, maOrder: 'PERFECT' });
    expect(toFilterInput({ ...f, bbPosition: 'BELOW' })).toEqual({
      market: 'ALL',
      liquidOnly: false,
      mcapMin: 500,
      maOrder: 'PERFECT',
      bbPosition: 'BELOW',
      bbSigma: 2.5,
    });
    expect(toFilterInput({ ...DEFAULT_FINDER_FILTERS, bbWidthMax: 10 })).toEqual({
      market: 'ALL',
      liquidOnly: true,
      bbWidthMax: 10,
      bbSigma: 2,
    });
  });

  it('activeFilterCount — 기본값은 0', () => {
    expect(activeFilterCount(DEFAULT_FINDER_FILTERS)).toBe(0);
  });

  it('activeFilterCount — 시장·거래 활발 끔·배열·볼린저 위치·숫자 칸마다 1, σ 만 바꾼 것은 0', () => {
    expect(activeFilterCount({ ...DEFAULT_FINDER_FILTERS, bbSigma: 3 })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_FINDER_FILTERS,
        market: 'KOSPI',
        liquidOnly: false,
        maOrder: 'REVERSE',
        bbPosition: 'ABOVE',
        priceMin: 1000,
        priceMax: 5000,
      }),
    ).toBe(6);
  });

  it('sameFinderQuery — 프리셋·정렬·필터가 모두 같을 때만 같다', () => {
    const a = INITIAL_QUERY;
    expect(sameFinderQuery(a, { ...a, filters: { ...a.filters } })).toBe(true);
    expect(sameFinderQuery(a, { ...a, preset: 'oversold' })).toBe(false);
    expect(sameFinderQuery(a, { ...a, sort: 'chg' })).toBe(false);
    expect(sameFinderQuery(a, { ...a, filters: { ...a.filters, rsiMax: 30 } })).toBe(false);
  });

  it('togglePreset — 같은 프리셋을 다시 누르면 해제, 다른 것은 바꾼다', () => {
    expect(togglePreset(null, 'oversold')).toBe('oversold');
    expect(togglePreset('oversold', 'oversold')).toBeNull();
    expect(togglePreset('oversold', 'new_high')).toBe('new_high');
  });

  it('상수 — 프리셋 키는 서버와 같고 페이지 50·숫자 칸 17·σ 5개', () => {
    expect(PRESETS.map((p) => p.key)).toEqual(['volume_surge', 'golden_cross', 'oversold', 'new_high']);
    expect(FINDER_PAGE).toBe(50);
    expect(NUM_KEYS).toHaveLength(17);
    expect(BB_SIGMAS).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(INITIAL_QUERY).toEqual({ preset: null, sort: 'value', filters: DEFAULT_FINDER_FILTERS });
  });

  it('배지·표 글자', () => {
    expect(gcLabel(null)).toBeNull();
    expect(gcLabel(0)).toBe('골든크로스 오늘');
    expect(gcLabel(2)).toBe('골든크로스 2일 전');
    expect(maOrderLabel(1)).toBe('정배열');
    expect(maOrderLabel(-1)).toBe('역배열');
    expect(maOrderLabel(0)).toBeNull();
    expect(bbPositionLabel('ABOVE')).toBe('상단 돌파');
    expect(bbPositionLabel('BELOW')).toBe('하단 이탈');
    expect(bbPositionLabel('INSIDE')).toBe('밴드 안');
    expect(bbPositionLabel(null)).toBe('–');
    expect(sigmaLabel(1.5)).toBe('1.5σ');
    expect(sigmaLabel(2)).toBe('2σ');
  });

  it('rsiTone — 30 이하 파랑(down)·70 이상 빨강(up)·그 밖 flat', () => {
    expect(rsiTone(30)).toBe('down');
    expect(rsiTone(70)).toBe('up');
    expect(rsiTone(50)).toBe('flat');
  });

  it('mergeLeaderPage — 조건검색 항목도 같은 티커는 한 번만', () => {
    expect(mergeLeaderPage([item('A'), item('B')], [item('B'), item('C')]).map((x) => x.ticker)).toEqual(['A', 'B', 'C']);
  });
});
```

- [ ] **6-4. 실패 확인**

Run: `cd mobile && npx jest src/features/finder`
Expected: FAIL — `Cannot find module './finder'`

- [ ] **6-5. 구현** — `mobile/src/features/finder/finder.ts`

```ts
// 조건검색 화면용 순수 함수 — 웹 web_client/src/lib/finder.ts 와 같은 규칙(여기 jest 가 고정 — 바꾸면 둘 다 바꿀 것)
// + 프리셋 토글·RSI 색 구분(테마 키).
import { LEADERS_PAGE } from '@/features/leaders/canslim';
import type { Tone } from '@/features/market/format';

import type {
  BbPosition,
  FinderDraft,
  FinderFilters,
  FinderPreset,
  FinderQuery,
  FinderSort,
  NumKey,
} from './types';

/** 한 번에 받는 개수 — 주도주와 같아야 hasMoreLeaders 판정을 그대로 쓸 수 있다(서버 MAX_LIMIT 200 이하) */
export const FINDER_PAGE = LEADERS_PAGE;

/** 프리셋 — 키는 서버 screener_query.PRESETS 와 같은 문자열 */
export const PRESETS: { key: FinderPreset; label: string; description: string }[] = [
  { key: 'volume_surge', label: '거래량 급증', description: '오늘 거래량이 최근 20거래일 평균의 2배 이상인 종목' },
  { key: 'golden_cross', label: '골든크로스', description: '20일선이 60일선을 뚫고 올라선 지 3거래일 이내인 종목' },
  { key: 'oversold', label: '과매도', description: 'RSI(14)가 30 이하로 많이 떨어진 종목' },
  { key: 'new_high', label: '신고가', description: '오늘 고가가 직전 1년(52주) 최고가를 넘긴 종목' },
];

export const FINDER_SORTS: { key: FinderSort; label: string }[] = [
  { key: 'value', label: '거래대금' },
  { key: 'chg', label: '등락률' },
  { key: 'vol_ratio', label: '거래량 비율' },
  { key: 'rsi', label: 'RSI' },
  { key: 'mcap', label: '시가총액' },
  { key: 'vp_above', label: '위쪽 매물 적은 순' },
];

export const BB_SIGMAS = [1, 1.5, 2, 2.5, 3];

export const NUM_KEYS: NumKey[] = [
  'priceMin', 'priceMax', 'mcapMin', 'mcapMax', 'valueMin', 'volRatioMin', 'rsiMin', 'rsiMax', 'bbWidthMax',
  'vpAboveMax', 'roeMin', 'perMin', 'perMax', 'pbrMin', 'pbrMax', 'debtRatioMax', 'salesGrowthMin',
];

const EMPTY_NUMS = Object.fromEntries(NUM_KEYS.map((k) => [k, null])) as Record<NumKey, number | null>;

export const DEFAULT_FINDER_FILTERS: FinderFilters = {
  market: 'ALL',
  liquidOnly: true,
  maOrder: null,
  bbSigma: 2,
  bbPosition: null,
  ...EMPTY_NUMS,
};

export const INITIAL_QUERY: FinderQuery = { preset: null, sort: 'value', filters: DEFAULT_FINDER_FILTERS };

/** 입력 글자 → 숫자. 콤마·앞뒤 공백은 무시, 빈칸·숫자 아님·무한대는 null */
export function parseNum(text: string): number | null {
  const t = text.replace(/,/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function toDraft(f: FinderFilters): FinderDraft {
  const nums = Object.fromEntries(NUM_KEYS.map((k) => [k, f[k] === null ? '' : String(f[k])])) as Record<NumKey, string>;
  return { market: f.market, liquidOnly: f.liquidOnly, maOrder: f.maOrder, bbSigma: f.bbSigma, bbPosition: f.bbPosition, ...nums };
}

export function fromDraft(d: FinderDraft): FinderFilters {
  const nums = Object.fromEntries(NUM_KEYS.map((k) => [k, parseNum(d[k])])) as Record<NumKey, number | null>;
  return { market: d.market, liquidOnly: d.liquidOnly, maOrder: d.maOrder, bbSigma: d.bbSigma, bbPosition: d.bbPosition, ...nums };
}

/** GraphQL ScreenerFilterInput 변수 — 빈 조건은 빼고, σ 는 볼린저 조건이 있을 때만 보낸다 */
export function toFilterInput(f: FinderFilters): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { market: f.market, liquidOnly: f.liquidOnly };
  if (f.maOrder) out.maOrder = f.maOrder;
  if (f.bbPosition) out.bbPosition = f.bbPosition;
  for (const k of NUM_KEYS) {
    const v = f[k];
    if (v !== null) out[k] = v;
  }
  if (f.bbPosition || f.bbWidthMax !== null) out.bbSigma = f.bbSigma;
  return out;
}

/** 적용 중인 필터 수 — 시장(전체 아님)·거래 활발 끔·배열·볼린저 위치·숫자 칸마다 1. σ 만 바꾼 것·정렬·프리셋은 세지 않음 */
export function activeFilterCount(f: FinderFilters): number {
  let n = 0;
  if (f.market !== 'ALL') n += 1;
  if (!f.liquidOnly) n += 1;
  if (f.maOrder) n += 1;
  if (f.bbPosition) n += 1;
  for (const k of NUM_KEYS) if (f[k] !== null) n += 1;
  return n;
}

/** 프리셋·정렬·필터가 모두 같으면 다시 조회할 필요가 없다 */
export function sameFinderQuery(a: FinderQuery, b: FinderQuery): boolean {
  if (a.preset !== b.preset || a.sort !== b.sort) return false;
  const keys = Object.keys(a.filters) as (keyof FinderFilters)[];
  return keys.every((k) => a.filters[k] === b.filters[k]);
}

/** 프리셋은 하나만 — 같은 것을 다시 누르면 해제 */
export function togglePreset(current: FinderPreset | null, p: FinderPreset): FinderPreset | null {
  return current === p ? null : p;
}

export function sigmaLabel(s: number): string {
  return `${s}σ`;
}

export function maOrderLabel(order: number): string | null {
  if (order === 1) return '정배열';
  if (order === -1) return '역배열';
  return null;
}

export function gcLabel(days: number | null): string | null {
  if (days === null) return null;
  return days === 0 ? '골든크로스 오늘' : `골든크로스 ${days}일 전`;
}

export function bbPositionLabel(p: BbPosition | null): string {
  if (p === 'ABOVE') return '상단 돌파';
  if (p === 'BELOW') return '하단 이탈';
  if (p === 'INSIDE') return '밴드 안';
  return '–';
}

/** RSI 배지 색 — 30 이하 과매도 down(파랑), 70 이상 과열 up(빨강), 그 밖 flat */
export function rsiTone(rsi: number): Tone {
  if (rsi <= 30) return 'down';
  if (rsi >= 70) return 'up';
  return 'flat';
}
```

- [ ] **6-6. 쿼리·조회 함수** — `mobile/src/features/finder/api.ts`

```ts
import { stockRequest } from '@/lib/api';

import { FINDER_PAGE, toFilterInput } from './finder';
import type { FinderQuery, FinderScreen } from './types';

// stock_api GraphQL 조건검색(공개). 쿼리 문자열은 backend/tests/test_screener_contract.py 계약 테스트가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.
// 문자열 안에 ${...} 끼워 넣기·백틱을 쓰지 말 것(테스트가 글자 그대로 실행한다).

export const FINDER_QUERY = `query ScreenerScreen($preset: String, $filters: ScreenerFilterInput, $sort: String!,
  $limit: Int!, $offset: Int!) {
  screenerScreen(preset: $preset, filters: $filters, sort: $sort, limit: $limit, offset: $offset) {
    date total bbSigma
    items {
      ticker name market sectorName close chg1d value mcap volRatio20 rsi14 maOrder isNewHigh gcDays vpAbovePct
      per pbr roe bbPosition bbWidthPct
    }
  }
}`;

/** 조건검색 목록(offset 부터 50개) */
export async function fetchFinderScreen(q: FinderQuery, offset = 0): Promise<FinderScreen> {
  const vars = { preset: q.preset, filters: toFilterInput(q.filters), sort: q.sort, limit: FINDER_PAGE, offset };
  return (await stockRequest<{ screenerScreen: FinderScreen }>(FINDER_QUERY, vars)).screenerScreen;
}
```

- [ ] **6-7. 통과 확인**

Run: `cd mobile && npx jest src/features/finder src/features/leaders`
Expected: 실패 0, `finder.test.ts` 13개 통과(주도주 테스트도 그대로 통과)

- [ ] **6-8. 전체 확인**

Run: `cd mobile && npx jest`
Expected: `Tests: 571 passed`

Run: `cd mobile && npm run typecheck`
Expected: 오류 0

- [ ] **6-9. 커밋(6-A)**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/features/leaders/canslim.ts
git add mobile/src/features/finder/types.ts
git add mobile/src/features/finder/finder.ts
git add mobile/src/features/finder/finder.test.ts
git add mobile/src/features/finder/api.ts
git commit -m "$(cat <<'EOF'
feat(mobile): 조건검색 순수 로직·쿼리 — 프리셋·정렬 상수, 필터 입력 변환·적용 수·같은 조건 비교, 페이지 병합 일반화

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

#### 6-B. 훅 · 화면 · 칩 등록

- [ ] **6-10. 데이터 훅** — `mobile/src/features/finder/use-finder-screen.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { hasMoreLeaders, mergeLeaderPage } from '@/features/leaders/canslim';
import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

import { fetchFinderScreen } from './api';
import { INITIAL_QUERY, sameFinderQuery, togglePreset } from './finder';
import type { FinderFilters, FinderItem, FinderPreset, FinderQuery, FinderSort } from './types';

type State = {
  items: FinderItem[];
  total: number;
  date: string | null;
  bbSigma: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
};

const INITIAL: State = {
  items: [], total: 0, date: null, bbSigma: 2, hasMore: false,
  loading: true, error: null, loadingMore: false, moreFailed: false,
};

/** 조건검색 목록 — 프리셋·정렬·필터, 50개씩 더 불러오기, 조건을 빠르게 바꿔도 마지막 요청만 반영(useCanslimScreen 과 같은 구조) */
export function useFinderScreen() {
  const [query, setQuery] = useState<FinderQuery>(INITIAL_QUERY);
  const [state, setState] = useState<State>(INITIAL);
  const gate = useRef(createLatest()).current;
  // 더 불러오기 동기 잠금 — state 는 같은 렌더 안에서 갱신되지 않으므로 ref 로 중복 요청을 막는다
  const inflight = useRef(false);

  const fetchFirst = useCallback(async () => {
    const s = await fetchFinderScreen(query, 0);
    return {
      items: s.items,
      total: s.total,
      date: s.date,
      bbSigma: s.bbSigma,
      hasMore: hasMoreLeaders(s.items.length, s.total, s.items.length),
    };
  }, [query]);

  const reload = useCallback(async () => {
    const id = gate.next();
    inflight.current = false;
    setState((s) => ({ ...s, loading: true, error: null, moreFailed: false }));
    try {
      const first = await fetchFirst();
      if (!gate.isLatest(id)) return;
      setState({ ...INITIAL, ...first, loading: false });
    } catch (e) {
      if (!gate.isLatest(id)) return;
      setState({ ...INITIAL, loading: false, error: errorCode(e) });
    }
  }, [fetchFirst, gate]);

  /** 당겨서 새로고침 — 기존 목록 유지, 성공하면 첫 페이지로 교체(실패는 throw → usePullRefresh 가 토스트) */
  const refresh = useCallback(async () => {
    const id = gate.next();
    inflight.current = false;
    let first: Awaited<ReturnType<typeof fetchFirst>>;
    try {
      first = await fetchFirst();
    } catch (e) {
      if (!gate.isLatest(id)) return;
      setState((s) =>
        s.loading ? { ...INITIAL, loading: false, error: errorCode(e) } : { ...s, loadingMore: false },
      );
      throw e;
    }
    if (!gate.isLatest(id)) return;
    setState({ ...INITIAL, ...first, loading: false });
  }, [fetchFirst, gate]);

  /** 목록 끝에서 다음 50개 — 번호를 올리지 않고 지금 조건의 응답일 때만 반영 */
  const loadMore = useCallback(async () => {
    if (inflight.current || state.loading || !state.hasMore) return;
    inflight.current = true;
    const id = gate.current();
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false }));
    try {
      const s2 = await fetchFinderScreen(query, state.items.length);
      if (!gate.isLatest(id)) return;
      inflight.current = false;
      setState((s) => {
        const items = mergeLeaderPage(s.items, s2.items);
        return {
          ...s,
          items,
          total: s2.total,
          hasMore: hasMoreLeaders(items.length, s2.total, s2.items.length),
          loadingMore: false,
        };
      });
    } catch {
      if (!gate.isLatest(id)) return;
      inflight.current = false;
      setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
    }
  }, [gate, query, state.hasMore, state.items.length, state.loading]);

  /** 같은 조건이면 이전 객체를 그대로 돌려줘 다시 조회하지 않는다 */
  const update = useCallback(
    (fn: (q: FinderQuery) => FinderQuery) =>
      setQuery((q) => {
        const next = fn(q);
        return sameFinderQuery(q, next) ? q : next;
      }),
    [],
  );
  const setPreset = useCallback((p: FinderPreset) => update((q) => ({ ...q, preset: togglePreset(q.preset, p) })), [update]);
  const setSort = useCallback((sort: FinderSort) => update((q) => ({ ...q, sort })), [update]);
  const setFilters = useCallback((filters: FinderFilters) => update((q) => ({ ...q, filters })), [update]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, query, setPreset, setSort, setFilters, reload, refresh, loadMore };
}
```

- [ ] **6-11. 프리셋 칩** — `mobile/src/features/finder/components/preset-chips.tsx`

```tsx
import { ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Chip } from '@/ui';

import { PRESETS } from '../finder';
import type { FinderPreset } from '../types';

/** 프리셋 칩 가로 스크롤(하나만 선택, 다시 누르면 해제) + 고른 프리셋 설명 한 줄 */
export function PresetChips({ value, onToggle }: { value: FinderPreset | null; onToggle: (p: FinderPreset) => void }) {
  const desc = PRESETS.find((p) => p.key === value)?.description ?? '프리셋을 고르거나 필터로 조건을 정해 보세요';
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {PRESETS.map((p) => (
          <Chip key={p.key} label={p.label} selected={value === p.key} onPress={() => onToggle(p.key)} />
        ))}
      </ScrollView>
      <Text style={styles.desc} numberOfLines={2}>{desc}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(0.75), paddingBottom: theme.gap(1) },
  chips: { gap: theme.gap(1), paddingHorizontal: theme.gap(2) },
  desc: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2) },
}));
```

- [ ] **6-12. 목록 행** — `mobile/src/features/finder/components/finder-row.tsx`

```tsx
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { formatAmount, formatChg, formatIndex, toneOf } from '@/features/market/format';

import { gcLabel, maOrderLabel, rsiTone } from '../finder';
import type { FinderItem } from '../types';

type BadgeTone = 'up' | 'down' | 'flat' | 'primary';
const BADGE_BG = { up: 'upSoft', down: 'downSoft', flat: 'fill', primary: 'primarySoft' } as const;
const BADGE_FG = { up: 'up', down: 'down', flat: 'textSecondary', primary: 'primary' } as const;

function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  const { theme } = useUnistyles();
  return (
    <View style={[styles.badge, { backgroundColor: theme.colors[BADGE_BG[tone]] }]}>
      <Text style={[styles.badgeText, { color: theme.colors[BADGE_FG[tone]] }]}>{label}</Text>
    </View>
  );
}

/** 조건검색 목록 한 줄 — 종목명/티커·지표 배지·업종(없으면 시장)·종가·등락률(상승 빨강·하락 파랑)·거래대금. 누르면 onPress */
export function FinderRow({ item, onPress }: { item: FinderItem; onPress: () => void }) {
  const { theme } = useUnistyles();
  const tone = toneOf(item.chg1d);
  const chgColor = tone === 'up' ? theme.colors.up : tone === 'down' ? theme.colors.down : theme.colors.textSecondary;
  const gc = gcLabel(item.gcDays);
  const order = maOrderLabel(item.maOrder);
  // 라벨이 자식 글자를 덮으므로 화면 낭독기가 들을 값을 모두 담는다
  const label = [
    `${item.name} ${item.ticker}`,
    item.isNewHigh ? '신고가' : '',
    gc ?? '',
    item.rsi14 !== null ? `RSI ${Math.round(item.rsi14)}` : '',
    order ?? '',
    item.sectorName ?? item.market,
    `종가 ${formatIndex(item.close)}원`,
    `등락률 ${formatChg(item.chg1d)}`,
    `거래대금 ${formatAmount(item.value)}`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="종목 상세 보기"
    >
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.ticker}>{item.ticker}</Text>
        </View>
        <View style={styles.badges}>
          {item.isNewHigh ? <Badge label="신고가" tone="up" /> : null}
          {gc ? <Badge label={gc} tone="primary" /> : null}
          {item.rsi14 !== null ? <Badge label={`RSI ${Math.round(item.rsi14)}`} tone={rsiTone(item.rsi14)} /> : null}
          {order ? <Badge label={order} tone={item.maOrder === 1 ? 'up' : 'down'} /> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{item.sectorName ?? item.market}</Text>
      </View>
      <View style={styles.nums}>
        <Text style={styles.price}>{formatIndex(item.close)}</Text>
        <Text style={[styles.chg, { color: chgColor }]}>{formatChg(item.chg1d)}</Text>
        <Text style={styles.meta}>{formatAmount(item.value)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), paddingVertical: theme.gap(1.25) },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: theme.gap(0.5) },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75) },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  ticker: { fontSize: 12, color: theme.colors.textSecondary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(0.5) },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  nums: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  chg: { fontSize: 13, fontWeight: '700' },
}));
```

- [ ] **6-13. 필터 바텀시트** — `mobile/src/features/finder/components/finder-filter-sheet.tsx`

```tsx
import { useState, type ReactNode } from 'react';
import { ScrollView, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { MarketFilter } from '@/features/leaders/types';
import { BottomSheet, Button, Chip } from '@/ui';

import { BB_SIGMAS, DEFAULT_FINDER_FILTERS, fromDraft, sigmaLabel, toDraft } from '../finder';
import type { BbPosition, FinderDraft, FinderFilters, MaOrderFilter, NumKey } from '../types';

const MARKETS: [MarketFilter, string][] = [['ALL', '전체'], ['KOSPI', 'KOSPI'], ['KOSDAQ', 'KOSDAQ']];
const MA_ORDERS: [MaOrderFilter | null, string][] = [[null, '무관'], ['PERFECT', '정배열'], ['REVERSE', '역배열']];
const BB_POSITIONS: [BbPosition | null, string][] = [
  [null, '무관'],
  ['ABOVE', '상단 돌파'],
  ['BELOW', '하단 이탈'],
  ['INSIDE', '밴드 안'],
];

type Props = { value: FinderFilters; onApply: (f: FinderFilters) => void; onClose: () => void };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      {children}
    </View>
  );
}

/** 숫자 입력 한 칸 — 빈칸이면 조건 없음. numeric 키보드(iOS 숫자 패드에는 '-' 가 없음) */
function NumInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const { theme } = useUnistyles();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textSecondary}
      keyboardType="numeric"
      accessibilityLabel={placeholder}
      style={styles.input}
    />
  );
}

/**
 * 조건검색 필터 바텀시트 — 웹 필터 패널과 같은 항목. 시트 안에서는 초안만 바꾸고 [적용]에서 반영.
 * [초기화]는 초안을 기본값으로(적용은 따로). 닫으면 초안은 버린다. 항목이 많아 안쪽을 스크롤한다. 호출부가 열 때 마운트한다.
 */
export function FinderFilterSheet({ value, onApply, onClose }: Props) {
  const { theme } = useUnistyles();
  const { height } = useWindowDimensions();
  const [draft, setDraft] = useState<FinderDraft>(() => toDraft(value));
  const set = (patch: Partial<FinderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const num = (key: NumKey, placeholder: string) => (
    <NumInput value={draft[key]} placeholder={placeholder} onChange={(v) => set({ [key]: v } as Partial<FinderDraft>)} />
  );
  const range = (lo: NumKey, hi: NumKey, unit: string) => (
    <View style={styles.range}>
      <View style={styles.flex}>{num(lo, `최소(${unit})`)}</View>
      <Text style={styles.tilde}>~</Text>
      <View style={styles.flex}>{num(hi, `최대(${unit})`)}</View>
    </View>
  );

  return (
    <BottomSheet title="필터" onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.65 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section title="시장">
          <View style={styles.chips}>
            {MARKETS.map(([v, t]) => (
              <Chip key={v} label={t} selected={draft.market === v} onPress={() => set({ market: v })} />
            ))}
          </View>
        </Section>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={styles.switchTitle}>거래 활발 종목만</Text>
            <Text style={styles.hint}>하루 평균 거래대금 10억 원·주가 1,000원 이상</Text>
          </View>
          <Switch
            value={draft.liquidOnly}
            onValueChange={(v) => set({ liquidOnly: v })}
            trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
            accessibilityLabel="거래 활발 종목만"
          />
        </View>
        <Section title="가격">{range('priceMin', 'priceMax', '원')}</Section>
        <Section title="시가총액">{range('mcapMin', 'mcapMax', '억 원')}</Section>
        <Section title="거래대금">{num('valueMin', '최소(억 원)')}</Section>
        <Section title="거래량(20일 평균 대비)">{num('volRatioMin', '최소(배), 예: 2')}</Section>
        <Section title="RSI(14)">{range('rsiMin', 'rsiMax', '0~100')}</Section>
        <Section title="이동평균 배열">
          <View style={styles.chips}>
            {MA_ORDERS.map(([v, t]) => (
              <Chip key={t} label={t} selected={draft.maOrder === v} onPress={() => set({ maOrder: v })} />
            ))}
          </View>
        </Section>
        <Section title="볼린저 σ">
          <View style={styles.chips}>
            {BB_SIGMAS.map((s) => (
              <Chip key={s} label={sigmaLabel(s)} selected={draft.bbSigma === s} onPress={() => set({ bbSigma: s })} />
            ))}
          </View>
        </Section>
        <Section title="볼린저 위치">
          <View style={styles.chips}>
            {BB_POSITIONS.map(([v, t]) => (
              <Chip key={t} label={t} selected={draft.bbPosition === v} onPress={() => set({ bbPosition: v })} />
            ))}
          </View>
        </Section>
        <Section title="볼린저 밴드폭">{num('bbWidthMax', '최대(%)')}</Section>
        <Section title="위쪽 매물(최근 120일)">{num('vpAboveMax', '최대(%)')}</Section>
        <Section title="ROE">{num('roeMin', '최소(%)')}</Section>
        <Section title="PER">{range('perMin', 'perMax', '배')}</Section>
        <Section title="PBR">{range('pbrMin', 'pbrMax', '배')}</Section>
        <Section title="부채비율">{num('debtRatioMax', '최대(%)')}</Section>
        <Section title="매출 성장률">{num('salesGrowthMin', '최소(%)')}</Section>
        <Text style={styles.hint}>재무는 최신 연간 결산 기준이에요. 빈칸은 조건 없음.</Text>
      </ScrollView>
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button label="초기화" variant="secondary" onPress={() => setDraft(toDraft(DEFAULT_FINDER_FILTERS))} />
        </View>
        <View style={styles.flex}>
          <Button label="적용" onPress={() => onApply(fromDraft(draft))} />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.gap(1.5), paddingBottom: theme.gap(1) },
  section: { gap: theme.gap(0.75) },
  label: { fontSize: 14, fontWeight: '700', color: theme.colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  range: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  tilde: { fontSize: 14, color: theme.colors.textSecondary },
  input: {
    backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.input,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1),
    fontSize: 15,
    color: theme.colors.text,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5) },
  flex: { flex: 1 },
  switchTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  hint: { fontSize: 12, color: theme.colors.textSecondary },
  buttons: { flexDirection: 'row', gap: theme.gap(1), marginTop: theme.gap(1) },
}));
```

- [ ] **6-14. 섹션** — `mobile/src/features/finder/sections/finder-section.tsx`

```tsx
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { listView } from '@/features/leaders/canslim';
import { formatIndex } from '@/features/market/format';
import { usePullRefresh } from '@/hooks/use-pull-refresh';
import { Chip, ListState } from '@/ui';

import { FinderFilterSheet } from '../components/finder-filter-sheet';
import { FinderRow } from '../components/finder-row';
import { PresetChips } from '../components/preset-chips';
import { activeFilterCount, FINDER_SORTS } from '../finder';
import { useFinderScreen } from '../use-finder-screen';

/** 조건검색 칩 — 프리셋 칩·정렬 칩·[필터]·목록(끝까지 내리면 50개 더). 행을 누르면 onOpenStock */
export function FinderSection({ onOpenStock }: { onOpenStock: (ticker: string, name: string) => void }) {
  const r = useFinderScreen();
  const { refreshing, onRefresh } = usePullRefresh(r.refresh);
  const [sheetOpen, setSheetOpen] = useState(false);
  const view = listView({ loading: r.loading, error: r.error, date: r.date, count: r.items.length });
  const filterCount = activeFilterCount(r.query.filters);
  const lastIndex = r.items.length - 1;

  return (
    <View style={styles.screen}>
      <PresetChips value={r.query.preset} onToggle={r.setPreset} />
      <View style={styles.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sortBar} contentContainerStyle={styles.sorts}>
          {FINDER_SORTS.map((s) => (
            <Chip key={s.key} label={s.label} selected={r.query.sort === s.key} onPress={() => r.setSort(s.key)} />
          ))}
        </ScrollView>
        <Pressable
          style={styles.filterBtn}
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={filterCount > 0 ? `필터, ${filterCount}개 적용 중` : '필터'}
        >
          <Text style={styles.filterText}>필터</Text>
          {filterCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {view === 'loading' ? (
        <ListState mode="loading" />
      ) : (
        <FlatList
          contentContainerStyle={[styles.list, r.items.length === 0 && styles.grow]}
          data={r.items}
          keyExtractor={(it) => it.ticker}
          ListHeaderComponent={
            view === 'list' ? <Text style={styles.total}>총 {formatIndex(r.total)}개</Text> : null
          }
          renderItem={({ item, index }) => (
            <View style={[styles.item, index === 0 && styles.first, index === lastIndex && styles.last]}>
              <FinderRow item={item} onPress={() => onOpenStock(item.ticker, item.name)} />
            </View>
          )}
          ItemSeparatorComponent={() => (
            <View style={styles.item}>
              <View style={styles.line} />
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing || (r.loading && r.items.length > 0)} onRefresh={onRefresh} />}
          onEndReached={() => {
            if (!r.moreFailed) void r.loadMore();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            view === 'error' ? (
              <ListState mode="error" title="조건검색을 불러오지 못했어요" hint={`잠시 후 다시 시도해 주세요 (오류: ${r.error})`} onRetry={r.reload} />
            ) : view === 'preparing' ? (
              <ListState mode="empty" emoji="🛠️" title="조건검색 데이터를 준비하고 있어요" hint="매일 장 마감 후 계산돼요" />
            ) : (
              <ListState mode="empty" emoji="🔎" title="조건에 맞는 종목이 없어요" hint="조건을 줄여 보세요" />
            )
          }
          ListFooterComponent={
            r.items.length === 0 ? null : (
              <View>
                {r.loadingMore ? <ActivityIndicator style={styles.more} /> : null}
                {r.moreFailed ? (
                  <Pressable onPress={() => void r.loadMore()} style={styles.more} accessibilityRole="button">
                    <Text style={styles.moreText}>더 불러오지 못했어요 · 다시 시도</Text>
                  </Pressable>
                ) : null}
                <Text style={styles.basis}>{r.date} 종가 기준 · 매일 20:30 갱신 · 투자 권유가 아닙니다</Text>
              </View>
            )
          }
        />
      )}
      {sheetOpen ? (
        <FinderFilterSheet
          value={r.query.filters}
          onApply={(f) => {
            r.setFilters(f);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1 },
  controls: {
    flexDirection: 'row', alignItems: 'center', gap: theme.gap(1),
    paddingRight: theme.gap(2), paddingBottom: theme.gap(1),
  },
  sortBar: { flex: 1 },
  sorts: { gap: theme.gap(1), paddingLeft: theme.gap(2) },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5),
    borderRadius: theme.radius.chip, paddingVertical: theme.gap(0.75), paddingHorizontal: theme.gap(1.5),
    backgroundColor: theme.colors.fill,
  },
  filterText: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent,
  },
  badgeText: { fontSize: 11, fontWeight: '800', color: theme.colors.onPrimary },
  list: { paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(2) },
  grow: { flexGrow: 1 },
  total: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(0.5), paddingBottom: theme.gap(1) },
  item: { backgroundColor: theme.colors.surface, paddingHorizontal: theme.gap(2) },
  first: { borderTopLeftRadius: theme.radius.card, borderTopRightRadius: theme.radius.card },
  last: { borderBottomLeftRadius: theme.radius.card, borderBottomRightRadius: theme.radius.card },
  line: { height: 1, backgroundColor: theme.colors.border },
  more: { paddingVertical: theme.gap(1.5), alignItems: 'center' },
  moreText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  basis: { fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', paddingTop: theme.gap(1.5) },
}));
```

- [ ] **6-15. 칩 등록** — `mobile/src/app/(tabs)/screener.tsx`

(1) import — 바꾸기 전:
```tsx
import { LeadersSection } from '@/features/leaders/sections/leaders-section';
```
바꾼 뒤:
```tsx
import { FinderSection } from '@/features/finder/sections/finder-section';
import { LeadersSection } from '@/features/leaders/sections/leaders-section';
```

(2) 칩 목록 — 바꾸기 전:
```tsx
type Tab = 'market' | 'theme' | 'sector' | 'calendar' | 'leaders';
```
바꾼 뒤:
```tsx
type Tab = 'market' | 'theme' | 'sector' | 'calendar' | 'leaders' | 'finder';
```
바꾸기 전:
```tsx
  ['leaders', '주도주'],
];
```
바꾼 뒤:
```tsx
  ['leaders', '주도주'],
  ['finder', '조건검색'],
];
```

(3) 설명 주석 — 바꾸기 전:
```tsx
/** 스크리너 탭 — 위쪽 칩(시장·테마·업종·일정·주도주, 웹 탭 순서와 같음)으로 아래 내용을 바꾼다 */
```
바꾼 뒤:
```tsx
/** 스크리너 탭 — 위쪽 칩(시장·테마·업종·일정·주도주·조건검색, 웹 탭 순서와 같음)으로 아래 내용을 바꾼다 */
```

(4) 화면 — 바꾸기 전:
```tsx
      {tab === 'leaders' ? <LeadersSection onOpenStock={openStock} /> : null}
```
바꾼 뒤:
```tsx
      {tab === 'leaders' ? <LeadersSection onOpenStock={openStock} /> : null}
      {tab === 'finder' ? <FinderSection onOpenStock={openStock} /> : null}
```

- [ ] **6-16. 확인**

Run: `cd mobile && npm run typecheck`
Expected: 오류 0

Run: `cd mobile && npx jest`
Expected: `Tests: 571 passed`(6-A 와 같음 — 화면 파일은 jest 대상 아님)

- [ ] **6-17. 커밋(6-B)**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/features/finder/use-finder-screen.ts
git add mobile/src/features/finder/components/preset-chips.tsx
git add mobile/src/features/finder/components/finder-row.tsx
git add mobile/src/features/finder/components/finder-filter-sheet.tsx
git add mobile/src/features/finder/sections/finder-section.tsx
git add "mobile/src/app/(tabs)/screener.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): 스크리너 '조건검색' 칩 — 프리셋 칩·정렬·필터 바텀시트(숫자 입력)·무한 스크롤 목록, 행 → 종목 상세

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 7: 계약 테스트 — 웹·모바일 쿼리를 실제 스키마로 실행

**파일:**
- 생성: `backend/tests/test_screener_contract.py`

작업 5·6 의 쿼리 파일이 있어야 한다. 쿼리 문자열과 `toFilterInput` 이 만드는 변수 모양이 스키마와 맞는지, 서버로 넘어간 필터가 snake_case 사전인지 확인한다.

- [ ] **7-1. 테스트 작성** — `backend/tests/test_screener_contract.py`

```python
"""조건검색 계약 — 웹(web_client/src/api/finder.ts)·모바일(mobile/src/features/finder/api.ts) 쿼리를 그대로 꺼내
실제 스키마로 실행한다(프론트↔API). 변수는 toFilterInput 이 만드는 모양(camelCase, 빈 조건 없음)."""
import asyncio
import pathlib
import re

from apps.stock_api.graphql.schema import schema
from apps.stock_api.services import screener_query as sq

ROOT = pathlib.Path(__file__).resolve().parents[2]
ITEM = {"ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 1.0, "chg_1d": -2.5,
        "value": 1e9, "mcap": None, "vol_ratio20": 2.1, "rsi14": 28.0, "ma_order": -1, "is_new_high": False,
        "gc_days": 1, "vp_above_pct": 40.0, "per": None, "pbr": 0.8, "roe": -3.0, "bb_position": "BELOW",
        "bb_width_pct": 12.0}
ITEM_FIELDS = {"ticker", "name", "market", "sectorName", "close", "chg1d", "value", "mcap", "volRatio20", "rsi14",
               "maOrder", "isNewHigh", "gcDays", "vpAbovePct", "per", "pbr", "roe", "bbPosition", "bbWidthPct"}
VARIABLES = {
    "preset": "golden_cross",
    "filters": {"market": "KOSDAQ", "liquidOnly": False, "priceMin": 1000, "mcapMin": 500, "rsiMax": 30,
                "maOrder": "PERFECT", "bbPosition": "BELOW", "bbSigma": 2.5, "roeMin": -5},
    "sort": "vol_ratio",
    "limit": 50,
    "offset": 50,
}


def _run(monkeypatch, rel_path: str) -> None:
    ts = (ROOT / rel_path).read_text(encoding="utf-8")
    queries = dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", ts))
    assert set(queries) == {"FINDER_QUERY"}, rel_path
    assert "${" not in queries["FINDER_QUERY"]

    seen = {}

    def fake_screen(**kw):
        seen.update(kw)
        return {"date": "2026-10-16", "total": 1, "bb_sigma": 2.5, "items": [ITEM]}

    monkeypatch.setattr(sq, "screen", fake_screen)
    res = asyncio.run(schema.execute(queries["FINDER_QUERY"], variable_values=VARIABLES))
    assert res.errors is None, (rel_path, res.errors)
    data = res.data["screenerScreen"]
    assert data["date"] == "2026-10-16" and data["total"] == 1 and data["bbSigma"] == 2.5
    item = data["items"][0]
    assert set(item) == ITEM_FIELDS
    assert item["chg1d"] == -2.5 and item["gcDays"] == 1 and item["bbPosition"] == "BELOW" and item["mcap"] is None
    assert seen["preset"] == "golden_cross" and seen["sort"] == "vol_ratio"
    assert seen["limit"] == 50 and seen["offset"] == 50
    f = seen["filters"]
    assert f["market"] == "KOSDAQ" and f["liquid_only"] is False and f["price_min"] == 1000 and f["mcap_min"] == 500
    assert f["rsi_max"] == 30 and f["ma_order"] == "PERFECT" and f["bb_position"] == "BELOW" and f["bb_sigma"] == 2.5
    assert f["roe_min"] == -5 and f["per_max"] is None


def test_web_finder_query_matches_schema(monkeypatch):
    _run(monkeypatch, "web_client/src/api/finder.ts")


def test_mobile_finder_query_matches_schema(monkeypatch):
    _run(monkeypatch, "mobile/src/features/finder/api.ts")
```

- [ ] **7-2. 통과 확인**

Run: `cd backend && uv run pytest -p no:warnings tests/test_screener_contract.py`
Expected: `2 passed`. 실패하면 쿼리 문자열(웹·모바일 두 곳 같은 글자)이나 `toFilterInput` 의 키 이름을 스키마에 맞춰 고친다 — 테스트를 느슨하게 바꾸지 않는다.

- [ ] **7-3. 전체 확인**

Run: `cd backend && uv run pytest -p no:warnings`
Expected: `1404 passed`

- [ ] **7-4. 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/tests/test_screener_contract.py
git commit -m "$(cat <<'EOF'
test(stock_api): 조건검색 계약 테스트 — 웹·모바일 FINDER_QUERY 를 실제 스키마로 실행, 필터 변수 → snake_case 사전 확인

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 8: 문서 — README · ROADMAP

**파일:**
- 수정: `README.md`(모바일 머리말 1줄, 스크리너 탭 절 1줄, CANSLIM 절 뒤에 새 절)
- 수정: `docs/ROADMAP.md`(Phase 1 1줄, Phase 2 2줄, Phase 4 1줄 추가)

- [ ] **8-1. README 모바일 머리말**

바꾸기 전(문장 그대로 찾는다):
```markdown
expo-router(하단 5탭: 홈/커뮤니티/게임/스크리너/내정보 — 스크리너는 시장·테마·업종·일정·주도주, 설계 `docs/superpowers/specs/2026-10-20-mobile-screener-design.md` · 주도주·종목 상세 `docs/superpowers/specs/2026-10-21-mobile-leaders-design.md`. 종목 상세 `/stock/[ticker]`(점수표·일봉 차트 50일선·52주 고점·점수 추이)는 주도주 목록과 테마·업종 상세의 구성 종목에서 들어간다)
```
바꾼 뒤:
```markdown
expo-router(하단 5탭: 홈/커뮤니티/게임/스크리너/내정보 — 스크리너는 시장·테마·업종·일정·주도주·조건검색, 설계 `docs/superpowers/specs/2026-10-20-mobile-screener-design.md` · 주도주·종목 상세 `docs/superpowers/specs/2026-10-21-mobile-leaders-design.md` · 조건검색 `docs/superpowers/specs/2026-10-21-screener-presets-design.md`. 종목 상세 `/stock/[ticker]`(점수표·일봉 차트 50일선·52주 고점·점수 추이)는 주도주·조건검색 목록과 테마·업종 상세의 구성 종목에서 들어간다)
```

- [ ] **8-2. README 스크리너 탭 절**

바꾸기 전:
```markdown
웹 `/screener/market|themes|sectors|calendar|leaders`(`/screener` → 시장 탭, 비로그인 공개).
```
바꾼 뒤:
```markdown
웹 `/screener/market|themes|sectors|calendar|leaders|finder`(`/screener` → 시장 탭, 비로그인 공개).
```

- [ ] **8-3. README 새 절** — CANSLIM 절 마지막 줄 바로 뒤에 넣는다.

바꾸기 전:
```markdown
- 기준값(25%·85%·RS 80 등)·가중치는 `apps/collector/canslim/rules.py` 상수.
```
바꾼 뒤:
```markdown
- 기준값(25%·85%·RS 80 등)·가중치는 `apps/collector/canslim/rules.py` 상수.

### 🧮 조건검색 (스크리너 프로젝트 4) — 프리셋·커스텀 필터
설계 `docs/superpowers/specs/2026-10-21-screener-presets-design.md`, 계획 `docs/superpowers/plans/2026-10-21-screener-presets.md`. 웹 `/screener/finder`(스크리너 탭 '조건검색', 비로그인 공개), 앱은 스크리너 탭 '조건검색' 칩(프리셋 칩·필터 바텀시트·정렬·50개씩 더 불러오기, 행 → `/stock/[ticker]`).
- **계산**: `collector.compute_screener` — 20:30 일일 파이프라인 맨 끝(시장 그룹 뒤, 앞 단계 실패와 무관). 분석 대상 보통주의 등락률·거래대금(종가×거래량)·시총(종가×상장주식수)·거래량 비율(당일/직전 20일 평균)·RSI(14, Wilder, 최근 100종가)·이동평균(5·20·50·60·120)·표준편차(20)·배열·직전 52주 고가·신고가 경신·골든크로스(20/60) 경과일(0~2)·매물대 위쪽 비율(최근 120일·20구간)·연간 재무(ROE·EPS·PER·PBR·매출/영업이익 성장률·부채비율)·유동성을 CH `screener_daily` 에 저장(같은 날 재계산은 멱등, 조회는 `FINAL`). `daily_prices` 에는 컬럼을 더하지 않는다.
- **처음 한 번**: 60거래일 채우기 — `uv run celery -A apps.collector.celery_app call collector.backfill_screener` (과거 날짜도 재무는 최신 연간 값, 상장주식수·업종은 현재 프로필).
- **API(stock_api GraphQL)**: `screenerScreen(preset, filters: ScreenerFilterInput, sort, limit, offset)` → `{ date, total, bbSigma, items }`. 프리셋 `volume_surge`(거래량 2배 이상)·`golden_cross`(3거래일 이내)·`oversold`(RSI ≤ 30)·`new_high`(52주 신고가 경신)는 서버 상수이고 필터와 AND. 시총·거래대금 필터 단위는 억 원, 볼린저 σ 는 1·1.5·2·2.5·3(그 밖은 2). 쿼리는 `web_client/src/api/finder.ts`·`mobile/src/features/finder/api.ts`, 계약 테스트 `backend/tests/test_screener_contract.py`.
- 기준값은 `apps/stock_api/services/screener_query.py`(프리셋·σ·정렬)와 `apps/collector/screener/indicators.py`(기간·구간 수) 상수. 관리자 데이터 현황·작업 버튼에는 아직 없다(후속).
```

- [ ] **8-4. ROADMAP**

(1) Phase 1 — 바꾸기 전:
```markdown
- [ ] 정배열/역배열·매물대의 CH 컬럼 영속화(스크리너 성능용)
```
바꾼 뒤:
```markdown
- [x] 정배열/역배열·매물대의 CH 컬럼 영속화(스크리너 성능용) — `daily_prices` 대신 별도 테이블 `screener_daily`(배열·매물대 위쪽 비율·RSI·골든크로스·신고가·재무 배수), 2026-10-21
```

(2) Phase 2 — 바꾸기 전:
```markdown
- [ ] `stock_api` 스크리너 리졸버/엔드포인트(필터 조합)
- [ ] 프리셋(거래량급증/골든크로스/과매도/신고가) + 커스텀 필터(볼린저 σ·정/역배열·매물대·거래량·재무)
```
바꾼 뒤:
```markdown
- [x] `stock_api` 스크리너 리졸버/엔드포인트(필터 조합) — GraphQL `screenerScreen`(2026-10-21)
- [x] 프리셋(거래량급증/골든크로스/과매도/신고가) + 커스텀 필터(볼린저 σ·정/역배열·매물대·거래량·재무) — 웹 '조건검색' 탭·앱 '조건검색' 칩, 스펙 `docs/superpowers/specs/2026-10-21-screener-presets-design.md` (2026-10-21). 배포 후 `backfill_screener` 실행·실기기 확인 대기. 배당수익률·MACD·저장 필터·관리자 버튼은 범위 밖
```

(3) Phase 4 — 바꾸기 전:
```markdown
- [ ] 차트 드로잉(앱)
```
바꾼 뒤(두 줄):
```markdown
- [x] 조건검색 칩(프리셋·필터 바텀시트·무한 스크롤, 행 → 종목 상세) — 2026-10-21. 실기기 확인 대기
- [ ] 차트 드로잉(앱)
```

- [ ] **8-5. 확인**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app && grep -c "screener-presets-design" README.md && grep -n "조건검색 칩" docs/ROADMAP.md && grep -c "backfill_screener" README.md
```
Expected: README `2`, ROADMAP 한 줄(`- [x] 조건검색 칩 …`), README `1`

- [ ] **8-6. 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add README.md
git add docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: 조건검색(프리셋·커스텀 필터) 반영 — README 조건검색 절·백필 명령·모바일 칩, ROADMAP Phase 1·2·4

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

### 작업 9: 운영 확인 · 실기기 확인 — **사용자 몫**

에이전트는 이 작업을 실행하지 않는다(실제 계산 태스크 실행·개발/운영 DB 쓰기 금지). 아래 절차를 사용자에게 안내하고 결과를 기다린다.

- [ ] **9-1. 배포** — dev → main 머지 후 서버 배포. **Celery 워커 재시작**이 필요하다(새 태스크 모듈 `apps.collector.tasks.screener` include). beat 엔트리는 새로 없지만 파이프라인 단계가 바뀌었으므로 워커가 새 코드를 읽어야 20:30 에 스크리너 단계가 돈다. stock_api 도 재시작(새 GraphQL 필드).
- [ ] **9-2. 백필** — 서버의 collector 컨테이너에서 한 번:
  ```bash
  uv run celery -A apps.collector.celery_app call collector.backfill_screener
  ```
  결과(`ok`·`failed`)를 워커 로그 "스크리너 백필: ok=… failed=…" 로 확인한다. 하루치마다 일봉 400일을 다시 읽으므로 `backfill_canslim` 과 비슷한 시간이 걸린다.
- [ ] **9-3. 프리셋별 건수 점검** — CH 에서:
  ```sql
  SELECT count() AS total,
         countIf(liquid = 1) AS liquid,
         countIf(liquid = 1 AND vol_ratio20 >= 2) AS volume_surge,
         countIf(liquid = 1 AND gc_days IS NOT NULL) AS golden_cross,
         countIf(liquid = 1 AND rsi14 <= 30) AS oversold,
         countIf(liquid = 1 AND is_new_high = 1) AS new_high,
         countIf(vp_above_pct IS NULL) AS vp_null,
         countIf(per IS NULL) AS per_null
  FROM screener_daily FINAL
  WHERE date = (SELECT max(date) FROM screener_daily)
  ```
  기대: `total` ≈ 분석 대상 보통주 수(약 2,600), 프리셋 4개가 **0도 아니고 `liquid` 전체도 아님**(보통 수십~수백). `vp_null` 은 상장 120일 미만 종목 정도, `per_null` 은 적자·재무 미수집 종목 정도.
- [ ] **9-4. 한 종목 대조** — 아는 종목 하나(예: 005930)의 `rsi14`·`ma20`·`ma60`·`chg_1d`·`per` 를 한투 MTS 와 비교한다(RSI 는 1 안쪽 차이 허용 — 입력 길이 100종가). 다르면 기록만 하고 알려 준다.
- [ ] **9-5. 웹** — `/screener/finder`: 탭 순서 시장·테마·업종·일정·주도주·조건검색. 프리셋 칩 4개(누르면 선택, 다시 누르면 해제, 설명 한 줄), [필터] 패널(값 넣고 [적용] → 배지 숫자, [초기화] → [적용] 이면 사라짐), 정렬 칩 6개, 목록(등락률 상승 빨강·하락 파랑, 배지), 더 보기, 넓은 화면 오른쪽 상세(일봉 차트·지표 표·"주도주 분석 보기" 링크)·좁은 화면 행 펼침, 조건을 좁히면 "조건에 맞는 종목이 없어요", 하단 "… 종가 기준 · 매일 20:30 갱신 · 투자 권유가 아닙니다".
- [ ] **9-6. 앱** — 스크리너 탭 → '조건검색' 칩: 프리셋 칩 가로 스크롤·설명, 정렬 칩, [필터] 바텀시트(안쪽 스크롤, 숫자 입력, 키보드가 입력 칸을 가리지 않는지), 끝까지 내리면 50개씩, 당겨서 새로고침, 행 → 종목 상세. 라이트·다크 모드 둘 다. iOS 에서는 ROE·매출 성장률 음수 입력이 되는지 확인(안 되면 기록 — 위험 항목).
- [ ] **9-7. 결과 반영** — 통과하면 ROADMAP 의 "조건검색 칩 … 실기기 확인 대기"와 Phase 2 "배포 후 … 확인 대기"를 "확인 완료(날짜)"로 바꿔 커밋한다(파일 개별 add, 끝 두 줄).

---

## 위험 · 주의점

- **파이프라인 시간**: 스크리너 단계는 일봉 400일 전체를 한 번 더 읽는다(CANSLIM 과 같은 양). 20:30 파이프라인이 그만큼 길어진다. 실패해도 앞 단계 결과에는 영향이 없다(단계별 예외 격리).
- **RSI 값 차이**: 입력 길이(최근 100종가)를 게임과 맞췄지만 MTS 와는 소수점 차이가 날 수 있다.
- **재무 시점**: 연간(Y) 최신 결산만 쓴다. 과거 기준일 백필도 최신 값이라 지난 날짜의 PER·PBR 은 근사다.
- **iOS 음수 입력**: `keyboardType="numeric"` 은 iOS 숫자 패드에 `-` 가 없다. 지금은 Android 먼저라 그대로 두고, iOS 출시 전에 `numbers-and-punctuation` 등으로 바꿀지 정한다.
- **웹 eslint 경고**: `FinderTab` 이 주도주 화면과 같은 `useEffect` 안 `setState` 패턴이라 `react-hooks/set-state-in-effect` 경고가 늘 수 있다(오류 아님, 기존과 같은 수준).
- **관리자 버튼 없음**: 관리자 데이터 현황·작업 버튼(`admin_jobs`)에는 스크리너가 없다. 백필은 `celery call` 로만 돌린다.

## 자체 점검 (작성자 확인 결과)

- **설계 범위**: §1(사전 계산 테이블·파이프라인·백필·GraphQL·웹 탭·앱 칩·문서) → 작업 1~8. §2 결정 표 → 작업 1(지표 정의)·작업 2(테이블, `daily_prices` 무수정)·작업 4(프리셋·σ·재무). §3.1 컬럼 → 작업 2 DDL(+`sector_m`, 표에 기록). §3.2 계산 단계(compute·저장소·태스크·파이프라인 끝·`pipeline_record` 기록·멱등) → 작업 2·3. §4 API(인자·정렬·응답·`MAX_LIMIT`·이름·업종·범위 검증·별도 프리셋 쿼리 없음) → 작업 4. §5.1 웹 → 작업 5. §5.2 앱 → 작업 6. §6 테스트(지표 값·프리셋 WHERE·화이트리스트·범위·페이징·date null·파이프라인 격리·계약·jest·웹 타입 검사·실데이터) → 작업 1·3·4·6·7·9. 범위 밖(배당·MACD·차트 패턴·저장 필터·알림·ETF)은 다루지 않는다.
- **자리표시자**: 없음. 모든 코드 단계에 전체 코드, 모든 수정 단계에 "바꾸기 전/뒤" 글자를 적었다.
- **이름 일관성**: 백엔드 `ROW_COLUMNS`(작업 2) → `compute.ROW_KEYS`(작업 3). `ensure_screener_table`·`load_bars`·`load_fundamentals`·`upsert_rows`·`latest_trading_date`·`trading_dates`(작업 2) → `tasks/screener.py`·테스트(작업 3). `compute_screener`(작업 3) → `market_data.py`·파이프라인 테스트. `screen`·`bb_position`·`bb_width_pct`·`bb_sigma`(작업 4) → 리졸버·계약 테스트(작업 7). GraphQL 필드 `chg1d`·`volRatio20`·`rsi14`·`isNewHigh`·`gcDays`·`vpAbovePct`·`bbPosition`·`bbWidthPct`·`bbSigma`(작업 4) → 웹·모바일 쿼리(작업 5·6) → 계약 테스트 `ITEM_FIELDS`(작업 7). 웹·모바일 순수 함수 이름(`PRESETS`·`FINDER_SORTS`·`BB_SIGMAS`·`NUM_KEYS`·`DEFAULT_FINDER_FILTERS`·`parseNum`·`toDraft`·`fromDraft`·`toFilterInput`·`activeFilterCount`·`sameFinderQuery`·`sigmaLabel`·`maOrderLabel`·`gcLabel`·`bbPositionLabel`)이 같다. 모바일만 `INITIAL_QUERY`·`togglePreset`·`rsiTone`·`FINDER_PAGE = LEADERS_PAGE` 를 더 둔다(웹은 `FINDER_PAGE = 50`·화면 안에서 같은 규칙).
- **테스트 수**: 백엔드 1357 → 1376(작업 1, 19) → 1380(작업 2, 4) → 1389(작업 3, compute 4 + 태스크 5) → 1402(작업 4, 13) → 1404(작업 7, 2). 모바일 558 → 571(작업 6, 13). 웹은 러너 없음(`tsc`·`eslint` 오류 0).
- **실행 방식**: 작업 1→9 순서. 작업 7 은 작업 5·6 의 쿼리 파일이 있어야 한다. 하위 에이전트 방식(작업마다 새 에이전트 + 검토)을 권장한다.
