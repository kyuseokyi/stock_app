# 트레이딩 게임 Phase 2 — KIS 실시간 WS 수집 데몬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 ACTIVE 시즌 종목의 실시간 체결틱을 KIS WS(H0STCNT0)/Mock으로 받아 파싱 후 Redis `stock:tick:{ticker}`로 발행하는 수집 데몬을 만든다.

**Architecture:** 기존 동기 KIS REST 클라이언트는 그대로 두고, 신규 async 모듈(websockets + redis.asyncio + httpx)로 수집 데몬을 짓는다. 순수 파서/Mock 생성기를 분리해 자동 테스트하고, 실 WS 연결과 end-to-end는 Mock 모드로 검증한다(실 KIS는 장중 수동).

**Tech Stack:** Python 3.12 · asyncio · websockets · redis.asyncio(redis 8) · httpx · pytest-asyncio · uv

**Spec:** `docs/superpowers/specs/2026-10-12-trading-game-phase2-kis-ws-collector-design.md`

---

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `backend/shared/kis_config.py` | `ws_url` 프로퍼티 추가 | Modify (Task 1) |
| `backend/apps/collector/kis/ws_parser.py` | H0STCNT0 문자열 → tick dict (순수) | Create (Task 1) |
| `backend/tests/test_game_ws_parser.py` | 파서 단위 테스트 | Create (Task 1) |
| `backend/apps/collector/game_ws/__init__.py` | 패키지 선언 | Create (Task 2) |
| `backend/apps/collector/game_ws/mock_stream.py` | Mock 틱 생성(next_tick 순수 + async 래퍼) | Create (Task 2) |
| `backend/apps/collector/game_ws/publisher.py` | Redis 틱 발행(async) | Create (Task 2) |
| `backend/tests/test_game_ws_mock.py` | Mock 생성기 단위 테스트 | Create (Task 2) |
| `backend/pyproject.toml` | `websockets` 의존성 추가 | Modify (Task 3) |
| `backend/apps/collector/kis/ws_client.py` | async KIS WS 클라이언트 | Create (Task 3) |
| `backend/apps/collector/run_game_ws.py` | 데몬 진입점 | Create (Task 4) |
| `backend/scripts/test_game_ws_sub.py` | PSUBSCRIBE 수동 검증 | Create (Task 4) |

**모든 Task 공통:**
- `git add -A` **금지**. 각 Task 명시 경로만 add. (`.claude/` 미추적 + `.serena/project.yml` 수정본은 UNSTAGED 유지.)
- 커밋 메시지 末尾 2줄 부착:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 백엔드는 `backend/`에서 `uv run`.

---

## Task 1: 설정(ws_url) + H0STCNT0 파서 + 테스트

**Files:**
- Modify: `backend/shared/kis_config.py`
- Create: `backend/apps/collector/kis/ws_parser.py`
- Test: `backend/tests/test_game_ws_parser.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_game_ws_parser.py`

