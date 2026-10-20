# 장중 주요 지수 30초 갱신(A안) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **모든 설명·커밋 메시지·코드 주석은 한국어로 쓴다**(루트 `CLAUDE.md` 최우선 규칙).

**목표:** 스크리너 시장 칩의 국내 지수 3개(KOSPI·KOSDAQ·KOSPI200)와 원/달러가 장중에도 30초 간격의 최신 값과 "장중 HH:MM" 배지를 보여 주게 한다.

**구조:** collector 의 celery beat 태스크 `collector.poll_intraday_indices` 가 30초마다(거래일 09:00~15:35 KST 일 때만) 기존 KIS 일별 지수 TR 로 오늘 봉의 현재값을 받아 Redis `market:intraday` 에 둔다(ClickHouse 에는 쓰지 않음).
stock_api `market_query._indices()` 는 ClickHouse 확정 종가(30초 메모리 캐시) 위에 순수 함수 `overlay_intraday` 로 장중 값을 덧씌우고, GraphQL `MarketIndex` 에 `live`·`asOf` 를 더한다.
모바일·웹 시장 칩은 화면이 보이고 앱(탭)이 앞에 있을 때만 30초마다 개요만 조용히 다시 받는다.

**기술:** Python 3.12 · Celery beat · redis-py(테스트 fakeredis) · ClickHouse · Strawberry GraphQL · Expo(expo-router·Unistyles v3·jest) · React(Vite·Tailwind)

**스펙:** [`docs/superpowers/specs/2026-10-20-intraday-index-design.md`](../specs/2026-10-20-intraday-index-design.md)

---

## 작업 규칙 (모든 작업 공통)

- 백엔드 테스트: `cd backend && uv run pytest tests/<파일> -q -p no:warnings` (이 머신에는 conda `stock_app` 환경이 없어 `uv` 로 실행).
- 모바일: `cd mobile && npx jest <경로>` · `npx tsc --noEmit`. **`npm install` 금지.**
- 웹: `web_client` 에는 테스트 러너(vitest 등)가 **없다**(package.json 확인). 새 의존성을 넣지 않고, 순수 함수는 Node 22 의 `--experimental-strip-types` 한 줄 검사 + `npx tsc --noEmit` + `npx eslint <파일>` 로 확인한다.
- `git add -A` / `git add .` 금지 — 경로를 하나씩 적는다. env 는 `backend/.env.example` 만 고친다.
- **실제 KIS 호출 금지**(테스트는 가짜 클라이언트). 실제 응답 확인은 Task 4 에서 사용자가 서버에서 직접 실행한다.
- Router → Service → Repository 분리를 지킨다: 수집 로직은 `apps/collector/intraday_indices.py`, 태스크는 얇게. API 는 서비스(`market_query`)에 순수 함수, 리졸버는 변환만.
- 커밋 메시지 끝에는 항상 아래 두 줄을 붙인다(예시마다 포함).

## 스펙과 다르게 정한 점 (실제 코드를 읽고 맞춤)

| 스펙 | 계획 | 이유 |
|---|---|---|
| `chg1d` = 장중 값 ÷ 마지막 확정 종가 − 1 | `_pct(장중 값, 마지막 확정 종가)` (= ×100 − 100, **퍼센트**) | 기존 `_pct` 가 퍼센트를 돌려주고 화면도 퍼센트로 쓴다 — 비율로 넣으면 100배 작게 보인다 |
| 한 코드 실패 시 이전 값 유지 | 이전 값 유지 + **10분(`INTRADAY_TTL`)보다 오래된 항목은 병합할 때 버림** | 키 하나에 합쳐 저장하므로 다른 코드가 성공할 때마다 TTL 이 늘어나 한 코드의 낡은 값이 영원히 남을 수 있다(스펙 6절 "10분 지나면 사라짐" 보장) |
| ClickHouse 지수 조회만 30초 캐시 | 지수 **와 거시 지표(`_macro`)** 둘 다 30초 캐시 | `overview()` 는 매번 거시 지표 CH 쿼리도 한다 — 사용자별 30초 조회가 그대로 CH 로 가지 않게 |
| 지수 11개 코드 × 60일 | `_BASE` 10개 코드 × 60일 | 실제 `INDEX_SPECS = _BASE` 는 10개 |
| 모바일 `useFocusEffect` + `AppState` | `useFocusEffect` + 기존 `startForegroundInterval`(`features/game/lib/foreground-interval.ts`, 내부에서 `AppState.currentState` 확인) | 이미 테스트된 같은 동작의 유틸 재사용 |
| 웹 훅 단위 테스트 | 순수 함수 Node 한 줄 검사 + 타입·린트 | 웹에 테스트 러너가 없음(의존성 추가 회피) |
| 오늘 날짜 | 수집기·덧씌우기 모두 **명시적 KST** 날짜 | 컨테이너 TZ 가 UTC 일 수 있다(`date.today()` 에 기대지 않음) |
| collector 가 trading_game 을 import 하지 않게 | 거래일 판정은 `shared/market_calendar.py` 로 옮기고 게임 경로는 다시 내보냄. 단 기존 `tasks/settle_season.py` 는 정산 로직(`settlement`) 때문에 이미 trading_game 을 import 하므로 그대로 둔다 | 동작 불변·최소 변경 |

## 파일 구조

| 파일 | 할 일 |
|---|---|
| `backend/shared/market_calendar.py` (이동) | 거래일 판정(`is_trading_day` 등) — `apps/trading_game/services/market_calendar.py` 를 `git mv` |
| `backend/apps/trading_game/services/market_calendar.py` (새 — 얇은 재수출) | 게임 쪽 기존 import 경로 유지 |
| `backend/tests/test_shared_market_calendar.py` (새) | 재수출 동일성·shared 판정 |
| `backend/apps/collector/intraday_indices.py` (새) | 상수·실행 창 판정·오늘 값 추출·Redis 병합·`poll` |
| `backend/tests/test_intraday_indices.py` (새) | 위 순수 로직·`poll`(가짜 KIS·fakeredis) |
| `backend/apps/collector/tasks/market_data.py` (수정) | 태스크 `collector.poll_intraday_indices` |
| `backend/apps/collector/celery_app.py` (수정) | beat `poll-intraday-indices` 30초·`expires` 25 |
| `backend/tests/test_market_tasks.py` (수정) | 태스크 게이트·beat 항목 테스트 |
| `backend/.env.example` (수정) | `INTRADAY_INDICES_ENABLED` |
| `backend/apps/stock_api/services/market_query.py` (수정) | `overlay_intraday`·`_intraday`·`_now_kst`·30초 캐시(`_CACHE`·`_cached_query`·`_clock`) |
| `backend/apps/stock_api/graphql/types.py` (수정) | `MarketIndex.live`·`as_of` |
| `backend/tests/test_market_query.py` (수정) | 덧씌우기·캐시·GraphQL·쿼리 계약 |
| `mobile/src/features/market/{types.ts, api.ts, format.ts, format.test.ts}` (수정) | 타입·쿼리·`indexBadge` |
| `mobile/src/features/market/components/{index-card.tsx, basis-note.tsx}` (수정) | 장중 배지·안내 문구 |
| `mobile/src/features/market/auto-refresh.ts` + `auto-refresh.test.ts` (새) | 조용한 실행기 `createSilentRunner`(겹침 방지·실패 무시) |
| `mobile/src/features/market/use-auto-refresh.ts` (새) | `useFocusEffect` + 포그라운드 30초 |
| `mobile/src/features/market/use-market-overview.ts` · `sections/market-section.tsx` (수정) | 요청 번호 게이트·`silentRefresh`·연결 |
| `web_client/src/types/market.ts` · `src/api/market.ts` (수정) | 타입·쿼리 |
| `web_client/src/lib/marketLive.ts` (새) | `indexBadge`·`MARKET_REFRESH_MS` |
| `web_client/src/components/market/{IndexCards.tsx, BasisNote.tsx}` · `src/pages/screener/MarketTab.tsx` (수정) | 배지·문구·30초 새로고침 |
| `README.md`, `docs/server_setup.md` (수정) | 일정 표·운영 확인 방법 |

---

### Task 1: 거래일 판정을 `shared/` 로 옮기기 (동작 불변)

**Files:**
- Move: `backend/apps/trading_game/services/market_calendar.py` → `backend/shared/market_calendar.py`
- Create: `backend/apps/trading_game/services/market_calendar.py` (재수출)
- Test: `backend/tests/test_shared_market_calendar.py` (새), `backend/tests/test_market_calendar.py` (**수정하지 않음** — 동작 불변 증거)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_shared_market_calendar.py`

```python
"""거래일 판정을 shared 로 옮김 — 게임 경로(apps.trading_game.services.market_calendar)는 같은 함수를 다시 내보낸다."""
from datetime import date

import pytest

from apps.trading_game.services import market_calendar as game_cal
from shared import market_calendar as shared_cal


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)


def test_game_path_reexports_shared_functions():
    assert game_cal.is_trading_day is shared_cal.is_trading_day
    assert game_cal.krx_year_end_closing is shared_cal.krx_year_end_closing
    assert game_cal._manual_holidays is shared_cal._manual_holidays
    assert game_cal._kr_holidays is shared_cal._kr_holidays


def test_shared_judges_weekend_and_weekday():
    assert shared_cal.is_trading_day(date(2026, 10, 17)) is False  # 토
    assert shared_cal.is_trading_day(date(2026, 10, 20)) is True   # 화
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_shared_market_calendar.py -q -p no:warnings`
Expected: FAIL — `ModuleNotFoundError: No module named 'shared.market_calendar'`

- [ ] **Step 3: 파일 이동 + 재수출 모듈 만들기**

```bash
git mv backend/apps/trading_game/services/market_calendar.py backend/shared/market_calendar.py
```

`backend/apps/trading_game/services/market_calendar.py` (새로 만든다):

```python
"""하위 호환 — 거래일 판정은 shared/market_calendar.py 로 옮겼다(collector 장중 지수도 같이 쓴다).

게임 코드(market_clock 등)·테스트의 기존 import 경로를 그대로 유지하려고 같은 함수를 다시 내보낸다.
밑줄 이름도 명시적으로 내보낸다(별표 import 는 밑줄 이름을 빠뜨림).
"""
from shared.market_calendar import (  # noqa: F401
    _kr_holidays,
    _manual_holidays,
    is_trading_day,
    krx_year_end_closing,
)
```

- [ ] **Step 4: 통과 확인(새 테스트 + 기존 게임 테스트 그대로)**

Run: `cd backend && uv run pytest tests/test_shared_market_calendar.py tests/test_market_calendar.py tests/test_settle_close_price.py tests/test_game_rules.py -q -p no:warnings`
Expected: 모두 passed (기존 `test_market_calendar.py` 는 한 줄도 바꾸지 않았는데 통과 = 동작 불변)

- [ ] **Step 5: 커밋**

```bash
git add backend/shared/market_calendar.py backend/apps/trading_game/services/market_calendar.py backend/tests/test_shared_market_calendar.py
git commit -F - <<'EOF'
refactor(shared): 거래일 판정을 shared 로 옮기고 게임 경로는 다시 내보내기

장중 지수 수집(collector)이 trading_game 을 import 하지 않고 같은 휴장일 판정을 쓰게 한다. 게임 동작 불변.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

---

### Task 2: 장중 수집 순수 로직 `intraday_indices.py` (TDD)

**Files:**
- Create: `backend/apps/collector/intraday_indices.py`
- Test: `backend/tests/test_intraday_indices.py`