```python
"""KIS H0STCNT0 실시간 체결 파서 단위 테스트.

H0STCNT0 출력 필드 순서(0-based, 공식 TR 기준, 총 46필드):
 0 종목코드 | 1 체결시간(HHMMSS) | 2 현재가 | 3 전일대비부호(1·2=상승,4·5=하락) |
 4 전일대비(크기) | 5 전일대비율(크기) | 6 가중평균가 | 7 시가 | 8 고가 | 9 저가 |
 10 매도호가1 | 11 매수호가1 | 12 체결거래량 | 13 누적거래량(ACML_VOL) | ...
"""
from __future__ import annotations

from apps.collector.kis.ws_parser import parse_message

FIELD_COUNT = 46


def _record(**over) -> list[str]:
    """46필드 레코드를 기본값으로 만들고 일부만 덮어쓴다."""
    f = ["0"] * FIELD_COUNT
    f[0] = "005930"   # 종목코드
    f[1] = "090005"   # 체결시간
    f[2] = "71500"    # 현재가
    f[3] = "2"        # 전일대비부호(상승)
    f[4] = "500"      # 전일대비(크기)
    f[5] = "0.70"     # 전일대비율(크기)
    f[13] = "1245000" # 누적거래량
    for k, v in over.items():
        f[int(k[1:])] = v  # 'f3' -> index 3
    return f


def _frame(records: list[list[str]]) -> str:
    payload = "^".join(x for rec in records for x in rec)
    return f"0|H0STCNT0|{len(records):03d}|{payload}"


def test_parse_single_tick_up():
    ticks = parse_message(_frame([_record()]))
    assert ticks == [
        {
            "ticker": "005930",
            "time": "090005",
            "price": 71500,
            "change_price": 500,
            "change_rate": 0.70,
            "volume": 1245000,
        }
    ]


def test_parse_down_tick_signs_negative():
    # 부호 5(하락) → change_price/rate 음수화
    ticks = parse_message(_frame([_record(f3="5")]))
    assert ticks[0]["change_price"] == -500
    assert ticks[0]["change_rate"] == -0.70


def test_parse_multi_tick():
    ticks = parse_message(_frame([_record(f2="71500"), _record(f2="71600")]))
    assert [t["price"] for t in ticks] == [71500, 71600]


def test_control_frame_returns_none():
    assert parse_message('{"header":{"tr_id":"PINGPONG"}}') is None
    assert parse_message('{"body":{"msg1":"SUBSCRIBE SUCCESS"}}') is None


def test_garbage_returns_none():
    assert parse_message("") is None
    assert parse_message("   ") is None
    assert parse_message("abc") is None
    assert parse_message("0|H0STCNT0|bad|x^y") is None  # count 비정수
    assert parse_message("0|H0XXXXX0|001|" + "^".join(["0"] * 46)) is None  # 다른 TR
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_game_ws_parser.py -q`
Expected: import 에러(`No module named 'apps.collector.kis.ws_parser'`)로 실패.

- [ ] **Step 3: 파서 구현** — `backend/apps/collector/kis/ws_parser.py`

```python
"""KIS 실시간 체결(H0STCNT0) 수신 문자열 파서.

데이터 프레임 형식: `{암호화flag}|{tr_id}|{건수}|{필드^필드^...}` (평문 flag='0').
건수>1 이면 46필드 레코드가 연속되므로 레코드 단위로 분해한다.
제어 프레임(PINGPONG·구독응답)은 JSON('{' 시작)이라 None 을 반환한다.
"""
from __future__ import annotations

# H0STCNT0 필드 인덱스(0-based). 공식 TR 출력 순서 기준.
IDX_TICKER = 0
IDX_TIME = 1
IDX_PRICE = 2
IDX_SIGN = 3      # 1상한 2상승 3보합 4하한 5하락
IDX_CHANGE = 4    # 전일대비(부호 없는 크기)
IDX_RATE = 5      # 전일대비율(부호 없는 크기)
IDX_ACML_VOL = 13 # 누적 거래량
_MIN_FIELDS = IDX_ACML_VOL + 1
_DOWN_SIGNS = {"4", "5"}


def _record_to_tick(f: list[str]) -> dict:
    neg = f[IDX_SIGN] in _DOWN_SIGNS
    change = int(f[IDX_CHANGE] or 0)
    rate = float(f[IDX_RATE] or 0)
    if neg:
        change = -abs(change)
        rate = -abs(rate)
    return {
        "ticker": f[IDX_TICKER],
        "time": f[IDX_TIME],
        "price": int(f[IDX_PRICE] or 0),
        "change_price": change,
        "change_rate": rate,
        "volume": int(f[IDX_ACML_VOL] or 0),
    }


def parse_message(raw: str) -> list[dict] | None:
    """H0STCNT0 데이터 프레임이면 tick dict 리스트, 그 외(제어/깨짐)는 None."""
    if raw is None:
        return None
    raw = raw.strip()
    if not raw or raw.startswith("{"):  # 빈 값 또는 제어 프레임(JSON)
        return None
    parts = raw.split("|")
    if len(parts) < 4:
        return None
    _flag, tr_id, count_str, payload = parts[0], parts[1], parts[2], parts[3]
    if tr_id != "H0STCNT0":
        return None
    try:
        count = int(count_str)
    except ValueError:
        return None
    if count <= 0:
        return None
    fields = payload.split("^")
    if len(fields) % count != 0:
        return None
    per = len(fields) // count
    if per < _MIN_FIELDS:
        return None
    try:
        return [_record_to_tick(fields[i * per:(i + 1) * per]) for i in range(count)]
    except (ValueError, IndexError):
        return None
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_game_ws_parser.py -q`
Expected: 5 passed.

- [ ] **Step 5: `ws_url` 프로퍼티 추가** — `backend/shared/kis_config.py`

`_BASE_URLS` 딕셔너리 **아래**에 추가:
```python
# 모드별 실시간 WebSocket URL
_WS_URLS = {
    "prod": "ws://ops.koreainvestment.com:21000",   # 실서버
    "vps": "ws://ops.koreainvestment.com:31000",    # 모의투자
}
```
`KISConfig`의 `base_url` 프로퍼티 **아래**에 추가:
```python
    @property
    def ws_url(self) -> str:
        return _WS_URLS.get(self.mode, _WS_URLS["vps"])
```

- [ ] **Step 6: 설정 로딩 확인**

Run: `cd backend && uv run python -c "from shared.kis_config import get_kis_config as g; print(g().ws_url)"`
Expected: `ws://ops.koreainvestment.com:31000` (기본 mode=vps)

- [ ] **Step 7: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/shared/kis_config.py backend/apps/collector/kis/ws_parser.py backend/tests/test_game_ws_parser.py
git commit -m "$(cat <<'EOF'
feat(game): KIS H0STCNT0 실시간 체결 파서 + ws_url 설정

파이프/캐럿 데이터 프레임 파싱(단일/다중 틱), 제어프레임(JSON) None 처리,
전일대비 부호(4·5=하락) 음수화. KISConfig.ws_url(prod:21000/vps:31000) 추가.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 2: Mock 틱 생성기 + Redis 발행기 + 테스트

**Files:**
- Create: `backend/apps/collector/game_ws/__init__.py`
- Create: `backend/apps/collector/game_ws/mock_stream.py`
- Create: `backend/apps/collector/game_ws/publisher.py`
- Test: `backend/tests/test_game_ws_mock.py`

- [ ] **Step 1: 패키지 선언** — `backend/apps/collector/game_ws/__init__.py` (빈 파일)

```python
```

- [ ] **Step 2: 실패 테스트 작성** — `backend/tests/test_game_ws_mock.py`

```python
"""Mock 틱 생성기 단위 테스트(순수 next_tick)."""
from __future__ import annotations

import random

from apps.collector.game_ws.mock_stream import next_tick

BASE = 71500


def test_next_tick_keys_and_types():
    _, tick = next_tick("005930", BASE, BASE)
    assert set(tick) == {"ticker", "price", "change_price", "change_rate", "volume", "timestamp"}
    assert tick["ticker"] == "005930"
    assert isinstance(tick["price"], int) and tick["price"] > 0
    assert isinstance(tick["change_price"], int)
    assert isinstance(tick["change_rate"], float)
    assert tick["timestamp"].endswith("+09:00")  # KST ISO8601


def test_next_tick_step_within_bound():
    random.seed(0)
    prev = float(BASE)
    for _ in range(50):
        new_price, tick = next_tick("005930", prev, BASE)
        # 한 스텝 변동은 ±0.3% 이내(소수 반올림 여유 포함)
        assert abs(new_price / prev - 1) <= 0.0031
        prev = new_price


def test_next_tick_change_relative_to_base():
    new_price, tick = next_tick("005930", 72000.0, BASE)
    assert tick["change_price"] == int(round(new_price - BASE))
    assert tick["change_rate"] == round((new_price / BASE - 1) * 100, 2)
```

- [ ] **Step 3: 실패 확인**

Run: `cd backend && uv run pytest tests/test_game_ws_mock.py -q`
Expected: import 에러로 실패.