이 작업에서 정의하는 이름(뒤 작업이 그대로 쓴다): `KST`, `INTRADAY_KEY`, `INTRADAY_TTL`, `INTRADAY_WINDOW`, `INTRADAY_CODES`, `INTRADAY_RATE`, `enabled()`, `now_kst()`, `in_intraday_window(now)`, `intraday_specs()`, `today_value(rows, today)`, `fetch_today(spec, client, today)`, `merge_intraday(prev, fresh, now_ts)`, `load_intraday(redis)`, `poll(client, redis, now, fetch=None)`.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_intraday_indices.py`

```python
"""장중 지수 30초 갱신 — 실행 창(거래일·09:00/15:35 경계), 오늘 값 추출, Redis 병합·TTL, 일부/전부 실패(가짜 KIS·fakeredis)."""
import json
from datetime import date, datetime

import fakeredis
import pytest

from apps.collector import intraday_indices as ii

NOW = datetime(2026, 10, 20, 14, 32, 5, tzinfo=ii.KST)  # 화요일 장중
TODAY = NOW.date()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    # 로컬 .env 의 TRADING_DAYS=ALL 같은 값이 거래일 판정을 바꾸지 않게
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED", raising=False)


class _Client:
    """KIS 가짜 — 국내 지수(업종 일별)·환율(해외 일별). day 는 응답 봉의 날짜."""

    PRICES = {"0001": "2601.5", "1001": "808.9", "2001": "350.1"}

    def __init__(self, fail=(), day="20261020"):
        self.fail, self.day, self.calls = set(fail), day, []

    def get_domestic_index_daily(self, code, s, e):
        self.calls.append(("U", code, s, e))
        if code in self.fail:
            raise RuntimeError("KIS rt_cd=1")
        return [{"stck_bsop_date": self.day, "bstp_nmix_prpr": self.PRICES[code]}]

    def get_overseas_daily(self, mrkt, symbol, s, e):
        self.calls.append((mrkt, symbol, s, e))
        if symbol in self.fail:
            raise RuntimeError("KIS rt_cd=1")
        return [{"stck_bsop_date": self.day, "ovrs_nmix_prpr": "1385.2"}]


def test_enabled_default_true_and_off_values(monkeypatch):
    assert ii.enabled() is True
    for off in ("false", "FALSE", "0", "no", "off", " false "):
        monkeypatch.setenv("INTRADAY_INDICES_ENABLED", off)
        assert ii.enabled() is False
    monkeypatch.setenv("INTRADAY_INDICES_ENABLED", "true")
    assert ii.enabled() is True


@pytest.mark.parametrize("y, m, d, hh, mm, expected", [
    (2026, 10, 20, 8, 59, False),   # 장 시작 전
    (2026, 10, 20, 9, 0, True),     # 09:00 포함
    (2026, 10, 20, 15, 34, True),
    (2026, 10, 20, 15, 35, False),  # 15:35 제외
    (2026, 10, 17, 10, 0, False),   # 토요일
    (2026, 10, 5, 10, 0, False),    # 개천절 대체공휴일
])
def test_in_intraday_window(y, m, d, hh, mm, expected):
    assert ii.in_intraday_window(datetime(y, m, d, hh, mm, tzinfo=ii.KST)) is expected


def test_intraday_specs_are_three_kr_indices_and_usdkrw():
    specs = ii.intraday_specs()
    assert [s.code for s in specs] == list(ii.INTRADAY_CODES)
    fx = next(s for s in specs if s.code == "FX:USDKRW")
    assert (fx.mrkt, fx.symbol) == ("X", "FX@KRW")  # 환율은 region=US 라 index_specs("KR") 에 없다 — 코드로 고른다


def test_today_value_picks_today_bar_only():
    rows = [{"date": date(2026, 10, 19), "close": 1.0}, {"date": TODAY, "close": 2.5}]
    assert ii.today_value(rows, TODAY) == 2.5
    assert ii.today_value(rows[:1], TODAY) is None
    assert ii.today_value([], TODAY) is None


def test_merge_keeps_previous_and_drops_stale():
    ts = NOW.timestamp()
    prev = {"KR:1001": {"value": 800.0, "date": "2026-10-20", "ts": ts - 60},
            "KR:2001": {"value": 340.0, "date": "2026-10-20", "ts": ts - ii.INTRADAY_TTL - 1},
            "bad": "x"}
    fresh = {"KR:0001": {"value": 2601.5, "date": "2026-10-20", "ts": int(ts)}}
    assert ii.merge_intraday(prev, fresh, ts) == {"KR:1001": prev["KR:1001"], "KR:0001": fresh["KR:0001"]}


def test_load_intraday_tolerates_missing_and_broken():
    r = fakeredis.FakeRedis(decode_responses=True)
    assert ii.load_intraday(r) == {}
    r.set(ii.INTRADAY_KEY, "not json")
    assert ii.load_intraday(r) == {}
    r.set(ii.INTRADAY_KEY, "[1, 2]")
    assert ii.load_intraday(r) == {}


def test_poll_writes_all_four_with_ttl():
    r = fakeredis.FakeRedis(decode_responses=True)
    c = _Client()
    out = ii.poll(c, r, NOW)
    assert out == {"ok": sorted(ii.INTRADAY_CODES), "failed": []}
    saved = json.loads(r.get(ii.INTRADAY_KEY))
    assert saved["KR:0001"] == {"value": 2601.5, "date": "2026-10-20", "ts": int(NOW.timestamp())}
    assert saved["FX:USDKRW"]["value"] == 1385.2
    assert 0 < r.ttl(ii.INTRADAY_KEY) <= ii.INTRADAY_TTL
    # 오늘 하루 범위로만 조회(지수 시장 코드 U, 환율 X)
    assert ("U", "0001", "20261020", "20261020") in c.calls and ("X", "FX@KRW", "20261020", "20261020") in c.calls


def test_poll_partial_failure_keeps_previous_value():
    r = fakeredis.FakeRedis(decode_responses=True)
    old = {"value": 800.0, "date": "2026-10-20", "ts": int(NOW.timestamp()) - 30}
    r.set(ii.INTRADAY_KEY, json.dumps({"KR:1001": old}))
    out = ii.poll(_Client(fail={"1001"}), r, NOW)
    assert out["failed"] == ["KR:1001"]
    saved = json.loads(r.get(ii.INTRADAY_KEY))
    assert saved["KR:1001"] == old and saved["KR:0001"]["value"] == 2601.5


def test_poll_counts_missing_today_bar_as_failure():
    # 장중에 오늘 봉을 주지 않는 TR(어제 봉만 옴) — 실패로 세고 아무것도 쓰지 않는다
    r = fakeredis.FakeRedis(decode_responses=True)
    out = ii.poll(_Client(day="20261019"), r, NOW)
    assert out == {"ok": [], "failed": list(ii.INTRADAY_CODES)}
    assert r.get(ii.INTRADAY_KEY) is None


def test_poll_all_fail_does_not_touch_redis():
    r = fakeredis.FakeRedis(decode_responses=True)
    r.set(ii.INTRADAY_KEY, json.dumps({"KR:0001": {"value": 1.0, "date": "2026-10-20", "ts": 1}}), ex=100)
    out = ii.poll(_Client(fail={"0001", "1001", "2001", "FX@KRW"}), r, NOW)
    assert out["ok"] == [] and len(out["failed"]) == 4
    assert r.ttl(ii.INTRADAY_KEY) <= 100  # TTL 을 늘리지 않음 → 그대로 사라져 확정 종가로 돌아간다