- [ ] **Step 4: Mock 생성기 구현** — `backend/apps/collector/game_ws/mock_stream.py`

```python
"""Mock 실시간 틱 생성기.

장외/휴장/KIS 키 미설정 시 가상 틱을 발행해 전체 파이프라인을 검증한다.
next_tick 은 순수 함수(테스트용), mock_ticks 는 asyncio 래퍼.
"""
from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def next_tick(ticker: str, prev_price: float, base_price: float) -> tuple[float, dict]:
    """직전가 기준 ±0.1~0.3% 변동한 다음 틱을 생성. (새 가격, tick dict) 반환."""
    step = random.choice([-1, 1]) * random.uniform(0.001, 0.003)
    new_price = max(1.0, prev_price * (1 + step))
    price_int = int(round(new_price))
    tick = {
        "ticker": ticker,
        "price": price_int,
        "change_price": int(round(new_price - base_price)),
        "change_rate": round((new_price / base_price - 1) * 100, 2),
        "volume": 0,  # Mock 은 누적량 미집계
        "timestamp": datetime.now(KST).isoformat(),
    }
    return new_price, tick


async def mock_ticks(ticker: str, base_price: float, stop: asyncio.Event | None = None):
    """초당 1~3틱을 무한 생성하는 async 제너레이터."""
    price = float(base_price)
    while stop is None or not stop.is_set():
        n = random.randint(1, 3)
        for _ in range(n):
            price, tick = next_tick(ticker, price, base_price)
            yield tick
            await asyncio.sleep(1.0 / n)
```

- [ ] **Step 5: 발행기 구현** — `backend/apps/collector/game_ws/publisher.py`

```python
"""Redis Pub/Sub 틱 발행기(async). 채널: stock:tick:{ticker}."""
from __future__ import annotations

import json

import redis.asyncio as aioredis


class TickPublisher:
    def __init__(self, redis_url: str):
        self._redis = aioredis.from_url(redis_url, decode_responses=True)

    async def publish(self, tick: dict) -> int:
        """tick 을 JSON 직렬화해 stock:tick:{ticker} 로 PUBLISH. 수신 구독자 수 반환."""
        channel = f"stock:tick:{tick['ticker']}"
        return await self._redis.publish(channel, json.dumps(tick, ensure_ascii=False))

    async def close(self) -> None:
        await self._redis.aclose()
```

- [ ] **Step 6: 통과 확인**

Run: `cd backend && uv run pytest tests/test_game_ws_mock.py -q`
Expected: 3 passed.

- [ ] **Step 7: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/apps/collector/game_ws/__init__.py backend/apps/collector/game_ws/mock_stream.py backend/apps/collector/game_ws/publisher.py backend/tests/test_game_ws_mock.py
git commit -m "$(cat <<'EOF'
feat(game): Mock 틱 생성기 + Redis 틱 발행기

next_tick(순수) 기반 ±0.1~0.3% 랜덤워크 Mock 생성기, async mock_ticks 래퍼.
TickPublisher 가 redis.asyncio 로 stock:tick:{ticker} 에 JSON PUBLISH.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 3: `websockets` 의존성 + async KIS WS 클라이언트

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `backend/apps/collector/kis/ws_client.py`

> 참고: 실 WS 연결은 장중+키가 있어야 하므로 자동 단위 테스트 대상이 아니다. 이 Task는 구조 검증(import/인스턴스화)까지만 하고, 라이브 동작은 Task 4의 Mock E2E 및 장중 수동 검증으로 확인한다.

- [ ] **Step 1: 의존성 추가** — `backend/pyproject.toml`

`dependencies` 배열에 한 줄 추가(기존 항목 사이, 예: `requests` 근처):
```toml
    "websockets>=13.0",
```
그 후:
```bash
cd backend && uv sync
```
Expected: 성공(websockets 이미 설치돼 있으면 변경 최소).

- [ ] **Step 2: WS 클라이언트 구현** — `backend/apps/collector/kis/ws_client.py`

```python
"""KIS 실시간 WebSocket 클라이언트(async).

approval_key 를 발급(캐싱)하고, H0STCNT0 를 구독해 수신 원문을 yield 한다.
끊기면 지수 백오프로 재연결·재구독한다. PINGPONG 프레임은 내부에서 pong 응답.
"""
from __future__ import annotations

import json
import logging
import os

import httpx
import redis.asyncio as aioredis
import websockets

from shared.kis_config import KISConfig

log = logging.getLogger(__name__)

_APPROVAL_TTL = 23 * 3600  # approval_key 보수적 TTL(초)
_BACKOFF_MAX = 30.0


async def issue_approval_key(cfg: KISConfig, redis_url: str) -> str:
    """POST /oauth2/Approval 로 approval_key 발급(Redis 캐싱)."""
    rkey = f"kis:approval:{cfg.mode}:{cfg.app_key[:10]}"
    r = aioredis.from_url(redis_url, decode_responses=True)
    try:
        cached = await r.get(rkey)
        if cached:
            return cached
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{cfg.base_url}/oauth2/Approval",
                json={
                    "grant_type": "client_credentials",
                    "appkey": cfg.app_key,
                    "secretkey": cfg.app_secret,
                },
            )
            resp.raise_for_status()
            key = resp.json()["approval_key"]
        await r.set(rkey, key, ex=_APPROVAL_TTL)
        return key
    finally:
        await r.aclose()


def _subscribe_frame(approval_key: str, ticker: str) -> str:
    return json.dumps(
        {
            "header": {
                "approval_key": approval_key,
                "custtype": "P",
                "tr_type": "1",
                "content-type": "utf-8",
            },
            "body": {"input": {"tr_id": "H0STCNT0", "tr_key": ticker}},
        }
    )


class KISWebSocketClient:
    def __init__(self, cfg: KISConfig, ticker: str, redis_url: str | None = None):
        self.cfg = cfg
        self.ticker = ticker
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379/0")

    async def stream(self):
        """연결→구독→수신 원문 yield. 끊기면 지수 백오프 재연결."""
        backoff = 1.0
        while True:
            try:
                approval_key = await issue_approval_key(self.cfg, self.redis_url)
                async with websockets.connect(self.cfg.ws_url, ping_interval=None) as ws:
                    await ws.send(_subscribe_frame(approval_key, self.ticker))
                    log.info("KIS WS 구독: %s", self.ticker)
                    backoff = 1.0  # 성공 시 백오프 리셋
                    async for raw in ws:
                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8", "ignore")
                        # PINGPONG 제어 프레임은 그대로 되돌려 pong
                        if raw.startswith("{") and "PINGPONG" in raw:
                            await ws.send(raw)
                            continue
                        yield raw
            except Exception as e:  # noqa: BLE001 — 재연결 목적의 광범위 포획
                log.warning("KIS WS 끊김/오류: %s (재연결 %.0fs)", e, backoff)
                import asyncio

                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, _BACKOFF_MAX)
```

- [ ] **Step 3: 구조 검증(import + 인스턴스화)**

Run:
```bash
cd backend && uv run python -c "
from shared.kis_config import get_kis_config
from apps.collector.kis.ws_client import KISWebSocketClient, issue_approval_key, _subscribe_frame
c = KISWebSocketClient(get_kis_config(), '005930')
print('ws_url=', c.cfg.ws_url)
import json; f=json.loads(_subscribe_frame('AK','005930')); assert f['body']['input']['tr_id']=='H0STCNT0' and f['body']['input']['tr_key']=='005930'
print('subscribe frame OK')
"
```
Expected: `ws_url= ws://ops.koreainvestment.com:31000` / `subscribe frame OK` (네트워크 호출 없음).

- [ ] **Step 4: 회귀 확인**

Run: `cd backend && uv run pytest -q`
Expected: 기존 + 신규 테스트 통과, 신규 실패 0.

- [ ] **Step 5: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/pyproject.toml backend/uv.lock backend/apps/collector/kis/ws_client.py
git commit -m "$(cat <<'EOF'
feat(game): async KIS 실시간 WebSocket 클라이언트 + websockets 의존성