def test_poll_uses_injected_fetch():
    # Task 4 분기(현재지수 TR)에서 조회 함수만 바꿔 끼울 수 있어야 한다
    r = fakeredis.FakeRedis(decode_responses=True)
    out = ii.poll(object(), r, NOW, fetch=lambda spec, client, today: 1.0 if spec.code == "KR:0001" else None)
    assert out["ok"] == ["KR:0001"] and len(out["failed"]) == 3
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_intraday_indices.py -q -p no:warnings`
Expected: FAIL — `ImportError: cannot import name 'intraday_indices' from 'apps.collector'`

- [ ] **Step 3: 최소 구현** — `backend/apps/collector/intraday_indices.py`

```python
"""장중 주요 지수 30초 갱신(A안) — KIS REST 로 오늘 진행 중인 값을 받아 Redis 에 둔다.

- 대상: KOSPI·KOSDAQ·KOSPI200·원/달러(INTRADAY_CODES). 미국 지수는 한국 낮에 장이 닫혀 있어 제외.
- 조회: 기존 일별 TR(국내 FHKUP03500100 시장 코드 U, 환율 FHKST03030100 X)을 오늘 하루 범위로 불러 오늘 봉의 현재값.
  지수 TR 은 종목 시세가 아니라 UN→J 폴백 규칙 대상이 아니다(기존 일별 수집과 같은 U).
- 저장: Redis market:intraday = {code: {"value", "date", "ts"}} (TTL 10분). ClickHouse 에는 쓰지 않는다 —
  장중 값이 확정 종가 이력을 오염시키지 않게(15:40 확정 수집이 실패해도 장중 마지막 값이 종가로 남지 않음).
설계 docs/superpowers/specs/2026-10-20-intraday-index-design.md
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, time, timedelta, timezone

from apps.collector.market_indices import IndexSpec, _fetch, index_specs
from shared import market_calendar

log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
INTRADAY_KEY = "market:intraday"
INTRADAY_TTL = 600  # 10분 — 수집이 멈추면 값이 저절로 사라져 확정 종가로 돌아간다
# 이 기능 전용 장 시간(09:00 ≤ t < 15:35). 게임 TRADING_WINDOWS(애프터마켓 포함)와 목적이 달라 공유하지 않는다
INTRADAY_WINDOW = (time(9, 0), time(15, 35))
INTRADAY_CODES = ("KR:0001", "KR:1001", "KR:2001", "FX:USDKRW")
# 이 태스크 전용 초당 상한 — 4건이 2초에 나뉜다(KIS 실전 20 TPS·우리 상한 15 TPS 의 1% 미만).
# 장중에 REST 를 대량으로 쓰는 작업이 새로 생기면 그 작업과 초당 상한을 나눠 써야 한다.
INTRADAY_RATE = 2.0
_OFF = ("false", "0", "no", "off")


def enabled() -> bool:
    """INTRADAY_INDICES_ENABLED — 기본 켜짐, false/0/no/off 면 꺼짐."""
    return (os.getenv("INTRADAY_INDICES_ENABLED") or "true").strip().lower() not in _OFF


def now_kst() -> datetime:
    return datetime.now(KST)


def in_intraday_window(now: datetime) -> bool:
    """KST 거래일(주말·공휴일·KRX 연말 휴장·수동 휴장 제외)이고 09:00 ≤ 시각 < 15:35."""
    if not market_calendar.is_trading_day(now.date()):
        return False
    start, end = INTRADAY_WINDOW
    return start <= now.time() < end


def intraday_specs() -> list[IndexSpec]:
    """기존 지수 목록에서 장중 대상만(환율은 region=US 라 코드로 고른다). 순서는 INTRADAY_CODES."""
    by_code = {s.code: s for s in index_specs()}
    return [by_code[c] for c in INTRADAY_CODES if c in by_code]


def today_value(rows: list[dict], today: date) -> float | None:
    """파싱된 일봉 중 오늘 날짜 봉의 현재값(close). 없으면 None — 장중에 오늘 봉을 주지 않는 TR 이면 여기서 걸린다."""
    for r in rows:
        if r["date"] == today:
            return float(r["close"])
    return None


def fetch_today(spec: IndexSpec, client, today: date) -> float | None:
    """기존 일별 조회(_fetch)를 오늘 하루 범위로 불러 오늘 봉의 현재값."""
    return today_value(_fetch(spec, client, today, today), today)


def merge_intraday(prev: dict, fresh: dict, now_ts: float) -> dict:
    """이전 값 + 새 값. 이번에 실패한 코드는 이전 값을 유지하되, INTRADAY_TTL 보다 오래된 항목은 버린다
    (키 하나에 합쳐 저장하므로 다른 코드가 성공할 때마다 TTL 이 늘어나 낡은 값이 영원히 남지 않게)."""
    kept = {}
    for code, item in prev.items():
        try:
            if now_ts - float(item["ts"]) <= INTRADAY_TTL:
                kept[code] = item
        except (KeyError, TypeError, ValueError):
            continue  # 형식이 깨진 항목은 버린다
    return {**kept, **fresh}


def load_intraday(redis) -> dict:
    """Redis 장중 값 — 없거나 JSON 이 깨졌으면 빈 dict. (Redis 연결 오류는 호출한 쪽이 처리)"""
    raw = redis.get(INTRADAY_KEY)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def poll(client, redis, now: datetime, fetch=None) -> dict:
    """대상마다 오늘 값 조회 → 성공한 것만 이전 값과 병합해 저장(TTL 10분). 전부 실패하면 Redis 를 건드리지 않는다.

    fetch(spec, client, today) -> float | None — 기본 fetch_today. 조회 TR 을 바꿀 때 이것만 바꿔 끼운다.
    """
    fetch = fetch or fetch_today
    today, ts = now.date(), now.timestamp()
    fresh: dict[str, dict] = {}
    failed: list[str] = []
    for spec in intraday_specs():
        try:
            value = fetch(spec, client, today)
        except Exception as e:  # noqa: BLE001 — 코드 하나 실패가 나머지를 막지 않게
            log.warning("장중 지수 조회 실패 %s(%s): %s", spec.code, spec.name, str(e)[:160])
            value = None
        if value is None:
            failed.append(spec.code)
            continue
        fresh[spec.code] = {"value": value, "date": today.isoformat(), "ts": int(ts)}
    if not fresh:
        log.warning("장중 지수 전부 실패 — Redis 는 그대로(10분 뒤 확정 종가로 돌아감): %s", failed)
        return {"ok": [], "failed": failed}
    merged = merge_intraday(load_intraday(redis), fresh, ts)
    redis.set(INTRADAY_KEY, json.dumps(merged), ex=INTRADAY_TTL)
    return {"ok": sorted(fresh), "failed": failed}
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_intraday_indices.py tests/test_market_indices.py -q -p no:warnings`
Expected: 모두 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/collector/intraday_indices.py backend/tests/test_intraday_indices.py
git commit -F - <<'EOF'
feat(collector): 장중 지수 수집 순수 로직 — 실행 창·오늘 값 추출·Redis 병합

거래일 09:00~15:35(KST)만, 국내 지수 3개·원/달러를 기존 일별 TR 로 오늘 봉 현재값을 받아
Redis market:intraday(TTL 10분)에 둔다. 실패한 코드는 이전 값 유지, 10분 넘은 값은 병합 때 버린다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

---

### Task 3: 태스크 `collector.poll_intraday_indices` + beat 30초 + env 스위치

**Files:**
- Modify: `backend/apps/collector/tasks/market_data.py` (import 1줄 + 태스크 추가)
- Modify: `backend/apps/collector/celery_app.py` (`beat_schedule` 항목 추가)
- Modify: `backend/.env.example`
- Test: `backend/tests/test_market_tasks.py` (테스트 2개 추가 + `test_beat_schedule_entries` 끝에 단언 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_market_tasks.py`

파일 맨 위 import 블록을 아래처럼 바꾼다(`datetime` 과 `intraday_indices` 추가):

```python
from datetime import date, datetime

import fakeredis
import pytest
import requests

from apps.collector import intraday_indices as ii
from apps.collector.kis.master import MasterStock
from apps.collector.tasks import market_data as md
from apps.collector.tasks import universe
from shared import pipeline_record
```

`test_beat_schedule_entries` 함수 **맨 끝**에 아래를 덧붙인다:

```python
    # 장중 지수 30초(2026-10-20) — 밀린 실행은 25초 뒤 버림. 끄기는 태스크 안의 env 스위치
    live = beat["poll-intraday-indices"]
    assert live["task"] == "collector.poll_intraday_indices"
    assert live["schedule"] == 30.0 and live["options"] == {"expires": 25}
```

파일 **맨 끝**에 아래 테스트를 추가한다:

```python
class _IntradayClient:
    def __init__(self):
        self.closed = False

    def get_domestic_index_daily(self, code, s, e):
        return [{"stck_bsop_date": s, "bstp_nmix_prpr": "2601.5"}]

    def get_overseas_daily(self, mrkt, symbol, s, e):
        return [{"stck_bsop_date": s, "ovrs_nmix_prpr": "1385.2"}]

    def close(self):
        self.closed = True


def _no_kis(*a, **k):
    raise AssertionError("장 밖·꺼짐에서는 KIS 클라이언트를 만들면 안 된다")


def test_poll_intraday_skips_without_kis(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.setattr(md, "KISClient", _no_kis)
    monkeypatch.setenv("INTRADAY_INDICES_ENABLED", "false")
    assert md.poll_intraday_indices() == {"skipped": "disabled"}
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED")
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 17, 10, 0, tzinfo=ii.KST))  # 토요일
    assert md.poll_intraday_indices() == {"skipped": "closed"}
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 20, 15, 35, tzinfo=ii.KST))  # 장 끝
    assert md.poll_intraday_indices() == {"skipped": "closed"}


def test_poll_intraday_runs_in_window(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED", raising=False)
    fake = fakeredis.FakeRedis(decode_responses=True)
    made = {}

    def make_client(limiter=None):
        made["limiter"], made["client"] = limiter, _IntradayClient()
        return made["client"]

    monkeypatch.setattr(md, "KISClient", make_client)
    monkeypatch.setattr(md, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 20, 14, 32, tzinfo=ii.KST))
    out = md.poll_intraday_indices()
    assert out["ok"] == sorted(ii.INTRADAY_CODES) and out["failed"] == []
    assert made["limiter"]._min_interval == pytest.approx(1 / ii.INTRADAY_RATE)  # 전용 초당 2건
    assert made["client"].closed is True
    assert fake.get(ii.INTRADAY_KEY) is not None


def test_poll_intraday_logs_kis_setup_error(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED", raising=False)

    def no_creds(limiter=None):
        raise RuntimeError("KIS 자격증명 없음")

    monkeypatch.setattr(md, "KISClient", no_creds)
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 20, 10, 0, tzinfo=ii.KST))
    out = md.poll_intraday_indices()
    assert "KIS 자격증명 없음" in out["error"]
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_market_tasks.py -q -p no:warnings`
Expected: FAIL — `KeyError: 'poll-intraday-indices'`, `AttributeError: ... has no attribute 'poll_intraday_indices'`(또는 `intraday`)

- [ ] **Step 3: 태스크 구현** — `backend/apps/collector/tasks/market_data.py`

import 블록의 `from apps.collector import market_parsers as mp` 바로 아래에 한 줄 추가:

```python
from apps.collector import intraday_indices as intraday
```

`# ---------------------------------------------------------------- 투자자별 순매수` 줄 **바로 위**에 추가:

```python
# ---------------------------------------------------------------- 장중 지수(30초)
@celery_app.task(name="collector.poll_intraday_indices")
def poll_intraday_indices() -> dict:
    """장중 국내 지수 3개·원/달러 → Redis market:intraday(30초 beat). 꺼짐·장 밖이면 KIS 를 부르지 않고 바로 끝.

    순서: env 스위치 → 거래일·시간 → (그때만) KIS 클라이언트 생성. 클라이언트 생성은 자격증명·Redis·세션을
    쓰므로 장 밖 30초마다 만들지 않는다. KIS·Redis 장애는 로그만 남기고 다음 주기에 다시 시도한다.
    """
    if not intraday.enabled():
        return {"skipped": "disabled"}
    now = intraday.now_kst()
    if not intraday.in_intraday_window(now):
        return {"skipped": "closed"}
    client = None
    try:
        client = KISClient(limiter=RateLimiter(intraday.INTRADAY_RATE))
        return intraday.poll(client, get_sync_redis(), now)
    except Exception as e:  # noqa: BLE001 — 장중 갱신 실패가 워커를 흔들지 않게(화면은 확정 종가로)
        log.warning("장중 지수 갱신 실패: %s", str(e)[:200])
        return {"error": repr(e)[:300]}
    finally:
        if client is not None:
            client.close()
```

- [ ] **Step 4: beat 추가** — `backend/apps/collector/celery_app.py`

`beat_schedule` 의 `"collect-kr-indices": {...},` 항목 **바로 뒤**에 추가:

```python
    # 장중 국내 지수·원/달러 30초 갱신(Redis market:intraday) — 거래일 09:00~15:35 KST 만 KIS 호출,
    # 그 밖에는 태스크가 바로 끝난다. 워커가 바빠 밀린 실행은 25초 뒤 버린다(몰아서 실행 방지).
    # 끄기: INTRADAY_INDICES_ENABLED=false. 설계 docs/superpowers/specs/2026-10-20-intraday-index-design.md
    "poll-intraday-indices": {
        "task": "collector.poll_intraday_indices",
        "schedule": 30.0,
        "options": {"expires": 25},
    },
```

- [ ] **Step 5: env 예시** — `backend/.env.example`

`# FUNDAMENTALS_Q_CUMULATIVE=` 줄 바로 아래에 추가:

```bash
# 장중 국내 지수·원/달러 30초 갱신(Redis market:intraday) — false 면 태스크가 KIS 를 부르지 않고 바로 끝남(기본 true)
# INTRADAY_INDICES_ENABLED=true
```

- [ ] **Step 6: 통과 확인**

Run: `cd backend && uv run pytest tests/test_market_tasks.py tests/test_intraday_indices.py tests/test_quiz_beat.py -q -p no:warnings`
Expected: 모두 passed

- [ ] **Step 7: 커밋**

```bash
git add backend/apps/collector/tasks/market_data.py backend/apps/collector/celery_app.py backend/.env.example backend/tests/test_market_tasks.py
git commit -F - <<'EOF'
feat(collector): 장중 지수 30초 태스크·beat — env 스위치, 장 밖이면 KIS 미호출

collector.poll_intraday_indices 를 30초 beat(expires 25)로 돌린다. INTRADAY_INDICES_ENABLED=false 면 바로 종료,
거래일 09:00~15:35 KST 가 아니면 KIS 클라이언트도 만들지 않는다. 전용 초당 2건 상한.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

---

### Task 4: ⚠️ 장중 TR 응답 확인 (사용자가 서버에서 1회 실행) + 결과별 분기

스펙 3절의 확인 단계. **에이전트는 실제 KIS 를 호출하지 않는다** — 아래 명령을 사용자에게 전달하고 출력 결과를 받는다.
결과를 받기 전에는 "4-A(변경 없음)" 로 가정하고 Task 5~9 를 계속 진행해도 된다(서로 독립). 결과가 4-B/4-C 면 해당 단계를 수행한 뒤 Task 9 의 전체 테스트를 다시 돌린다.

**Files:** (분기에 따라)
- 4-B: Modify `backend/apps/collector/kis/client.py`, `backend/apps/collector/market_parsers.py`, `backend/apps/collector/intraday_indices.py`, `backend/tests/test_intraday_indices.py`, `backend/tests/test_market_tasks.py`
- 4-C1: Modify `mobile/src/features/market/components/basis-note.tsx`, `web_client/src/components/market/BasisNote.tsx` (Task 6·8 뒤)
- 4-C2: Modify `backend/apps/collector/intraday_indices.py`, `backend/tests/test_intraday_indices.py`, `backend/tests/test_market_tasks.py`

- [ ] **Step 1: 사용자에게 확인 명령 전달** (거래일 10:00~15:00 사이, 운영 서버에서. 지금 배포된 코드만 쓰므로 이 기능 배포 전에도 실행 가능)

```bash
# 1분 간격으로 두 번 실행 — 값이 바뀌는지, MTS 와 같은지 본다
docker exec -i $(docker ps -qf name=stock_celery_worker -f status=running | head -1) python - <<'PY'
from datetime import datetime, timedelta, timezone
from apps.collector.kis.client import KISClient
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

now = datetime.now(timezone(timedelta(hours=9)))
today = now.strftime("%Y%m%d")
print("[지금 KST]", now.strftime("%Y-%m-%d %H:%M:%S"))
c = KISClient()
try:
    print("[국내 0001 일별 FHKUP03500100 오늘 범위]", c.get_domestic_index_daily("0001", today, today)[:1])
    print("[환율 FX@KRW 일별 FHKST03030100 오늘 범위]", c.get_overseas_daily("X", "FX@KRW", today, today)[:1])
    # 후보: 국내 업종 현재지수 TR — TR ID·경로는 기억에 기댄 값이라 여기서 검증한다
    url = f"{c.cfg.base_url}/uapi/domestic-stock/v1/quotations/inquire-index-price"
    try:
        body = c._request_with_retry("get", url, "FHPUP02100000",
                                     {"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": "0001"})
        out = body.get("output") or {}
        out = out[0] if isinstance(out, list) and out else out
        print("[후보 현재지수 TR FHPUP02100000]", {k: out.get(k) for k in ("bstp_nmix_prpr", "bstp_nmix_prdy_vrss", "bstp_nmix_prdy_ctrt")})
    except Exception as e:
        print("[후보 현재지수 TR 실패]", repr(e)[:200])
finally:
    c.close()
rows = get_client().query(f"SELECT max(date) FROM {CLICKHOUSE_DB}.market_index_daily FINAL WHERE code='FX:USDKRW'").result_rows
print("[CH 환율 확정 최신 날짜]", rows)
PY
```

사용자에게 받을 것: 두 번 실행한 출력 전체 + 같은 시각 한투 MTS 의 KOSPI·원/달러 값.

- [ ] **Step 2: 결과 판정** — 아래 표에서 해당 분기를 고른다(여러 개 가능: 예 4-B + 4-C1).

| 관찰 | 분기 |
|---|---|
| 국내 일별 응답에 **오늘 날짜**(`stck_bsop_date`=오늘) 행이 있고 `bstp_nmix_prpr` 가 두 번 사이에 바뀜·MTS 와 같음 | 국내 OK |
| 국내 일별 응답에 오늘 행이 없거나 값이 그대로(전일 종가) | **4-B** (후보 TR 출력에 `bstp_nmix_prpr` 가 숫자로 나왔을 때만. 후보 TR 도 실패면 멈추고 사용자와 상의 — KIS 문서에서 TR 확인) |
| 환율 응답에 오늘 행이 있고 값이 MTS 와 같음(분 단위 근접) | 환율 OK |
| 환율 오늘 행은 있으나 MTS 보다 수 분 이상 늦은 값 | **4-C1** (화면 문구에 "지연" 표시) |
| 환율 응답에 오늘 행이 없음, **또는** `[CH 환율 확정 최신 날짜]` 가 이미 오늘(아침 06:30/07:30 수집이 오늘 날짜 행을 씀 → 덧씌우기 조건 "확정 마지막 날짜 < 오늘" 이 영원히 거짓) | **4-C2** (환율을 장중 대상에서 뺀다) |
| 국내·환율 모두 OK, CH 환율 최신 날짜 < 오늘 | **4-A** — 코드 변경 없음, Step 3 이후 생략 |

- [ ] **Step 3 (4-B 만): 현재지수 TR 로 바꾸는 실패 테스트** — `backend/tests/test_intraday_indices.py`

`_Client` 클래스 안에 메서드를 추가한다:

```python
    def get_domestic_index_price(self, code):
        self.calls.append(("price", code))
        if code in self.fail:
            raise RuntimeError("KIS rt_cd=1")
        return {"bstp_nmix_prpr": self.PRICES[code]}
```

`test_poll_counts_missing_today_bar_as_failure` 를 아래로 **교체**한다(국내는 날짜 없는 현재지수라 어제 봉 문제는 환율에만 남는다):

```python
def test_poll_counts_missing_today_bar_as_failure():
    # 환율 일별 TR 이 오늘 봉을 주지 않으면 환율만 실패, 국내(현재지수 TR)는 저장
    r = fakeredis.FakeRedis(decode_responses=True)
    out = ii.poll(_Client(day="20261019"), r, NOW)
    assert out == {"ok": ["KR:0001", "KR:1001", "KR:2001"], "failed": ["FX:USDKRW"]}


def test_domestic_uses_current_index_tr():
    c = _Client()
    ii.poll(c, fakeredis.FakeRedis(decode_responses=True), NOW)
    assert ("price", "0001") in c.calls and not any(x[0] == "U" for x in c.calls)
```

같은 파일 `test_poll_writes_all_four_with_ttl` 의 마지막 단언에서 `("U", "0001", "20261020", "20261020") in c.calls` 를 `("price", "0001") in c.calls` 로 바꾼다.

`backend/tests/test_market_tasks.py` 의 `_IntradayClient` 에도 추가:

```python
    def get_domestic_index_price(self, code):
        return {"bstp_nmix_prpr": "2601.5"}
```

Run: `cd backend && uv run pytest tests/test_intraday_indices.py -q -p no:warnings`
Expected: FAIL — `test_domestic_uses_current_index_tr`(아직 일별 TR 사용), `test_poll_counts_missing_today_bar_as_failure`

- [ ] **Step 4 (4-B 만): 구현**

`backend/apps/collector/kis/client.py` — 상수 `TR_INDEX_DAILY` 줄 아래에 추가(값은 Step 1 출력으로 검증된 것):

```python
TR_INDEX_PRICE = "FHPUP02100000"  # 국내업종 현재지수 — 장중 지수(2026-10-20 운영 서버에서 응답 확인)
```

`get_domestic_index_daily` 메서드 바로 아래에 추가:

```python
    def get_domestic_index_price(self, index_code: str) -> dict:
        """국내 업종 현재지수(output 단건) — 장중 지수용. 날짜가 없어 장 시간 안에서만 부른다."""
        url = f"{self.cfg.base_url}/uapi/domestic-stock/v1/quotations/inquire-index-price"
        params = {"FID_COND_MRKT_DIV_CODE": "U", "FID_INPUT_ISCD": index_code}
        out = _as_list(self._request_with_retry("get", url, TR_INDEX_PRICE, params).get("output"))
        return out[0] if out else {}
```

`backend/apps/collector/market_parsers.py` — `parse_overseas_daily` 아래에 추가:

```python
def parse_index_price(out) -> float | None:
    """국내 업종 현재지수 응답 → 현재 지수(bstp_nmix_prpr). 없으면 None."""
    return _f((out or {}).get("bstp_nmix_prpr"))
```

`backend/apps/collector/intraday_indices.py` — import 에 `from apps.collector import market_parsers as mp` 를 추가하고, `fetch_today` 아래에 함수 추가:

```python
def fetch_live(spec: IndexSpec, client, today: date) -> float | None:
    """국내 지수는 업종 현재지수 TR(일별 TR 이 장중 오늘 봉을 주지 않음 — 2026-10-20 확인), 환율은 일별 TR 의 오늘 봉."""
    if spec.kind == "KR":
        return mp.parse_index_price(client.get_domestic_index_price(spec.symbol))
    return fetch_today(spec, client, today)
```

`poll` 본문 첫 줄 `fetch = fetch or fetch_today` 를 `fetch = fetch or fetch_live` 로 바꾸고, docstring 의 "기본 fetch_today" 를 "기본 fetch_live" 로 고친다.
모듈 docstring 의 조회 설명 줄을 "국내 업종 현재지수 TR(FHPUP02100000), 환율은 기존 일별 TR(FHKST03030100 X)의 오늘 봉" 으로 고친다.

Run: `cd backend && uv run pytest tests/test_intraday_indices.py tests/test_market_tasks.py tests/test_market_parsers.py -q -p no:warnings`
Expected: 모두 passed

```bash
git add backend/apps/collector/kis/client.py backend/apps/collector/market_parsers.py backend/apps/collector/intraday_indices.py backend/tests/test_intraday_indices.py backend/tests/test_market_tasks.py
git commit -F - <<'EOF'
fix(collector): 장중 국내 지수는 업종 현재지수 TR 로 — 일별 TR 이 장중 오늘 봉을 주지 않음

운영 서버 확인 결과에 따라 국내 3개 지수는 FHPUP02100000(현재지수), 환율은 일별 TR 의 오늘 봉을 그대로 쓴다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

- [ ] **Step 5 (4-C1 만, Task 6·8 뒤에): 환율 "지연" 문구**

`mobile/src/features/market/components/basis-note.tsx` 와 `web_client/src/components/market/BasisNote.tsx` 의 문구 `국내 지수 장중 30초 · ` 를 `국내 지수 장중 30초(환율은 지연 시세) · ` 로 바꾼다(나머지 그대로).

Run: `cd mobile && npx tsc --noEmit` / `cd web_client && npx tsc --noEmit`
Expected: 오류 없음

```bash
git add mobile/src/features/market/components/basis-note.tsx web_client/src/components/market/BasisNote.tsx
git commit -F - <<'EOF'
docs(market): 기준 안내에 장중 환율 지연 시세 표기

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

- [ ] **Step 6 (4-C2 만): 환율을 장중 대상에서 빼기**

`backend/apps/collector/intraday_indices.py`:

```python
# 원/달러는 2026-10-20 확인 결과(장중 오늘 봉 없음 또는 아침 수집이 오늘 날짜 확정 행을 씀)로 제외 — 확정 값만 보인다
INTRADAY_CODES = ("KR:0001", "KR:1001", "KR:2001")
```

`backend/tests/test_intraday_indices.py` 의 `test_intraday_specs_are_three_kr_indices_and_usdkrw` 를 아래로 교체:

```python
def test_intraday_specs_are_three_kr_indices():
    assert [s.code for s in ii.intraday_specs()] == ["KR:0001", "KR:1001", "KR:2001"]
```

같은 파일 `test_poll_writes_all_four_with_ttl` 에서 `assert saved["FX:USDKRW"]["value"] == 1385.2` 줄을 지우고, `and ("X", "FX@KRW", "20261020", "20261020") in c.calls` 부분을 지운다.
`test_poll_all_fail_does_not_touch_redis` 의 `len(out["failed"]) == 4` 를 `== 3` 으로 바꾼다.
`test_poll_uses_injected_fetch` 의 `len(out["failed"]) == 3` 을 `== 2` 로 바꾼다.

Run: `cd backend && uv run pytest tests/test_intraday_indices.py tests/test_market_tasks.py -q -p no:warnings`
Expected: 모두 passed

```bash
git add backend/apps/collector/intraday_indices.py backend/tests/test_intraday_indices.py
git commit -F - <<'EOF'
fix(collector): 장중 갱신 대상에서 원/달러 제외 — 운영 확인 결과 반영

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

README·`docs/server_setup.md`(Task 9)의 "원/달러" 언급도 빼고, 화면 문구는 그대로 둔다(국내 지수만 장중).

---

### Task 5: API — 장중 값 덧씌우기 + 30초 캐시 + GraphQL `live`·`asOf`

**Files:**
- Modify: `backend/apps/stock_api/services/market_query.py`
- Modify: `backend/apps/stock_api/graphql/types.py` (`MarketIndex`)
- Test: `backend/tests/test_market_query.py`

이 작업에서 정의하는 이름: `CACHE_SECONDS`, `_CACHE`, `_clock()`, `_now_kst()`, `_intraday()`, `_cached_query(name, key, sql, params)`, `_live_point(cur, today_iso)`, `overlay_intraday(series, intraday, today)`. 서비스 dict 키는 `live`·`as_of`(GraphQL 에서 자동으로 `asOf`).

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_market_query.py`

맨 위 import 를 아래로 바꾼다:

```python
from datetime import date, datetime

import pytest

from apps.collector.intraday_indices import KST
from apps.stock_api.services import market_query as mq
```

`ch` fixture 정의 **바로 아래**에 autouse fixture 를 추가한다(캐시가 테스트 사이에 새는 것 방지 — `_FakeCH` 는 결과를 순서대로 꺼내므로 필수):

```python
@pytest.fixture(autouse=True)
def _isolate_cache_and_intraday(monkeypatch):
    """지수·거시 30초 캐시를 테스트마다 비우고, 장중 값은 기본 없음(Redis 를 읽지 않음)."""
    mq._CACHE.clear()
    monkeypatch.setattr(mq, "_intraday", lambda: {})
```

`test_overview_tables_missing` 함수 **바로 아래**에 추가:

```python
TODAY = date(2026, 10, 20)
TS = datetime(2026, 10, 20, 14, 32, 5, tzinfo=KST).timestamp()


def _ix(code="KR:0001", d="2026-10-16", close=2550.0, spark=None):
    return {"code": code, "name": "KOSPI", "region": code.split(":", 1)[0], "date": d, "close": close,
            "chg1d": 1.0, "spark": spark if spark is not None else [2500.0, 2550.0]}


def test_overlay_appends_live_point():
    item = _ix()
    (o,) = mq.overlay_intraday([item], {"KR:0001": {"value": 2601.0, "date": "2026-10-20", "ts": TS}}, TODAY)
    assert o["live"] is True and o["as_of"] == "14:32" and o["date"] == "2026-10-20"
    assert o["close"] == 2601.0 and o["chg1d"] == pytest.approx(2.0)  # 마지막 확정 종가 대비 %(_pct)
    assert o["spark"] == [2500.0, 2550.0, 2601.0]
    assert item["spark"] == [2500.0, 2550.0] and "live" not in item  # 입력은 바꾸지 않는다


def test_overlay_keeps_spark_length():
    spark = [float(i) for i in range(mq.SPARK_POINTS)]
    live = {"KR:0001": {"value": 99.0, "date": "2026-10-20", "ts": TS}}
    (o,) = mq.overlay_intraday([_ix(spark=spark, close=spark[-1])], live, TODAY)
    assert len(o["spark"]) == mq.SPARK_POINTS and o["spark"][0] == 1.0 and o["spark"][-1] == 99.0


@pytest.mark.parametrize("item, live", [
    (_ix(d="2026-10-20"), {"value": 2601.0, "date": "2026-10-20", "ts": TS}),  # 오늘 확정 종가가 이미 있음
    (_ix(), {"value": 2601.0, "date": "2026-10-19", "ts": TS}),               # 어제 장중 값
    (_ix(), {"value": "x", "date": "2026-10-20", "ts": TS}),                   # 깨진 값
    (_ix(), {"date": "2026-10-20", "ts": TS}),                                 # 값 없음
    (_ix(), "garbage"),                                                        # 항목 형식이 아님
    (_ix(), None),                                                             # 장중 값 없음
])
def test_overlay_keeps_confirmed(item, live):
    intraday = {} if live is None else {"KR:0001": live}
    (o,) = mq.overlay_intraday([item], intraday, TODAY)
    assert o == {**item, "live": False, "as_of": None}


def test_overview_overlays_intraday_and_caches_ch(ch, monkeypatch):
    fake = ch([[("KR:0001", date(2026, 10, 15), 2500.0), ("KR:0001", D, 2550.0)], []])
    monkeypatch.setattr(mq, "_now_kst", lambda: datetime(2026, 10, 20, 14, 33, tzinfo=KST))
    monkeypatch.setattr(mq, "_intraday", lambda: {"KR:0001": {"value": 2601.0, "date": "2026-10-20", "ts": TS}})
    first = mq.overview()["indices"][0]
    assert first["live"] is True and first["close"] == 2601.0 and first["as_of"] == "14:32"
    monkeypatch.setattr(mq, "_intraday",
                        lambda: {"KR:0001": {"value": 2610.0, "date": "2026-10-20", "ts": TS + 60}})
    second = mq.overview()["indices"][0]
    assert second["close"] == 2610.0 and second["as_of"] == "14:33"  # 장중 값은 매번 새로 읽는다
    assert len(fake.queries) == 2  # 지수·거시 각 1번 — 두 번째 호출은 CH 캐시


def test_cache_expires_after_30s(ch, monkeypatch):
    fake = ch([[("KR:0001", D, 2550.0)], [], [("KR:0001", D, 2560.0)], []])
    clock = {"t": 1000.0}
    monkeypatch.setattr(mq, "_clock", lambda: clock["t"])
    assert mq.overview()["indices"][0]["close"] == 2550.0
    clock["t"] += 29
    assert mq.overview()["indices"][0]["close"] == 2550.0
    clock["t"] += 2
    assert mq.overview()["indices"][0]["close"] == 2560.0
    assert len(fake.queries) == 4


def test_cache_skips_failures(ch, monkeypatch):
    # 1번째 overview: 지수 쿼리 실패(캐시 안 함) → 거시는 [] 를 꺼냄. 2번째: 지수만 다시 조회
    real = ch([[], [("KR:0001", D, 2550.0)]])
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("CH down")
        return real

    monkeypatch.setattr(mq, "_ch", flaky)
    assert mq.overview()["indices"] == []
    assert mq.overview()["indices"][0]["close"] == 2550.0


def test_intraday_reader_swallows_redis_errors(monkeypatch):
    monkeypatch.undo()  # autouse 의 _intraday 바꿔치기를 되돌려 실제 함수를 검사
    mq._CACHE.clear()

    class Down:
        def get(self, key):
            raise ConnectionError("redis down")

    monkeypatch.setattr(mq, "get_sync_redis", lambda: Down())
    assert mq._intraday() == {}


def test_graphql_market_index_live_fields(monkeypatch):
    from apps.stock_api.graphql.schema import schema

    monkeypatch.setattr(mq, "overview", lambda: {"indices": [
        {**_ix(), "live": True, "as_of": "14:32"},
        _ix(code="US:SPX"),  # 옛 형태(live·as_of 없음)도 기본값으로 — 하위 호환
    ], "macro": []})
    res = schema.execute_sync("{ marketOverview { indices { code live asOf } } }")
    assert res.errors is None, res.errors
    assert res.data["marketOverview"]["indices"] == [
        {"code": "KR:0001", "live": True, "asOf": "14:32"},
        {"code": "US:SPX", "live": False, "asOf": None},
    ]
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_market_query.py -q -p no:warnings`
Expected: FAIL — `AttributeError: module ... has no attribute '_CACHE'` (autouse 라 대부분의 테스트가 같은 이유로 실패)

- [ ] **Step 3: 서비스 구현** — `backend/apps/stock_api/services/market_query.py`

import 블록을 아래로 바꾼다:

```python
from __future__ import annotations

import time
from datetime import date, datetime, timedelta

from apps.collector.intraday_indices import KST, load_intraday
from apps.collector.market_indices import _BASE as INDEX_SPECS
from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.database import SyncSessionLocal
from shared.market_models import StockEvent, Theme
from shared.sync_redis import get_sync_redis
```

`SPARK_POINTS = 20` 줄 아래에 추가:

```python
# 지수·거시 CH 조회 메모리 캐시(프로세스별) — 화면이 30초마다 개요를 다시 부르므로 사용자 수만큼 CH 로 가지 않게.
# Redis 장중 값은 캐시하지 않는다(덧씌우기는 매번).
CACHE_SECONDS = 30
_CACHE: dict[str, tuple[float, object, list]] = {}  # 이름 → (만료 시각 monotonic, 키, 행)
```

`def _today()` 함수 **바로 아래**에 추가:

```python
def _clock() -> float:
    return time.monotonic()


def _now_kst() -> datetime:
    """장중 덧씌우기 기준 시각 — 컨테이너 TZ 와 무관하게 KST."""
    return datetime.now(KST)


def _intraday() -> dict:
    """Redis 장중 값(collector.poll_intraday_indices). Redis 장애·형식 오류면 빈 값 — 확정 값만 보인다."""
    try:
        return load_intraday(get_sync_redis())
    except Exception:  # noqa: BLE001
        return {}


def _cached_query(name: str, key, sql: str, params: dict) -> list:
    """같은 key 로 CACHE_SECONDS 안에 다시 부르면 저장해 둔 행. 실패(예외)는 저장하지 않고 그대로 올린다."""
    now = _clock()
    hit = _CACHE.get(name)
    if hit is not None and hit[0] > now and hit[1] == key:
        return hit[2]
    rows = _query(sql, params)
    _CACHE[name] = (now + CACHE_SECONDS, key, rows)
    return rows
```

`_indices()` 함수 전체를 아래로 **교체**하고, 그 위에 `_live_point`·`overlay_intraday` 를 추가한다:

```python
def _live_point(cur, today_iso: str) -> tuple[float, str] | None:
    """장중 값 한 항목 → (값, KST 'HH:MM'). 오늘 것이 아니거나 형식이 깨졌으면 None."""
    if not isinstance(cur, dict) or cur.get("date") != today_iso:
        return None
    try:
        return float(cur["value"]), datetime.fromtimestamp(float(cur["ts"]), KST).strftime("%H:%M")
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        return None


def overlay_intraday(series: list[dict], intraday: dict, today: date) -> list[dict]:
    """확정 종가 지수 목록에 장중 값을 덧씌운다(순수 함수 — 입력을 바꾸지 않음).

    코드별로 장중 값의 date 가 오늘이고 확정 종가 마지막 날짜가 오늘보다 앞이면(= 오늘 종가 미확정):
    추세선 끝에 한 점(길이는 SPARK_POINTS 유지), close = 장중 값, chg1d = 마지막 확정 종가 대비 %(_pct),
    date = 오늘, live = True, as_of = 'HH:MM'. 아니면 확정 값 그대로 live = False, as_of = None.
    """
    iso = today.isoformat()
    out = []
    for item in series:
        base = {**item, "live": False, "as_of": None}
        point = _live_point(intraday.get(item["code"]), iso) if item["date"] < iso else None
        if point is None:
            out.append(base)
            continue
        value, as_of = point
        out.append({**base, "date": iso, "close": value, "chg1d": _pct(value, item["close"]),
                    "spark": (list(item["spark"]) + [value])[-SPARK_POINTS:], "live": True, "as_of": as_of})
    return out


def _indices() -> list[dict]:
    codes = [s.code for s in INDEX_SPECS]
    today = _today()
    try:
        rows = _cached_query("indices", today,
                             f"SELECT code, date, close FROM {CLICKHOUSE_DB}.market_index_daily FINAL "
                             "WHERE code IN %(codes)s AND date > %(since)s ORDER BY code, date",
                             {"codes": tuple(codes), "since": today - timedelta(days=60)})
    except Exception:  # noqa: BLE001
        return []
    series: dict[str, list[tuple]] = {}
    for code, d, close in rows:
        series.setdefault(code, []).append((d, float(close)))
    out = []
    for spec in INDEX_SPECS:
        pts = series.get(spec.code)
        if not pts:
            continue
        closes = [c for _, c in pts]
        out.append({"code": spec.code, "name": spec.name, "region": spec.code.split(":", 1)[0],
                    "date": pts[-1][0].isoformat(), "close": closes[-1],
                    "chg1d": _pct(closes[-1], closes[-2]) if len(closes) > 1 else None,
                    "spark": closes[-SPARK_POINTS:]})
    return overlay_intraday(out, _intraday(), _now_kst().date())
```

`_macro()` 맨 앞의 `try: rows = _query(...) except Exception: return []` 블록 전체를 아래로 **교체**한다(나머지 본문은 그대로):

```python
    today = _today()
    try:
        rows = _cached_query("macro", today,
                             f"SELECT series_id, date, value FROM {CLICKHOUSE_DB}.macro_series FINAL "
                             "WHERE series_id IN %(ids)s AND date > %(since)s AND value IS NOT NULL "
                             "ORDER BY series_id, date",
                             {"ids": tuple(MACRO_NAMES), "since": today - timedelta(days=430)})
    except Exception:  # noqa: BLE001
        return []
```

- [ ] **Step 4: GraphQL 타입** — `backend/apps/stock_api/graphql/types.py` 의 `MarketIndex` 끝(`spark: list[float]` 아래)에 추가

```python
    live: bool = False  # 장중 값이 덧씌워졌는가(국내 지수·원/달러, 거래일 09:00~15:35 KST)
    as_of: str | None = None  # 장중 값 시각(KST 'HH:MM') — live 일 때만
```

리졸버(`schema.py` 의 `MarketIndex(**i)`)는 그대로 — 서비스 dict 의 `live`·`as_of` 가 그대로 들어가고, 없으면 기본값.

- [ ] **Step 5: 통과 확인**

Run: `cd backend && uv run pytest tests/test_market_query.py tests/test_market_admin_api.py -q -p no:warnings`
Expected: 모두 passed (기존 `test_overview_indices_and_macro_yoy`·`test_graphql_wiring`·웹/모바일 계약 테스트 포함)

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/stock_api/services/market_query.py backend/apps/stock_api/graphql/types.py backend/tests/test_market_query.py
git commit -F - <<'EOF'
feat(stock_api): 시장 개요에 장중 지수 덧씌우기 + GraphQL live·asOf + CH 30초 캐시

Redis market:intraday 의 오늘 값이 있고 오늘 종가가 아직 없으면 추세선 끝에 붙이고 close·chg1d·date 를 바꾼다.
Redis 장애면 확정 값만. 30초 자동 새로고침 대비 지수·거시 CH 조회는 프로세스 메모리 30초 캐시.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

---

### Task 6: 모바일 — 타입·쿼리·장중 배지·기준 안내 문구

**Files:**
- Modify: `mobile/src/features/market/types.ts`, `mobile/src/features/market/api.ts`, `mobile/src/features/market/format.ts`
- Modify: `mobile/src/features/market/components/index-card.tsx`, `mobile/src/features/market/components/basis-note.tsx`
- Test: `mobile/src/features/market/format.test.ts`, `backend/tests/test_market_query.py` (모바일 쿼리 계약)

이 작업에서 정의하는 이름: `indexBadge(ix)` → `{ text: string; live: boolean } | null`, 백엔드 테스트 도우미 `_overview_query(rel_path)`.

- [ ] **Step 1: 실패하는 테스트 작성 (계약)** — `backend/tests/test_market_query.py` 맨 끝에 추가

```python
def _overview_query(rel_path: str) -> str:
    """프론트 파일의 OVERVIEW_QUERY 문자열."""
    import pathlib
    import re

    ts = (pathlib.Path(__file__).resolve().parents[2] / rel_path).read_text(encoding="utf-8")
    return dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", ts))["OVERVIEW_QUERY"]


def test_mobile_overview_requests_live_fields():
    import re

    q = _overview_query("mobile/src/features/market/api.ts")
    assert re.search(r"\blive\b", q) and re.search(r"\basOf\b", q)
```

- [ ] **Step 2: 실패하는 테스트 작성 (배지)** — `mobile/src/features/market/format.test.ts`

맨 위 `import { … } from './format';` 목록의 `hasMoreGroups,` 다음 줄에 `indexBadge,` 를 넣는다. 파일 맨 끝에 추가:

```ts
describe('지수 카드 날짜 자리(장중 배지)', () => {
  const ix = { region: 'KR', date: '2026-10-16', live: false, asOf: null };
  it('장중이면 "장중 HH:MM" 배지', () => {
    expect(indexBadge({ ...ix, live: true, asOf: '14:32' })).toEqual({ text: '장중 14:32', live: true });
    expect(indexBadge({ ...ix, region: 'FX', live: true, asOf: '09:05' })).toEqual({ text: '장중 09:05', live: true });
  });
  it('확정 값이면 국내는 없음, 해외·환율은 MM/DD(지금과 같음)', () => {
    expect(indexBadge(ix)).toBeNull();
    expect(indexBadge({ ...ix, region: 'US' })).toEqual({ text: '10/16', live: false });
    expect(indexBadge({ ...ix, region: 'FX', date: '2026-09-05' })).toEqual({ text: '09/05', live: false });
  });
  it('live 인데 시각이 없으면 확정처럼 다룬다', () => {
    expect(indexBadge({ ...ix, live: true, asOf: null })).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd backend && uv run pytest tests/test_market_query.py -q -p no:warnings -k live_fields`
Expected: FAIL — `test_mobile_overview_requests_live_fields` (AssertionError)

Run: `cd mobile && npx jest src/features/market/format.test.ts`
Expected: FAIL — `indexBadge is not a function`(또는 import 오류)

- [ ] **Step 4: 타입** — `mobile/src/features/market/types.ts` 의 `MarketIndex` 에서 `spark: number[];` 아래에 추가

```ts
  live: boolean; // 장중 값이 덧씌워졌는가(국내 지수·원/달러, 거래일 09:00~15:35)
  asOf: string | null; // 장중 값 시각 KST 'HH:MM' — live 일 때만
```

- [ ] **Step 5: 쿼리** — `mobile/src/features/market/api.ts` 의 `OVERVIEW_QUERY` 에서 indices 줄을 바꾼다

```ts
    indices { code name region date close chg1d spark live asOf }
```

- [ ] **Step 6: 배지 함수** — `mobile/src/features/market/format.ts`

import 줄 `import type { CalendarEvent, GroupItem } from './types';` 를 아래로 바꾼다:

```ts
import type { CalendarEvent, GroupItem, MarketIndex } from './types';
```

`formatIndex` 함수 바로 아래에 추가:

```ts
/** 지수 카드 날짜 자리 — 장중이면 '장중 14:32'(live), 국내 확정이면 없음, 해외·환율은 MM/DD */
export function indexBadge(
  ix: Pick<MarketIndex, 'region' | 'date' | 'live' | 'asOf'>,
): { text: string; live: boolean } | null {
  if (ix.live && ix.asOf) return { text: `장중 ${ix.asOf}`, live: true };
  if (ix.region === 'KR') return null;
  return { text: ix.date.slice(5).replace('-', '/'), live: false };
}
```

- [ ] **Step 7: 지수 카드** — `mobile/src/features/market/components/index-card.tsx`

import 줄을 바꾼다:

```tsx
import { formatChg, formatIndex, formatMacro, formatMacroDiff, indexBadge, toneOf } from '../format';
```

`IndexCard` 함수 전체를 아래로 **교체**한다:

```tsx
/** 지수 카드 — 이름·날짜 자리(장중 배지 / 해외 MM/DD)·종가·등락률·미니 추세선. 2열 배치용(width 48%) */
export function IndexCard({ index }: { index: MarketIndex }) {
  const badge = indexBadge(index);
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${index.name}${badge?.live ? ` ${badge.text} 기준` : ''} ${formatIndex(index.close)}, 전일 대비 ${formatChg(index.chg1d)}`}
    >
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>{index.name}</Text>
        {badge == null ? null : <Text style={badge.live ? styles.live : styles.date}>{badge.text}</Text>}
      </View>
      <Text style={styles.close} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatIndex(index.close)}</Text>
      <Text style={[styles.chg, styles[toneOf(index.chg1d)]]}>{formatChg(index.chg1d)}</Text>
      <Sparkline values={index.spark} />
    </View>
  );
}
```

`styles` 의 `date: {...},` 줄 바로 아래에 추가(파스텔 블루 배지 — `primarySoft` 바탕·`primary` 글자):

```tsx
  live: {
    fontSize: 11, fontWeight: '700', color: theme.colors.primary, backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.chip, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
```

- [ ] **Step 8: 기준 안내** — `mobile/src/features/market/components/basis-note.tsx` 의 `<Text>` 내용을 바꾼다

```tsx
      {date ? `기준일 ${date} · ` : ''}국내 지수 장중 30초 · 15:40 확정 · 종목·테마·업종 20:30 · 미국 06:30 갱신 · 투자 권유가 아닙니다
```

- [ ] **Step 9: 통과 확인**

Run: `cd mobile && npx jest src/features/market && npx tsc --noEmit`
Expected: jest 모두 passed, tsc 오류 없음

Run: `cd backend && uv run pytest tests/test_market_query.py -q -p no:warnings`
Expected: 모두 passed(모바일 쿼리 계약 `test_mobile_queries_match_schema` 포함 — 새 필드가 실제 스키마에 있음)

- [ ] **Step 10: 커밋**

```bash
git add mobile/src/features/market/types.ts mobile/src/features/market/api.ts mobile/src/features/market/format.ts mobile/src/features/market/format.test.ts mobile/src/features/market/components/index-card.tsx mobile/src/features/market/components/basis-note.tsx backend/tests/test_market_query.py
git commit -F - <<'EOF'
feat(mobile): 시장 칩 지수 카드에 "장중 HH:MM" 배지 + 기준 안내 문구

marketOverview 에 live·asOf 를 받아 장중이면 파스텔 블루 배지, 아니면 지금처럼(국내 없음, 해외 MM/DD).
모바일 쿼리가 live·asOf 를 요청하는지 계약 테스트로 고정.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

---

### Task 7: 모바일 — 화면이 보일 때만 30초 조용한 새로고침

**Files:**
- Create: `mobile/src/features/market/auto-refresh.ts`
- Create: `mobile/src/features/market/use-auto-refresh.ts`
- Modify: `mobile/src/features/market/use-market-overview.ts` (요청 번호 게이트 + `silentRefresh`)
- Modify: `mobile/src/features/market/sections/market-section.tsx`
- Test: `mobile/src/features/market/auto-refresh.test.ts`

이 작업에서 정의하는 이름: `MARKET_REFRESH_MS`, `createSilentRunner(run)`, `useAutoRefresh(run, ms?)`, `useMarketOverview().silentRefresh`.
jest 는 `*.test.ts`(순수 로직)만 돌리므로 판단은 `auto-refresh.ts` 에 두고, 훅은 이것과 이미 테스트된 `startForegroundInterval`(포그라운드일 때만 호출)을 묶기만 한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `mobile/src/features/market/auto-refresh.test.ts`

```ts
import { startForegroundInterval } from '@/features/game/lib/foreground-interval';

import { createSilentRunner, MARKET_REFRESH_MS } from './auto-refresh';

/** 프로미스 연쇄(then·catch·finally)가 끝날 때까지 마이크로태스크를 흘려보낸다 */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('createSilentRunner', () => {
  it('앞 실행이 끝나기 전 호출은 건너뛴다', async () => {
    let finish: () => void = () => undefined;
    const run = jest.fn(() => new Promise<void>((r) => { finish = r; }));
    const tick = createSilentRunner(run);
    tick();
    tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('실패해도 던지지 않고(토스트 없음) 다음 호출은 다시 실행한다', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValue(undefined);
    const tick = createSilentRunner(run);
    tick();
    await flush();
    tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('동기 예외도 삼킨다', async () => {
    const run = jest.fn((): Promise<unknown> => {
      throw new Error('boom');
    });
    const tick = createSilentRunner(run);
    expect(() => tick()).not.toThrow();
    await flush();
    tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('30초 자동 새로고침(포그라운드 주기 + 조용한 실행기)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('앱이 앞에 있을 때만 30초마다 부르고, 정지(화면 이탈) 뒤에는 부르지 않는다', async () => {
    let state = 'active';
    const run = jest.fn(() => Promise.resolve());
    const stop = startForegroundInterval(createSilentRunner(run), MARKET_REFRESH_MS, () => state);
    jest.advanceTimersByTime(MARKET_REFRESH_MS - 1);
    await flush();
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    state = 'background';
    jest.advanceTimersByTime(MARKET_REFRESH_MS * 3);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    state = 'active';
    stop(); // useFocusEffect 정리 = 다른 탭·상세 화면으로 이동
    jest.advanceTimersByTime(MARKET_REFRESH_MS * 3);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(MARKET_REFRESH_MS).toBe(30_000);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/market/auto-refresh.test.ts`
Expected: FAIL — `Cannot find module './auto-refresh'`

- [ ] **Step 3: 조용한 실행기** — `mobile/src/features/market/auto-refresh.ts`

```ts
/** 시장 칩 자동 새로고침 주기 — 서버 장중 수집 주기(30초)와 같다 */
export const MARKET_REFRESH_MS = 30_000;

/**
 * 조용한 새로고침 실행기 — 스피너·토스트 없이 run 을 부른다.
 * - 앞 실행이 끝나기 전 호출은 건너뜀(느린 네트워크에서 요청이 쌓이지 않게)
 * - 실패(동기 예외 포함)는 삼킨다 — 다음 주기에 다시 시도
 */
export function createSilentRunner(run: () => Promise<unknown>): () => void {
  let busy = false;
  return () => {
    if (busy) return;
    busy = true;
    Promise.resolve()
      .then(run)
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && npx jest src/features/market/auto-refresh.test.ts`
Expected: 4 passed

- [ ] **Step 5: 훅** — `mobile/src/features/market/use-auto-refresh.ts`

```ts
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { startForegroundInterval } from '@/features/game/lib/foreground-interval';

import { createSilentRunner, MARKET_REFRESH_MS } from './auto-refresh';

/**
 * 화면이 포커스되어 있고 앱이 앞(AppState active)에 있는 동안만 ms 마다 run 을 조용히 부른다.
 * - 포커스를 잃거나(다른 탭·상세 화면) 컴포넌트가 사라지면 useFocusEffect 정리로 타이머를 멈춘다
 * - 백그라운드에서는 주기마다 건너뛴다(startForegroundInterval)
 * - run 은 최신 것을 쓴다(타이머 재생성 없음). 장 시간이 아니어도 돌지만 서버가 같은 값을 줄 뿐이다
 */
export function useAutoRefresh(run: () => Promise<unknown>, ms = MARKET_REFRESH_MS) {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useFocusEffect(
    useCallback(() => startForegroundInterval(createSilentRunner(() => runRef.current()), ms), [ms]),
  );
}
```

- [ ] **Step 6: 개요 훅** — `mobile/src/features/market/use-market-overview.ts` 전체를 아래로 **교체**

```ts
import { useCallback, useEffect, useState } from 'react';

import { kstDateString } from '@/features/game/lib/format';

import { fetchMarketCalendar, fetchMarketGroups, fetchMarketOverview } from './api';
import { errorCode, shiftDate } from './format';
import { createLatest } from './latest';
import type { CalendarEvent, GroupItem, MarketOverview } from './types';

type Data = { overview: MarketOverview; themes: GroupItem[]; date: string | null; events: CalendarEvent[] };
type State = { data: Data | null; loading: boolean; error: string | null };

/** 개요·주도 테마 Top 5·다가오는 일정 3건을 따로 불러온다. 개요가 실패하면 오류, 나머지는 실패해도 그 칸만 비운다. */
async function fetchAll(): Promise<Data> {
  const today = kstDateString();
  const [ov, th, ev] = await Promise.allSettled([
    fetchMarketOverview(),
    fetchMarketGroups('theme', '1d', 'chg', 0, 5),
    fetchMarketCalendar(today, shiftDate(today, 60)),
  ]);
  if (ov.status === 'rejected') throw ov.reason;
  return {
    overview: ov.value,
    themes: th.status === 'fulfilled' ? th.value.items : [],
    date: th.status === 'fulfilled' ? th.value.date : null,
    events: ev.status === 'fulfilled' ? ev.value.slice(0, 3) : [],
  };
}

export function useMarketOverview() {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });
  // 요청 번호 — 늦게 도착한 옛 응답(당겨서 새로고침·자동 새로고침)이 새 결과를 덮지 않게
  const [gate] = useState(createLatest);

  const reload = useCallback(async () => {
    const id = gate.next();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchAll();
      if (gate.isLatest(id)) setState({ data, loading: false, error: null });
    } catch (e) {
      if (gate.isLatest(id)) setState({ data: null, loading: false, error: errorCode(e) });
    }
  }, [gate]);

  /** 당겨서 새로고침 — 기존 내용 유지, 성공하면 교체(실패는 throw) */
  const refresh = useCallback(async () => {
    const id = gate.next();
    const data = await fetchAll();
    if (gate.isLatest(id)) setState({ data, loading: false, error: null });
  }, [gate]);

  /**
   * 장중 자동 새로고침 — 개요(지수·거시)만 다시 받아 바꾼다(테마·일정은 하루 한 번 바뀌므로 다시 받지 않음).
   * 번호를 올리지 않아 진행 중인 전체 새로고침을 막지 않고, 그 뒤에 시작된 전체 새로고침이 있으면 결과를 버린다.
   * 아직 데이터가 없으면(첫 로딩·오류 화면) 아무것도 바꾸지 않는다. 실패는 호출한 쪽(createSilentRunner)이 삼킨다.
   */
  const silentRefresh = useCallback(async () => {
    const id = gate.current();
    const overview = await fetchMarketOverview();
    if (!gate.isLatest(id)) return;
    setState((s) => (s.data ? { ...s, data: { ...s.data, overview } } : s));
  }, [gate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh, silentRefresh };
}
```

- [ ] **Step 7: 시장 칩에 연결** — `mobile/src/features/market/sections/market-section.tsx`

import 블록의 `import type { GroupKind } from '../types';` 위에 추가:

```tsx
import { useAutoRefresh } from '../use-auto-refresh';
```

`MarketSection` 본문 첫 두 줄을 아래로 바꾼다(`useMarketOverview` 에서 `silentRefresh` 를 꺼내고, 조기 반환보다 **앞에서** 훅 호출):

```tsx
  const { data, loading, error, reload, refresh, silentRefresh } = useMarketOverview();
  const { refreshing, onRefresh } = usePullRefresh(refresh);
  // 시장 칩이 보이고 앱이 앞에 있을 때만 30초마다 지수·거시만 조용히 갱신(칩을 바꾸면 이 컴포넌트가 사라져 멈춤)
  useAutoRefresh(silentRefresh);
```

- [ ] **Step 8: 통과 확인**

Run: `cd mobile && npx jest src/features && npx tsc --noEmit`
Expected: jest 모두 passed(기존 `foreground-interval.test.ts`·`latest.test.ts` 포함), tsc 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add mobile/src/features/market/auto-refresh.ts mobile/src/features/market/auto-refresh.test.ts mobile/src/features/market/use-auto-refresh.ts mobile/src/features/market/use-market-overview.ts mobile/src/features/market/sections/market-section.tsx
git commit -F - <<'EOF'
feat(mobile): 시장 칩 30초 조용한 자동 새로고침 — 화면이 보이고 앱이 앞에 있을 때만

useFocusEffect + 포그라운드 주기로 개요(지수·거시)만 다시 받는다. 스피너·토스트 없음, 실패는 다음 주기에 재시도.
늦게 온 옛 응답은 요청 번호(latest.ts)로 버린다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

---

### Task 8: 웹 — 타입·쿼리·장중 배지·탭이 보일 때만 30초 새로고침·문구

**Files:**
- Create: `web_client/src/lib/marketLive.ts`
- Modify: `web_client/src/types/market.ts`, `web_client/src/api/market.ts`
- Modify: `web_client/src/components/market/IndexCards.tsx`, `web_client/src/components/market/BasisNote.tsx`
- Modify: `web_client/src/pages/screener/MarketTab.tsx`
- Test: `backend/tests/test_market_query.py` (웹 쿼리 계약). 웹에는 테스트 러너가 없어 순수 함수는 Node 한 줄 검사로 확인한다.

이 작업에서 정의하는 이름: `indexBadge(ix)`, `MARKET_REFRESH_MS`(웹, `src/lib/marketLive.ts`). 컴포넌트 파일에서 함수를 내보내면 react-refresh 린트에 걸리므로 `src/lib/` 에 둔다.

- [ ] **Step 1: 실패하는 테스트 작성 (계약)** — `backend/tests/test_market_query.py` 맨 끝에 추가(`_overview_query` 는 Task 6 에서 정의)

```python
def test_web_overview_requests_live_fields():
    import re

    q = _overview_query("web_client/src/api/market.ts")
    assert re.search(r"\blive\b", q) and re.search(r"\basOf\b", q)
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_market_query.py -q -p no:warnings -k live_fields`
Expected: FAIL — `test_web_overview_requests_live_fields`

Run(배지 함수 — 아직 파일 없음):
```bash
cd web_client && node --no-warnings --experimental-strip-types --input-type=module -e "
import assert from 'node:assert/strict';
import { indexBadge, MARKET_REFRESH_MS } from './src/lib/marketLive.ts';
const ix = { region: 'KR', date: '2026-10-16', live: false, asOf: null };
assert.deepEqual(indexBadge({ ...ix, live: true, asOf: '14:32' }), { text: '장중 14:32', live: true });
assert.equal(indexBadge(ix), null);
assert.equal(indexBadge({ ...ix, live: true, asOf: null }), null);
assert.deepEqual(indexBadge({ ...ix, region: 'US' }), { text: '10/16', live: false });
assert.deepEqual(indexBadge({ ...ix, region: 'FX', date: '2026-09-05' }), { text: '9/5', live: false });
assert.equal(MARKET_REFRESH_MS, 30000);
console.log('ok');"
```
Expected: FAIL — `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 타입·쿼리**

`web_client/src/types/market.ts` 의 `MarketIndex` 에서 `spark: number[]` 아래에 추가:

```ts
  live: boolean // 장중 값이 덧씌워졌는가(국내 지수·원/달러, 거래일 09:00~15:35)
  asOf: string | null // 장중 값 시각 KST 'HH:MM' — live 일 때만
```

`web_client/src/api/market.ts` 의 `OVERVIEW_QUERY` indices 줄을 바꾼다:

```ts
    indices { code name region date close chg1d spark live asOf }
```

- [ ] **Step 4: 순수 함수** — `web_client/src/lib/marketLive.ts`

```ts
import type { MarketIndex } from '../types/market'

/** 시장 탭 자동 새로고침 주기 — 서버 장중 수집 주기(30초)와 같다 */
export const MARKET_REFRESH_MS = 30_000

/** 지수 카드 날짜 자리 — 장중이면 '장중 14:32'(live), 국내 확정이면 없음, 해외·환율은 M/D(기존 표기) */
export function indexBadge(
  ix: Pick<MarketIndex, 'region' | 'date' | 'live' | 'asOf'>,
): { text: string; live: boolean } | null {
  if (ix.live && ix.asOf) return { text: `장중 ${ix.asOf}`, live: true }
  if (ix.region === 'KR') return null
  return { text: `${Number(ix.date.slice(5, 7))}/${Number(ix.date.slice(8, 10))}`, live: false }
}
```

- [ ] **Step 5: 순수 함수 통과 확인** — Step 2 의 `node … -e "…"` 명령을 그대로 다시 실행

Expected: `ok`

- [ ] **Step 6: 지수 카드** — `web_client/src/components/market/IndexCards.tsx`

import 블록에 추가:

```tsx
import { indexBadge } from '../../lib/marketLive'
```

`const shortDate = …` 줄을 지우고(배지 함수로 옮김), `IndexCards` 함수 전체를 아래로 **교체**:

```tsx
export function IndexCards({ indices }: { indices: MarketIndex[] }) {
  if (!indices.length) return null
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {indices.map((ix) => {
        const badge = indexBadge(ix)
        return (
          <div key={ix.code} className="rounded-card bg-surface p-3">
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-sm font-medium text-ink">{ix.name}</span>
              {badge?.live ? (
                <span className="shrink-0 rounded-full bg-brand-soft px-1.5 text-[11px] font-semibold text-brand">{badge.text}</span>
              ) : (
                <span className="shrink-0 text-[11px] text-ink-muted">{badge?.text ?? ''}</span>
              )}
            </div>
            <div className="mt-1 text-lg font-bold text-ink">{fmtIndex(ix.close)}</div>
            <div className={`text-sm font-medium ${pnlClass(ix.chg1d)}`}>{ix.chg1d == null ? '—' : formatPct(ix.chg1d)}</div>
            <Spark values={ix.spark} up={(ix.spark[ix.spark.length - 1] ?? 0) >= (ix.spark[0] ?? 0)} />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 7: 기준 안내** — `web_client/src/components/market/BasisNote.tsx` 의 `<p>` 내용(앞의 `기준일 … 종가 · ` 는 그대로, 뒷부분만)

```tsx
      {date ? `기준일 ${date} 종가 · ` : ''}국내 지수 장중 30초 · 15:40 확정 · 종목·테마·업종 20:30 · 미국 06:30 갱신 · 투자 권유가 아닙니다
```

- [ ] **Step 8: 30초 새로고침** — `web_client/src/pages/screener/MarketTab.tsx`

첫 줄 import 를 바꾸고 두 줄을 추가한다:

```tsx
import { useEffect, useRef, useState } from 'react'
```

```tsx
import { useVisibleInterval } from '../../hooks/useVisibleInterval'
import { MARKET_REFRESH_MS } from '../../lib/marketLive'
```

첫 `useEffect(() => { … }, [today])` 블록 **바로 아래**(그리고 `if (state === 'loading') return …` 조기 반환보다 **위**)에 추가:

```tsx
  // 장중 지수 — 탭이 보이는 동안 30초마다 개요(지수·거시)만 조용히 다시 받는다.
  // 실패는 무시(다음 주기에 재시도), 앞 요청이 끝나기 전에는 건너뛰고, 늦게 온 옛 응답은 번호로 버린다.
  const ovSeq = useRef(0)
  const ovBusy = useRef(false)
  useVisibleInterval(() => {
    if (ovBusy.current) return
    ovBusy.current = true
    const id = ++ovSeq.current
    getMarketOverview()
      .then((ov) => {
        if (id === ovSeq.current) setOverview(ov)
      })
      .catch(() => undefined)
      .finally(() => {
        ovBusy.current = false
      })
  }, MARKET_REFRESH_MS, state === 'ready')
```

- [ ] **Step 9: 통과 확인**

Run: `cd web_client && npx tsc --noEmit && npx eslint src/lib/marketLive.ts src/components/market/IndexCards.tsx src/components/market/BasisNote.tsx src/pages/screener/MarketTab.tsx`
Expected: 오류·경고 없음

Run: `cd backend && uv run pytest tests/test_market_query.py -q -p no:warnings`
Expected: 모두 passed(웹 계약 `test_web_queries_match_schema`·`test_web_overview_requests_live_fields` 포함)

- [ ] **Step 10: 커밋**

```bash
git add web_client/src/lib/marketLive.ts web_client/src/types/market.ts web_client/src/api/market.ts web_client/src/components/market/IndexCards.tsx web_client/src/components/market/BasisNote.tsx web_client/src/pages/screener/MarketTab.tsx backend/tests/test_market_query.py
git commit -F - <<'EOF'
feat(web): 시장 탭 장중 지수 배지 + 탭이 보일 때만 30초 개요 새로고침

live·asOf 를 받아 "장중 HH:MM" 배지(bg-brand-soft), visibilityState 기반 30초 조용한 갱신, 기준 안내 문구.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

---

### Task 9: 문서(README·server_setup) + 최종 전체 테스트

**Files:**
- Modify: `README.md` (57행 beat 주석, "📈 시장 데이터 수집" 일정 표, "🗺️ 스크리너 탭" API 줄)
- Modify: `docs/server_setup.md` ("**시장 데이터(2026-10-18)**" 문단 아래)

- [ ] **Step 1: README beat 주석** — `README.md` 의 아래 문자열을

```
# 스케줄러(매일 20:30 전종목 수집 · 20:40 시즌 정산 · 21:00 퀴즈 풀 보충 · 월 08:50 주간 랭킹 마감 · 매월 1일 08:55 월간 랭킹 마감)
```

아래로 바꾼다:

```
# 스케줄러(매일 20:30 전종목 수집 · 20:40 시즌 정산 · 21:00 퀴즈 풀 보충 · 월 08:50 주간 랭킹 마감 · 매월 1일 08:55 월간 랭킹 마감 · 평일 장중 30초 국내 지수·환율)
```

- [ ] **Step 2: README 일정 표** — "| 평일 15:40 | 국내 지수(KOSPI·KOSDAQ·KOSPI200) …" 행 **바로 아래**에 한 행 추가

```markdown
| 평일 09:00~15:35 30초마다 | 장중 국내 지수(KOSPI·KOSDAQ·KOSPI200)·원/달러 현재값 — `collector.poll_intraday_indices`, 시장 칩 "장중 HH:MM" 배지. 휴장일·장 밖에는 KIS 를 부르지 않음. 끄기 `INTRADAY_INDICES_ENABLED=false`. 설계 `docs/superpowers/specs/2026-10-20-intraday-index-design.md` | Redis `market:intraday`(TTL 10분, CH 에는 안 씀) |
```

- [ ] **Step 3: README 스크리너 API 줄** — "🗺️ 스크리너 탭" 절의 `- **API(stock_api GraphQL)**: \`marketOverview\`(지수·FRED 거시), …` 줄에서 `\`marketOverview\`(지수·FRED 거시)` 를 아래로 바꾼다

```markdown
`marketOverview`(지수·FRED 거시 — 장중엔 Redis 장중 값을 덧씌워 `live`·`asOf`, 지수·거시 CH 조회 30초 메모리 캐시)
```

- [ ] **Step 4: 서버 문서** — `docs/server_setup.md` 의 "**시장 데이터(2026-10-18)**: …" 문단 **바로 아래**에 빈 줄 하나 두고 추가

~~~markdown
**장중 지수(2026-10-20)**: celery beat 가 30초마다 `collector.poll_intraday_indices` 를 보낸다 — 거래일 09:00~15:35 KST 에만 KIS 를 4건(국내 지수 3 + 원/달러, 전용 초당 2건) 부르고 Redis `market:intraday`(TTL 10분)에 둔다. ClickHouse 에는 쓰지 않으므로 15:40 확정 수집이 실패해도 장중 값이 종가로 남지 않는다. 배포가 celery_beat 를 함께 재기동하므로 따로 할 일 없음. 장중 확인:
```bash
docker exec $(docker ps -qf name=stock_celery_worker -f status=running | head -1) \
  python -c "from shared.sync_redis import get_sync_redis as g; r=g(); print(r.get('market:intraday'), r.ttl('market:intraday'))"
```
값이 비어 있으면 worker 로그(`docker logs … | grep 장중`)를 본다. 앱·웹 시장 칩에 "장중 HH:MM" 배지가 보이면 정상. 끄기: `.env.production` 에 `INTRADAY_INDICES_ENABLED=false` 후 worker 재기동(태스크가 바로 끝나고 화면은 확정 종가).
~~~

- [ ] **Step 5: 최종 전체 테스트**

Run: `cd backend && uv run pytest -q -p no:warnings`
Expected: 모두 passed (새 테스트: `test_shared_market_calendar.py`·`test_intraday_indices.py`·`test_market_tasks.py`·`test_market_query.py` 추가분)

Run: `cd mobile && npx jest && npx tsc --noEmit`
Expected: jest 모두 passed, tsc 오류 없음

Run: `cd web_client && npm run build`
Expected: `tsc --noEmit && vite build` 성공(의존성 설치 없이 기존 node_modules 로)

- [ ] **Step 6: 커밋**

```bash
git add README.md docs/server_setup.md
git commit -F - <<'EOF'
docs: 장중 지수 30초 갱신 — 일정 표·운영 확인·끄는 방법

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
```

---

## 사용자가 직접 할 일

1. **Task 4 Step 1** 확인 명령을 거래일 장중에 운영 서버에서 두 번(1분 간격) 실행하고 출력 + 같은 시각 MTS 값을 전달 → 분기(4-A/4-B/4-C1/4-C2) 결정.
2. 배포(`main` 머지 → Deploy Server·Deploy Web, 모바일은 다음 앱 빌드). celery_beat 는 배포가 함께 재기동한다.
3. 배포 다음 거래일 장중: server_setup 의 확인 명령으로 `market:intraday` 값·TTL 확인, 앱·웹 시장 칩 "장중 HH:MM" 배지 확인, 15:40 이후 배지가 사라지고 확정 값으로 바뀌는지 확인.

## 스펙 대비 점검표

| 스펙 요구 | 작업 |
|---|---|
| 대상 4개(국내 3 + 원/달러), 미국 제외 | Task 2 `INTRADAY_CODES` |
| beat 30초·`expires` 25 | Task 3 |
| 거래일(게임 판정 재사용, shared 이동)·09:00 ≤ t < 15:35 | Task 1·2 |
| 기존 일별 TR 오늘 범위·오늘 봉 / ⚠️ 장중 값 확인·현재지수 TR 대안·환율 지연 문구 | Task 2·4 |
| Redis `market:intraday` JSON·TTL 10분, 실패 코드 이전 값 유지, 전부 실패면 로그만 | Task 2 |
| 전용 RateLimiter 초당 2건 + 주석 | Task 2(상수)·3(사용) |
| CH 에 쓰지 않음 | Task 2(코드에 CH 호출 없음) |
| `overlay_intraday` 순수 함수·조건·chg1d·추세선·asOf, Redis 오류 무시 | Task 5 |
| GraphQL `live`·`asOf`, 계약 테스트 | Task 5·6·8 |
| CH 지수 조회 30초 메모리 캐시(장중 값은 매번) | Task 5 |
| 배지(파스텔 블루)·자동 새로고침(모바일 포커스+AppState, 웹 visibilityState)·옛 응답 무시 | Task 6·7·8 |
| BasisNote 문구 | Task 6·8 |
| env `INTRADAY_INDICES_ENABLED`·`.env.example` | Task 3 |
| README·server_setup 일정 | Task 9 |