approval_key 발급(Redis 캐싱)·H0STCNT0 구독·PINGPONG 응답·지수백오프 재연결.
라이브 동작은 Mock E2E/장중 수동 검증(자동 테스트 대상 아님).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```
(uv.lock 이 변경되지 않았으면 add 목록에서 빼도 됨.)

---

## Task 4: 수집 데몬 진입점 + 구독 검증 스크립트 + Mock E2E

**Files:**
- Create: `backend/apps/collector/run_game_ws.py`
- Create: `backend/scripts/test_game_ws_sub.py`

- [ ] **Step 1: 데몬 진입점 구현** — `backend/apps/collector/run_game_ws.py`

```python
"""트레이딩 게임 실시간 시세 수집 데몬.

ACTIVE 시즌의 종목을 1회 조회해 구독 대상으로 고정한다(시즌 교체 시 재시작).
MOCK_TICK_STREAM=true 또는 KIS 키 미설정이면 Mock 생성기로, 아니면 실 KIS WS 로
분기한다. 각 틱을 Redis stock:tick:{ticker} 로 발행한다.

실행:
    uv run python -m apps.collector.run_game_ws
    MOCK_TICK_STREAM=true uv run python -m apps.collector.run_game_ws
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import GameSeason
from shared.kis_config import get_kis_config
from apps.collector.game_ws.mock_stream import mock_ticks
from apps.collector.game_ws.publisher import TickPublisher
from apps.collector.kis.ws_client import KISWebSocketClient
from apps.collector.kis.ws_parser import parse_message

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("run_game_ws")

KST = timezone(timedelta(hours=9))


async def _active_season_ticker() -> str | None:
    async with AsyncSessionLocal() as db:
        s = (
            await db.execute(
                select(GameSeason).where(GameSeason.status == "ACTIVE").order_by(GameSeason.id)
            )
        ).scalars().first()
        return s.ticker if s else None


def _payload_from_parsed(tick: dict) -> dict:
    """파서 tick(time=HHMMSS)을 발행 payload(timestamp ISO)로 변환."""
    hhmmss = tick["time"]
    now = datetime.now(KST)
    try:
        ts = now.replace(
            hour=int(hhmmss[0:2]), minute=int(hhmmss[2:4]),
            second=int(hhmmss[4:6]), microsecond=0,
        ).isoformat()
    except (ValueError, IndexError):
        ts = now.isoformat()
    return {
        "ticker": tick["ticker"],
        "price": tick["price"],
        "change_price": tick["change_price"],
        "change_rate": tick["change_rate"],
        "volume": tick["volume"],
        "timestamp": ts,
    }


async def run() -> None:
    ticker = await _active_season_ticker()
    if not ticker:
        log.error("ACTIVE 시즌이 없습니다. 시드(scripts.seed_trading_game) 후 재시도하세요.")
        return

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    publisher = TickPublisher(redis_url)
    stop = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    cfg = get_kis_config()
    use_mock = os.getenv("MOCK_TICK_STREAM", "").lower() == "true" or not cfg.is_configured
    base_price = float(os.getenv("MOCK_BASE_PRICE", "71500"))

    log.info("수집 시작: ticker=%s mock=%s", ticker, use_mock)
    try:
        if use_mock:
            async for tick in mock_ticks(ticker, base_price, stop):
                await publisher.publish(tick)
                if stop.is_set():
                    break
        else:
            client = KISWebSocketClient(cfg, ticker, redis_url)
            async for raw in client.stream():
                if stop.is_set():
                    break
                parsed = parse_message(raw)
                if not parsed:
                    continue
                for t in parsed:
                    await publisher.publish(_payload_from_parsed(t))
    finally:
        await publisher.close()
        log.info("수집 데몬 종료")


if __name__ == "__main__":
    asyncio.run(run())
```

- [ ] **Step 2: 구독 검증 스크립트** — `backend/scripts/test_game_ws_sub.py`

```python
"""stock:tick:* 채널을 구독해 수신 틱을 콘솔에 출력(수동 검증).

실행: uv run python -m scripts.test_game_ws_sub   (Ctrl+C 로 종료)
"""
from __future__ import annotations

import asyncio
import os

import redis.asyncio as aioredis


async def main() -> None:
    r = aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.psubscribe("stock:tick:*")
    print("구독: stock:tick:*  (Ctrl+C 종료)")
    try:
        async for msg in pubsub.listen():
            if msg.get("type") == "pmessage":
                print(msg["channel"], msg["data"])
    finally:
        await pubsub.aclose()
        await r.aclose()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: Mock E2E 검증 (핵심)**

> macOS에는 `timeout`이 기본 설치돼 있지 않으므로, 아래처럼 **백그라운드 실행 + sleep + kill** 패턴으로
> 시간 제한한다(로그는 파일로 받아 확인). 로컬 docker의 Postgres·Redis가 떠 있어야 하고, ACTIVE
> 시즌(005930)은 Phase 1 시드로 존재한다(없으면 `uv run python -m scripts.seed_trading_game` 선행).

```bash
cd backend
export REDIS_URL="redis://localhost:6379/0"
export DATABASE_URL="postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db"
# 구독자(B)를 백그라운드로 먼저 띄워 로그를 파일에 수집
uv run python -m scripts.test_game_ws_sub > /tmp/ws_sub.out 2>&1 &
SUB=$!
sleep 1
# 데몬(A)을 Mock 모드로 백그라운드 실행 후 5초 뒤 SIGINT
MOCK_TICK_STREAM=true uv run python -m apps.collector.run_game_ws > /tmp/ws_daemon.out 2>&1 &
DAEMON=$!
sleep 5
kill -INT $DAEMON 2>/dev/null; wait $DAEMON 2>/dev/null
sleep 1
kill -INT $SUB 2>/dev/null; wait $SUB 2>/dev/null
echo "=== daemon log ==="; cat /tmp/ws_daemon.out
echo "=== sub log (tail) ==="; tail -8 /tmp/ws_sub.out
```
Expected:
- daemon log: `수집 시작: ticker=005930 mock=True` + `수집 데몬 종료`, 에러 없음.
- sub log: `stock:tick:005930 {"ticker": "005930", "price": ..., "change_price": ..., "change_rate": ..., "volume": 0, "timestamp": "...+09:00"}` 틱이 여러 줄.

- [ ] **Step 4: Graceful shutdown 확인**

Run:
```bash
cd backend
MOCK_TICK_STREAM=true uv run python -m apps.collector.run_game_ws &
PID=$!; sleep 2; kill -INT $PID; wait $PID 2>/dev/null
```
Expected: `수집 데몬 종료` 로그 출력 후 프로세스 정상 종료(멈춤/좀비 없음).

- [ ] **Step 5: 회귀 확인**

Run: `cd backend && uv run pytest -q`
Expected: 신규 실패 0.

- [ ] **Step 6: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/apps/collector/run_game_ws.py backend/scripts/test_game_ws_sub.py
git commit -m "$(cat <<'EOF'
feat(game): 실시간 수집 데몬 진입점 + 구독 검증 스크립트

ACTIVE 시즌 종목 1회 조회 → Mock/실WS 분기 → stock:tick:{ticker} 발행.
graceful shutdown(SIGINT/SIGTERM). Mock E2E 로 파이프라인 검증.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## 완료 기준 (전체)
- [ ] Task 1~4 완료, 각 커밋 생성
- [ ] `uv run pytest tests/test_game_ws_parser.py tests/test_game_ws_mock.py -q` 통과(8 tests)
- [ ] `uv run pytest -q` 신규 실패 0(회귀 없음)
- [ ] Mock E2E: 구독 스크립트가 `stock:tick:005930` 틱 JSON 수신
- [ ] graceful shutdown 정상
- [ ] 기존 동기 KIS REST 클라이언트(`kis/client.py`) 불변
- [ ] 실 KIS WS 라이브 검증은 장중 수동(이 Phase DoD 아님)
