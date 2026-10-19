# 관리자 시장 데이터 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 웹에서 테마를 보정하고, 시장 데이터 수집 현황을 보고, KIS 를 호출하지 않는 계산 4개를 버튼으로 다시 돌릴 수 있게 한다.

**Architecture:**
- **stock_api(FastAPI) 관리자 REST:**
  - 테마 지표: 기존 테마 라우터에 `GET /themes/metrics` 를 추가하고, 종목 목록에 이름·등락 필드를 추가한다(기존 필드는 유지).
  - 새 라우터 `/api/v1/admin/market`(status, jobs)를 만든다.
  - 계산은 collector Celery 태스크에 `send_task` 로 맡긴다.
  - 중복 방지와 실행 기록은 Redis 에 두고, 작업 본문에는 잠금을 걸지 않는다.
- **collector:** 일일 파이프라인이 끝날 때 단계별 결과와 걸린 시간을 Redis 에 기록한다.
- **admin_web:** "시장 데이터" 메뉴를 추가하고, 화면 2개(테마 보정·데이터 현황)를 만든다.

**Tech Stack:** FastAPI, Celery(Redis broker·backend), redis-py(sync), ClickHouse(clickhouse-connect), SQLAlchemy, pytest + fakeredis, React 18 + Vite + Tailwind + axios.

**Spec:** `docs/superpowers/specs/2026-10-19-admin-market-data-design.md`

**규칙(모든 태스크 공통)**
- **백엔드 명령:** `cd backend && conda run -n stock_app uv run pytest ...`
- **커밋:**
  - dev 브랜치에 커밋한다. `git add` 는 경로를 하나씩 지정한다(`-A`·`.` 금지).
  - 메시지 끝에 다음 두 줄을 붙인다.
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
    ```
  - 테스트에 failed 가 하나라도 있으면 커밋하지 않는다.
- **금지:**
  - env 파일을 수정하거나 값을 출력하지 않는다.
  - 실제 KIS 를 호출하지 않는다.
  - `rm -rf`·`sleep` 을 쓰지 않는다.
- **커밋하지 않는 파일:** `.claude/`, `.serena/project.yml`, `*.tsbuildinfo`

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `backend/shared/sync_redis.py` (신규) | 동기 Redis 클라이언트 지연 생성(프로세스당 1개) |
| `backend/shared/pipeline_record.py` (신규) | 일일 파이프라인 기록 저장·읽기(키·TTL·요약 자르기) |
| `backend/apps/collector/tasks/market_data.py` (수정) | 파이프라인 단계별 시간 측정 + 기록 저장 |
| `backend/apps/stock_api/services/data_status.py` (신규) | 데이터 현황 집계(CH·PG·env·Redis) |
| `backend/apps/stock_api/services/theme_metrics.py` (신규) | 테마 지표 / 종목 이름·등락 붙이기 |
| `backend/apps/stock_api/services/admin_jobs.py` (신규) | 수동 실행 화이트리스트·잠금·기록 |
| `backend/apps/stock_api/routers/themes_admin.py` (수정) | `/metrics` 추가, 종목 목록에 지표 붙이기 |
| `backend/apps/stock_api/routers/market_admin.py` (신규) | `/api/v1/admin/market/status`, `/jobs`, `/jobs/{job}` |
| `backend/apps/stock_api/main.py` (수정) | market_admin 라우터 등록 |
| `backend/tests/test_pipeline_record.py`, `test_data_status.py`, `test_theme_metrics.py`, `test_admin_jobs.py`, `test_market_admin_api.py` (신규) | 테스트 |
| `backend/tests/test_market_tasks.py`, `test_themes_admin.py` (수정) | 기존 테스트가 실제 Redis·DB에 붙지 않게 가로챔 |
| `admin_web/src/api/client.ts` (수정) | `stockAdminClient` 추가 |
| `admin_web/src/api/marketAdmin.ts` (신규) | 관리자 시장 데이터 REST 함수 |
| `admin_web/src/types/marketAdmin.ts` (신규) | 응답 타입 |
| `admin_web/src/lib/apiError.ts`, `lib/marketFormat.ts` (신규) | 오류 메시지·숫자 표시 |
| `admin_web/src/components/market/*.tsx` (신규) | ThemeList, ThemeDetail, StockSearchAdd, DatasetCard, PipelineCard, JobsPanel |
| `admin_web/src/pages/MarketThemes.tsx`, `MarketStatus.tsx` (신규) | 화면 |
| `admin_web/src/App.tsx`, `components/Sidebar.tsx` (수정) | 라우트·메뉴 |
| `README.md` (수정) | 기능 안내 |

---

### Task 1: 동기 Redis 클라이언트 + 파이프라인 기록 모듈

**Files:**
- Create: `backend/shared/sync_redis.py`
- Create: `backend/shared/pipeline_record.py`
- Test: `backend/tests/test_pipeline_record.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_pipeline_record.py`

```python
"""일일 파이프라인 기록 — 저장·읽기·요약 자르기·Redis 장애 무시(fakeredis)."""
from __future__ import annotations

from datetime import datetime, timezone

import fakeredis

from shared import pipeline_record as pr

T0 = datetime(2026, 10, 16, 11, 30, tzinfo=timezone.utc)
T1 = datetime(2026, 10, 16, 12, 10, tzinfo=timezone.utc)


def test_save_and_load_roundtrip():
    fake = fakeredis.FakeRedis(decode_responses=True)
    steps = [{"name": "daily", "ok": True, "seconds": 12.5, "summary": "{}"}]
    pr.save(fake, T0, T1, steps)
    rec = pr.load(fake)
    assert rec == {"started_at": T0.isoformat(), "finished_at": T1.isoformat(), "steps": steps}
    assert 0 < fake.ttl(pr.KEY) <= pr.TTL_SECONDS


def test_load_missing_or_broken_returns_none():
    fake = fakeredis.FakeRedis(decode_responses=True)
    assert pr.load(fake) is None
    fake.set(pr.KEY, "{broken")
    assert pr.load(fake) is None


def test_redis_failure_is_swallowed():
    class Down:
        def set(self, *a, **k):
            raise ConnectionError("redis down")

        def get(self, *a, **k):
            raise ConnectionError("redis down")

    pr.save(Down(), T0, T1, [])  # 예외 없이 끝나야 한다
    assert pr.load(Down()) is None


def test_summarize_truncates_and_handles_non_json():
    assert len(pr.summarize({"x": "a" * 500})) == pr.SUMMARY_MAX
    assert pr.summarize({"d": T0}).startswith('{"d": "2026-10-16')
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_pipeline_record.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'shared.pipeline_record'`

- [ ] **Step 3: 구현** — `backend/shared/sync_redis.py`

```python
"""동기 Redis 클라이언트 — 프로세스당 1개를 처음 쓸 때 만든다(celery prefork 는 포크 뒤 자식에서 생성).

stock_api 관리자 기능(데이터 현황·수동 실행)과 collector 파이프라인 기록이 같이 쓴다.
짧은 타임아웃 — Redis 가 죽어도 관리자 화면·파이프라인이 오래 붙잡히지 않게.
"""
from __future__ import annotations

import os

import redis

_client: redis.Redis | None = None


def get_sync_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True, socket_timeout=3, socket_connect_timeout=3,
        )
    return _client
```

`backend/shared/pipeline_record.py`

```python
"""일일 시장 파이프라인 최근 실행 기록(Redis) — collector 가 쓰고 관리자 데이터 현황이 읽는다.

Celery 결과로는 찾을 수 없다(beat 실행의 task_id 를 모르고 결과는 1일 뒤 만료) → 고정 키 하나에 덮어쓴다.
저장·읽기 실패는 경고만 남기고 삼킨다 — 기록 때문에 파이프라인이나 관리자 화면이 실패하면 안 된다.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

log = logging.getLogger(__name__)

KEY = "collector:pipeline:last"
TTL_SECONDS = 8 * 24 * 3600
SUMMARY_MAX = 200


def summarize(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)[:SUMMARY_MAX]


def save(client, started_at: datetime, finished_at: datetime, steps: list[dict]) -> None:
    payload = {"started_at": started_at.isoformat(), "finished_at": finished_at.isoformat(), "steps": steps}
    try:
        client.set(KEY, json.dumps(payload, ensure_ascii=False), ex=TTL_SECONDS)
    except Exception as exc:  # noqa: BLE001
        log.warning("파이프라인 기록 저장 실패: %s", exc)


def load(client) -> dict | None:
    try:
        raw = client.get(KEY)
    except Exception as exc:  # noqa: BLE001
        log.warning("파이프라인 기록 읽기 실패: %s", exc)
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_pipeline_record.py -q`
Expected: `4 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/shared/sync_redis.py backend/shared/pipeline_record.py backend/tests/test_pipeline_record.py
git commit -m "feat(shared): 일일 파이프라인 기록(Redis 고정 키)·동기 Redis 클라이언트

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 일일 파이프라인이 단계별 결과를 기록

**Files:**
- Modify: `backend/apps/collector/tasks/market_data.py` (import 부분, `daily_market_pipeline` 함수 166~179행)
- Modify: `backend/tests/test_market_tasks.py` (`test_daily_pipeline_continues_after_failure`)
- Test: `backend/tests/test_market_tasks.py` (테스트 2개 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_market_tasks.py`
  - 파일 위쪽 import 에 `import fakeredis` 와 `from shared import pipeline_record` 를 추가한다.
  - 기존 `test_daily_pipeline_continues_after_failure` 의 첫 줄(`order = []` 앞)에 다음 한 줄을 추가한다. 실제 Redis 에 쓰지 않게 하기 위해서다.

```python
    monkeypatch.setattr(md, "get_sync_redis", lambda: fakeredis.FakeRedis(decode_responses=True))
```

그리고 파일 끝에 추가한다.

```python
def _stub_steps(monkeypatch, daily=None):
    monkeypatch.setattr(md, "_daily_ohlcv", daily or (lambda: {"ok": 1}))
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": {"ok": ["KOSPI"]})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: {"ok": 3})
    monkeypatch.setattr(md, "compute_canslim", lambda: {"rows": 10})
    monkeypatch.setattr(md, "compute_market_groups", lambda: {"error": "no bars"})


def test_daily_pipeline_records_steps(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(md, "get_sync_redis", lambda: fake)

    def boom():
        raise RuntimeError("master down")

    _stub_steps(monkeypatch, daily=boom)
    out = md.daily_market_pipeline()
    assert list(out) == ["daily", "indices_kr", "investor", "canslim", "market_groups"]
    assert out["investor"] == {"ok": 3} and "error" in out["daily"]
    rec = pipeline_record.load(fake)
    assert [s["name"] for s in rec["steps"]] == list(out)
    # 예외로 끝난 단계와 결과에 error 가 담긴 단계는 실패로 기록
    assert [s["ok"] for s in rec["steps"]] == [False, True, True, True, False]
    assert "master down" in rec["steps"][0]["summary"]
    assert all(isinstance(s["seconds"], float) for s in rec["steps"])
    assert rec["started_at"] <= rec["finished_at"]


def test_daily_pipeline_result_unchanged_when_redis_down(monkeypatch):
    class Down:
        def set(self, *a, **k):
            raise ConnectionError("redis down")

    monkeypatch.setattr(md, "get_sync_redis", lambda: Down())
    _stub_steps(monkeypatch)
    out = md.daily_market_pipeline()
    assert out == {"daily": {"ok": 1}, "indices_kr": {"ok": ["KOSPI"]}, "investor": {"ok": 3},
                   "canslim": {"rows": 10}, "market_groups": {"error": "no bars"}}
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_market_tasks.py -q`
Expected: FAIL — `AttributeError: <module 'apps.collector.tasks.market_data'> has no attribute 'get_sync_redis'`

- [ ] **Step 3: 구현** — `backend/apps/collector/tasks/market_data.py`
  - import 부분을 바꾼다. `import logging` 아래에 `import time` 을 넣고, `from datetime import date, timedelta` 를 `from datetime import date, datetime, timedelta, timezone` 으로 바꾼다.
  - `from shared import market_repo` 줄을 다음으로 바꾼다.

```python
from shared import market_repo, pipeline_record
from shared.sync_redis import get_sync_redis
```

`daily_market_pipeline` 함수 전체를 다음으로 바꾼다(단계 순서와 반환값은 그대로 둔다).

```python
@celery_app.task(name="collector.daily_market_pipeline")
def daily_market_pipeline() -> dict:
    """20:30 — 전종목 일봉 → 국내 지수 → 투자자별 순매수 → CANSLIM → 시장 그룹(차례로, 앞 단계 예외와 무관하게 진행).

    끝나면 단계별 성공·걸린 시간·요약을 Redis 에 남긴다(관리자 데이터 현황). 기록 실패는 결과에 영향 없음.
    """
    out: dict = {}
    record: list[dict] = []
    started = datetime.now(timezone.utc)
    steps = (("daily", _daily_ohlcv), ("indices_kr", lambda: collect_market_indices("KR")),
             ("investor", lambda: collect_investor_daily()), ("canslim", lambda: compute_canslim()),
             ("market_groups", lambda: compute_market_groups()))
    for name, step in steps:
        t0 = time.monotonic()
        try:
            out[name] = step()
        except Exception as e:  # noqa: BLE001
            log.exception("일일 파이프라인 단계 실패: %s", name)
            out[name] = {"error": repr(e)[:300]}
        result = out[name]
        record.append({"name": name, "ok": not (isinstance(result, dict) and "error" in result),
                       "seconds": round(time.monotonic() - t0, 1), "summary": pipeline_record.summarize(result)})
    pipeline_record.save(get_sync_redis(), started, datetime.now(timezone.utc), record)
    return out
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_market_tasks.py tests/test_pipeline_record.py -q`
Expected: 모두 passed(기존 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/collector/tasks/market_data.py backend/tests/test_market_tasks.py
git commit -m "feat(collector): 일일 파이프라인 단계별 결과·걸린 시간을 Redis 에 기록(순서·반환값 그대로)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: 데이터 현황 서비스

**Files:**
- Create: `backend/apps/stock_api/services/data_status.py`
- Test: `backend/tests/test_data_status.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_data_status.py`

```python
"""관리자 데이터 현황 — 데이터별 상태 판정(기준 거래일 비교·주기별 기준), 종목 수 감소 경고, 조회 실패 격리, 설정 값 비노출."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import fakeredis
import pytest

from apps.stock_api.services import data_status as ds
from shared import pipeline_record
from shared.clickhouse_schema import CLICKHOUSE_DB as DB

D = date(2026, 10, 16)  # 금요일 = 기준 거래일
SECRET = "fred-secret-value"


class _CH:
    """SQL 에 들어 있는 문자열로 결과를 고른다(먼저 맞는 것). 값이 예외면 던진다."""

    def __init__(self, routes):
        self.routes = routes

    def query(self, sql, parameters=None):
        for key, rows in self.routes:
            if key in sql:
                if isinstance(rows, Exception):
                    raise rows
                return SimpleNamespace(result_rows=rows)
        return SimpleNamespace(result_rows=[])


def _routes(**over):
    base = {
        "ref": (f"max(date) FROM {DB}.daily_prices", [[D]]),
        "daily": (f"uniqExact(ticker) FROM {DB}.daily_prices", [[D, 2400], [D - timedelta(days=1), 2500]]),
        "index": (f"FROM {DB}.market_index_daily", [["KR:0001", D], ["KR:1001", D], ["US:SPX", D - timedelta(days=1)]]),
        "investor": (f"FROM {DB}.investor_daily", [[D, 2300]]),
        "fund": (f"FROM {DB}.fundamentals_periodic", [[datetime(2026, 10, 10, 10, 30), 2500]]),
        "macro": (f"FROM {DB}.macro_series", [["CPIAUCSL", date(2026, 8, 15)], ["DGS10", D]]),
        "canslim": (f"FROM {DB}.canslim_daily", [[D, 2100]]),
        "groups": (f"FROM {DB}.market_group_daily", [[D, "sector", 40], [D, "theme", 150]]),
    }
    base.update(over)
    return list(base.values())


@pytest.fixture
def env(monkeypatch):
    holder = {"ch": _CH(_routes())}
    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(ds, "_ch", lambda: holder["ch"])
    monkeypatch.setattr(ds, "_today", lambda: D)
    monkeypatch.setattr(ds, "index_specs", lambda region: {
        "KR": [SimpleNamespace(code="KR:0001", name="코스피"), SimpleNamespace(code="KR:1001", name="코스닥")],
        "US": [SimpleNamespace(code="US:SPX", name="S&P500")]}[region])
    monkeypatch.setattr(ds.fred, "series_ids", lambda: ["CPIAUCSL", "DGS10"])
    monkeypatch.setattr(ds, "_ipo_stats", lambda today: (datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc), 4))
    monkeypatch.setattr(ds, "get_sync_redis", lambda: fake)
    monkeypatch.setenv("FRED_API_KEY", SECRET)
    monkeypatch.setenv("FUNDAMENTALS_Q_CUMULATIVE", "true")

    def use(**over):
        holder["ch"] = _CH(_routes(**over))

    return SimpleNamespace(use=use, redis=fake)


def _by_key(out):
    return {d["key"]: d for d in out["datasets"]}


def test_all_ok(env):
    pipeline_record.save(env.redis, datetime(2026, 10, 16, 11, 30, tzinfo=timezone.utc),
                         datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc), [{"name": "daily", "ok": True, "seconds": 1.0, "summary": "{}"}])
    out = ds.build_status()
    got = _by_key(out)
    assert out["ref_date"] == "2026-10-16"
    assert list(got) == ["daily", "indices_kr", "indices_us", "investor", "fundamentals", "macro", "ipo",
                         "canslim", "market_groups"]
    assert {k: v["status"] for k, v in got.items()} == {
        "daily": "ok", "indices_kr": "ok", "indices_us": "ok", "investor": "ok", "fundamentals": "ok",
        "macro": "stale", "ipo": "ok", "canslim": "ok", "market_groups": "ok"}  # CPIAUCSL 45일 초과
    assert got["daily"]["count"] == 2400 and got["daily"]["unit"] == "종목"
    assert got["market_groups"]["count"] == 190 and "테마 150" in got["market_groups"]["note"]
    assert [i["status"] for i in got["macro"]["items"]] == ["stale", "ok"]
    assert got["ipo"]["count"] == 4
    assert out["settings"] == {"fred_key": True, "q_cumulative": "true"}
    assert out["pipeline"]["steps"][0]["name"] == "daily"
    assert SECRET not in json.dumps(out, ensure_ascii=False)


def test_stale_warn_and_off(env, monkeypatch):
    env.use(daily=(f"uniqExact(ticker) FROM {DB}.daily_prices", [[D, 2000], [D - timedelta(days=1), 2500]]),
            index=(f"FROM {DB}.market_index_daily", [["KR:0001", D], ["KR:1001", D - timedelta(days=1)],
                                                     ["US:SPX", D - timedelta(days=6)]]),
            investor=(f"FROM {DB}.investor_daily", [[D - timedelta(days=1), 2300]]),
            fund=(f"FROM {DB}.fundamentals_periodic", [[datetime(2026, 10, 3, 10, 30), 2500]]))
    monkeypatch.delenv("FRED_API_KEY")
    monkeypatch.delenv("FUNDAMENTALS_Q_CUMULATIVE")
    monkeypatch.setattr(ds, "_ipo_stats", lambda today: (None, 0))
    out = ds.build_status()
    got = _by_key(out)
    assert got["daily"]["status"] == "warn" and "20%" in got["daily"]["note"]
    assert got["indices_kr"]["status"] == "stale"
    assert [i["status"] for i in got["indices_kr"]["items"]] == ["ok", "stale"]
    assert got["indices_us"]["status"] == "stale"  # 기준일보다 4일 넘게 이전
    assert got["investor"]["status"] == "stale"
    assert got["fundamentals"]["status"] == "stale"
    assert got["macro"]["status"] == "off"
    assert got["ipo"]["status"] == "empty"
    assert out["settings"] == {"fred_key": False, "q_cumulative": "unset"}
    assert out["pipeline"] is None


def test_query_failure_is_isolated(env):
    env.use(index=(f"FROM {DB}.market_index_daily", RuntimeError("table missing")))
    got = _by_key(ds.build_status())
    assert got["indices_kr"]["status"] == "error" and got["indices_us"]["status"] == "error"
    assert got["daily"]["status"] == "ok" and got["canslim"]["status"] == "ok"


def test_empty_tables(env):
    epoch = date(1970, 1, 1)
    env.use(ref=(f"max(date) FROM {DB}.daily_prices", [[epoch]]),
            daily=(f"uniqExact(ticker) FROM {DB}.daily_prices", []),
            canslim=(f"FROM {DB}.canslim_daily", []),
            groups=(f"FROM {DB}.market_group_daily", []))
    out = ds.build_status()
    got = _by_key(out)
    assert out["ref_date"] is None
    assert got["daily"]["status"] == "empty"
    assert got["canslim"]["status"] == "empty" and got["market_groups"]["status"] == "empty"


def test_ref_query_failure_marks_daily_error(env):
    env.use(ref=(f"max(date) FROM {DB}.daily_prices", RuntimeError("ch down")))
    got = _by_key(ds.build_status())
    assert got["daily"]["status"] == "error"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_data_status.py -q`
Expected: FAIL — `ImportError: cannot import name 'data_status'`

- [ ] **Step 3: 구현** — `backend/apps/stock_api/services/data_status.py`

```python
"""관리자 데이터 현황 — 데이터별 최신일·건수·상태, 설정 상태(값은 절대 반환하지 않음), 최근 일일 파이프라인.

지연은 달력이 아니라 daily_prices 최신 거래일(ref)과 비교한다 → 휴장일 달력이 필요 없다.
주기가 다른 데이터(재무 주 1회·FRED 월간·공모주)는 오늘 기준 일수로 따로 판정한다.
전체 count() FINAL 은 쓰지 않는다(최신일 + 그날 종목 수만). 조회 하나가 실패해도 그 항목만 error.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Callable

from sqlalchemy import func, select

from apps.collector import fred
from apps.collector.market_indices import index_specs
from apps.collector.tasks.canslim import q_cumulative_setting
from shared import pipeline_record
from shared.clickhouse_schema import CLICKHOUSE_DB as DB
from shared.clickhouse_schema import get_client
from shared.database import SyncSessionLocal
from shared.market_models import StockEvent
from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)

_EPOCH = date(1970, 1, 1)
DAILY_DROP_WARN = 0.10       # 전 거래일보다 종목 수가 10% 넘게 줄면 주의
US_STALE_DAYS = 4            # 미국은 시차·휴장 허용
FUNDAMENTALS_STALE_DAYS = 8  # 매주 토요일 수집
MACRO_STALE_DAYS = 45        # 월간 지표
IPO_STALE_DAYS = 3
IPO_AHEAD_DAYS = 60
LATE = "최신 거래일보다 늦어요"


# ---------------------------------------------------------------- 저장소 접근(테스트에서 바꿔 끼운다)
def _ch():
    return get_client()


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def _today() -> date:
    return date.today()


def _ipo_stats(today: date) -> tuple[datetime | None, int]:
    """(KIS 공모주 일정 마지막 갱신 시각, 앞으로 IPO_AHEAD_DAYS 일 일정 수)."""
    with SyncSessionLocal() as db:
        last = db.execute(select(func.max(StockEvent.updated_at)).where(StockEvent.source == "kis")).scalar()
        upcoming = db.execute(
            select(func.count()).select_from(StockEvent).where(
                StockEvent.source == "kis", StockEvent.event_date >= today,
                StockEvent.event_date <= today + timedelta(days=IPO_AHEAD_DAYS))
        ).scalar()
    return last, int(upcoming or 0)


# ---------------------------------------------------------------- 도우미
def _day(v) -> date | None:
    """CH 의 빈 max() 는 NULL 이 아니라 1970-01-01 이다 → None."""
    if v is None:
        return None
    d = v.date() if isinstance(v, datetime) else v
    return None if d <= _EPOCH else d


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _item(key: str, label: str, latest: date | None = None, count: int | None = None, unit: str = "",
          status: str = "ok", note: str = "", items: list | None = None) -> dict:
    out = {"key": key, "label": label, "latest": _iso(latest), "count": count, "unit": unit,
           "status": status, "note": note}
    if items is not None:
        out["items"] = items
    return out


# ---------------------------------------------------------------- 데이터별
def _daily(ref: date | None) -> dict:
    if ref is None:
        return _item("daily", "일봉", unit="종목", status="empty", note="일봉 데이터가 없어요")
    rows = _query(f"SELECT date, uniqExact(ticker) FROM {DB}.daily_prices "
                  "WHERE date > %(since)s AND date <= %(d)s GROUP BY date ORDER BY date DESC LIMIT 2",
                  {"since": ref - timedelta(days=14), "d": ref})
    cur = int(rows[0][1]) if rows else 0
    prev = int(rows[1][1]) if len(rows) > 1 else None
    if prev and cur < prev * (1 - DAILY_DROP_WARN):
        drop = round((1 - cur / prev) * 100)
        return _item("daily", "일봉", ref, cur, "종목", "warn", f"전 거래일({prev:,}종목)보다 {drop}% 적어요")
    return _item("daily", "일봉", ref, cur, "종목", note=f"전 거래일 {prev:,}종목" if prev else "")


def _indices(region: str, ref: date | None) -> dict:
    key, label = ("indices_kr", "국내 지수") if region == "KR" else ("indices_us", "미국 지수·환율·대표 종목")
    specs = index_specs(region)
    rows = _query(f"SELECT code, max(date) FROM {DB}.market_index_daily WHERE code IN %(codes)s GROUP BY code",
                  {"codes": [s.code for s in specs]})
    found = {code: _day(d) for code, d in rows}
    items = []
    for s in specs:
        d = found.get(s.code)
        if region == "KR":
            late = d is None or (ref is not None and d < ref)
        else:
            late = d is None or (ref is not None and (ref - d).days > US_STALE_DAYS)
        items.append({"code": s.code, "name": s.name, "latest": _iso(d), "status": "stale" if late else "ok"})
    dates = [d for d in found.values() if d]
    if not dates:
        return _item(key, label, None, len(specs), "코드", "empty", "수집된 지수가 없어요", items)
    n_late = sum(i["status"] == "stale" for i in items)
    return _item(key, label, max(dates), len(specs), "코드", "stale" if n_late else "ok",
                 f"{n_late}개 코드가 늦어요" if n_late else "", items)


def _latest(table: str, key: str, label: str, ref: date | None) -> dict:
    rows = _query(f"SELECT date, uniqExact(ticker) FROM {DB}.{table} "
                  f"WHERE date = (SELECT max(date) FROM {DB}.{table}) GROUP BY date")
    d = _day(rows[0][0]) if rows else None
    if d is None:
        return _item(key, label, unit="종목", status="empty", note="데이터가 없어요")
    late = ref is not None and d < ref
    return _item(key, label, d, int(rows[0][1]), "종목", "stale" if late else "ok", LATE if late else "")


def _market_groups(ref: date | None) -> dict:
    rows = _query(f"SELECT date, kind, uniqExact(group_id) FROM {DB}.market_group_daily FINAL "
                  f"WHERE date = (SELECT max(date) FROM {DB}.market_group_daily) AND members > 0 GROUP BY date, kind")
    d = _day(rows[0][0]) if rows else None
    if d is None:
        return _item("market_groups", "시장 그룹(테마·업종)", unit="그룹", status="empty", note="데이터가 없어요")
    by_kind = {kind: int(n) for _, kind, n in rows}
    late = ref is not None and d < ref
    note = f"테마 {by_kind.get('theme', 0)} · 업종 {by_kind.get('sector', 0)}" + (f" · {LATE}" if late else "")
    return _item("market_groups", "시장 그룹(테마·업종)", d, sum(by_kind.values()), "그룹",
                 "stale" if late else "ok", note)


def _fundamentals(today: date) -> dict:
    rows = _query(f"SELECT max(ingested_at), uniqExact(ticker) FROM {DB}.fundamentals_periodic")
    d = _day(rows[0][0]) if rows else None
    if d is None:
        return _item("fundamentals", "재무(분기·연간)", unit="종목", status="empty", note="데이터가 없어요")
    late = (today - d).days > FUNDAMENTALS_STALE_DAYS
    note = f"{FUNDAMENTALS_STALE_DAYS}일 넘게 수집되지 않았어요(매주 토요일 수집)" if late else "매주 토요일 수집"
    return _item("fundamentals", "재무(분기·연간)", d, int(rows[0][1]), "종목", "stale" if late else "ok", note)


def _macro(today: date) -> dict:
    ids = fred.series_ids()
    if fred.api_key() is None:
        return _item("macro", "FRED 거시 지표", None, len(ids), "시리즈", "off", "FRED_API_KEY 가 없어 수집하지 않아요")
    rows = _query(f"SELECT series_id, max(date) FROM {DB}.macro_series WHERE series_id IN %(ids)s "
                  "GROUP BY series_id", {"ids": ids})
    found = {sid: _day(d) for sid, d in rows}
    items = []
    for sid in ids:
        d = found.get(sid)
        late = d is None or (today - d).days > MACRO_STALE_DAYS
        items.append({"code": sid, "latest": _iso(d), "status": "stale" if late else "ok"})
    dates = [d for d in found.values() if d]
    if not dates:
        return _item("macro", "FRED 거시 지표", None, len(ids), "시리즈", "empty", "수집된 시리즈가 없어요", items)
    n_late = sum(i["status"] == "stale" for i in items)
    note = f"{n_late}개 시리즈가 {MACRO_STALE_DAYS}일 넘게 갱신되지 않았어요" if n_late else ""
    return _item("macro", "FRED 거시 지표", max(dates), len(ids), "시리즈", "stale" if n_late else "ok", note, items)


def _ipo(today: date) -> dict:
    last, upcoming = _ipo_stats(today)
    d = _day(last)
    if d is None:
        return _item("ipo", "공모주 일정", unit="건", status="empty", note="수집된 일정이 없어요")
    late = (today - d).days > IPO_STALE_DAYS
    note = f"앞으로 {IPO_AHEAD_DAYS}일 일정 {upcoming}건" + (f" · {IPO_STALE_DAYS}일 넘게 갱신되지 않았어요" if late else "")
    return _item("ipo", "공모주 일정", d, upcoming, "건", "stale" if late else "ok", note)


def _safe(key: str, label: str, fn: Callable[[], dict]) -> dict:
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 — 한 항목 실패가 화면 전체를 막지 않게
        log.warning("데이터 현황 조회 실패 %s: %s", key, exc)
        return _item(key, label, status="error", note="조회에 실패했어요(서버 로그 확인)")


def _settings() -> dict:
    """설정 '여부'만 — 값 자체는 절대 내보내지 않는다."""
    q = q_cumulative_setting()
    return {"fred_key": fred.api_key() is not None,
            "q_cumulative": "unset" if q is None else ("true" if q else "false")}


def build_status() -> dict:
    today = _today()
    ref, ref_failed = None, False
    try:
        rows = _query(f"SELECT max(date) FROM {DB}.daily_prices")
        ref = _day(rows[0][0]) if rows else None
    except Exception as exc:  # noqa: BLE001
        log.warning("기준 거래일 조회 실패: %s", exc)
        ref_failed = True

    def daily() -> dict:
        if ref_failed:
            raise RuntimeError("기준 거래일 조회 실패")
        return _daily(ref)

    datasets = [
        _safe("daily", "일봉", daily),
        _safe("indices_kr", "국내 지수", lambda: _indices("KR", ref)),
        _safe("indices_us", "미국 지수·환율·대표 종목", lambda: _indices("US", ref)),
        _safe("investor", "투자자 순매수", lambda: _latest("investor_daily", "investor", "투자자 순매수", ref)),
        _safe("fundamentals", "재무(분기·연간)", lambda: _fundamentals(today)),
        _safe("macro", "FRED 거시 지표", lambda: _macro(today)),
        _safe("ipo", "공모주 일정", lambda: _ipo(today)),
        _safe("canslim", "CANSLIM", lambda: _latest("canslim_daily", "canslim", "CANSLIM", ref)),
        _safe("market_groups", "시장 그룹(테마·업종)", lambda: _market_groups(ref)),
    ]
    return {"ref_date": _iso(ref), "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "datasets": datasets, "settings": _settings(), "pipeline": pipeline_record.load(get_sync_redis())}
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_data_status.py -q`
Expected: `5 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/stock_api/services/data_status.py backend/tests/test_data_status.py
git commit -m "feat(stock_api): 관리자 데이터 현황 서비스 — 기준 거래일 비교·주기별 기준·조회 실패 격리·설정 값 비노출

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: 테마 지표 서비스 + 테마 라우터 연결

**Files:**
- Create: `backend/apps/stock_api/services/theme_metrics.py`
- Modify: `backend/apps/stock_api/routers/themes_admin.py`
- Modify: `backend/tests/test_themes_admin.py` (autouse 픽스처 1개, 테스트 1개 추가)
- Test: `backend/tests/test_theme_metrics.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_theme_metrics.py`

```python
"""테마 관리자 지표 — 최신 기준일 테마 지표(id 별), 종목 이름·등락 붙이기, CH·PG 실패 시 null(목록은 그대로)."""
from __future__ import annotations

from datetime import date

from apps.stock_api.services import theme_metrics as tm

D = date(2026, 10, 16)


def test_theme_metrics_by_id(monkeypatch):
    seen = []

    def q(sql, params=None):
        seen.append(sql)
        return [[D, "7", 1, 3.2, 5e11, 12, "000660"]]

    monkeypatch.setattr(tm, "_query", q)
    monkeypatch.setattr(tm, "_names", lambda tickers: {t: f"이름{t}" for t in tickers})
    assert tm.theme_metrics() == {"as_of": "2026-10-16", "themes": {"7": {
        "rank": 1, "chg_1d": 3.2, "value": 5e11, "members": 12, "leader_ticker": "000660",
        "leader_name": "이름000660"}}}
    assert "FINAL" in seen[0] and "kind = 'theme'" in seen[0] and "members > 0" in seen[0]


def test_theme_metrics_failure_returns_empty(monkeypatch):
    def boom(sql, params=None):
        raise RuntimeError("ch down")

    monkeypatch.setattr(tm, "_query", boom)
    assert tm.theme_metrics() == {"as_of": None, "themes": {}}


def test_attach_stock_metrics(monkeypatch):
    monkeypatch.setattr(tm, "_query", lambda sql, params=None: [["A", 1.5, 1e9]])
    monkeypatch.setattr(tm, "_names", lambda tickers: {"A": "에이"})
    rows = [{"ticker": "A", "source": "kis", "is_excluded": False, "reason": None},
            {"ticker": "B", "source": "admin", "is_excluded": True, "reason": "x"}]
    out = tm.attach_stock_metrics(rows)
    assert out[0] == {"ticker": "A", "source": "kis", "is_excluded": False, "reason": None,
                      "name": "에이", "chg_1d": 1.5, "value": 1e9}
    assert out[1]["name"] is None and out[1]["chg_1d"] is None and out[1]["reason"] == "x"


def test_attach_stock_metrics_failures_keep_rows(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(tm, "_query", boom)
    monkeypatch.setattr(tm, "_names", boom)
    out = tm.attach_stock_metrics([{"ticker": "A", "source": "kis", "is_excluded": False, "reason": None}])
    assert out == [{"ticker": "A", "source": "kis", "is_excluded": False, "reason": None,
                    "name": None, "chg_1d": None, "value": None}]
    assert tm.attach_stock_metrics([]) == []
```

`backend/tests/test_themes_admin.py` 를 수정한다.
- import 에 `from apps.stock_api.services import theme_metrics` 를 추가한다.
- `sent` 픽스처 아래에 다음을 추가한다.

```python
@pytest.fixture(autouse=True)
def no_metrics(monkeypatch):
    """지표 조회(CH·PG 동기 세션)가 실제 DB 에 붙지 않게 — 빈 결과."""
    monkeypatch.setattr(theme_metrics, "_query", lambda sql, params=None: [])
    monkeypatch.setattr(theme_metrics, "_names", lambda tickers: {})
```

파일 끝에 추가한다.

```python
async def test_metrics_endpoint_and_stock_fields(api, maker, monkeypatch):
    client, state = api
    admin, user, tid = await _seed(maker)
    state["user"] = user
    assert (await client.get("/api/v1/admin/themes/metrics")).status_code == 403
    state["user"] = admin
    monkeypatch.setattr(theme_metrics, "theme_metrics", lambda: {"as_of": "2026-10-16", "themes": {}})
    r = await client.get("/api/v1/admin/themes/metrics")
    assert r.status_code == 200 and r.json() == {"as_of": "2026-10-16", "themes": {}}
    stocks = (await client.get(f"/api/v1/admin/themes/{tid}/stocks")).json()
    assert stocks == [{"ticker": "005930", "source": "kis", "is_excluded": False, "reason": None,
                       "name": None, "chg_1d": None, "value": None}]
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_theme_metrics.py tests/test_themes_admin.py -q`
Expected: FAIL — `ImportError: cannot import name 'theme_metrics'`

- [ ] **Step 3: 구현** — `backend/apps/stock_api/services/theme_metrics.py`

```python
"""테마 관리자 화면용 시장 지표 — 테마별 최신 기준일 순위·등락·거래대금, 구성 종목 이름·등락.

collector 가 계산해 둔 market_group_daily / market_stock_daily 를 읽기만 한다.
ClickHouse·PG 조회가 실패해도 보정 화면은 동작해야 하므로 지표만 비우고(null) 경고를 남긴다.
"""
from __future__ import annotations

import logging

from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB as DB
from shared.clickhouse_schema import get_client
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)


def _query(sql: str, params: dict | None = None) -> list:
    return get_client().query(sql, parameters=params or {}).result_rows


def _names(tickers: list[str]) -> dict[str, str]:
    tickers = sorted({t for t in tickers if t})
    if not tickers:
        return {}
    with SyncSessionLocal() as db:
        return market_repo.names_for(db, tickers)


def theme_metrics() -> dict:
    """{"as_of": 기준일|None, "themes": {테마 id(문자열): {rank, chg_1d, value, members, leader_ticker, leader_name}}}."""
    try:
        rows = _query(
            f"SELECT date, group_id, rank, chg_1d, value, members, leader_ticker FROM {DB}.market_group_daily FINAL "
            f"WHERE kind = 'theme' AND members > 0 "
            f"AND date = (SELECT max(date) FROM {DB}.market_group_daily WHERE kind = 'theme')")
        names = _names([r[6] for r in rows])
    except Exception as exc:  # noqa: BLE001
        log.warning("테마 지표 조회 실패: %s", exc)
        return {"as_of": None, "themes": {}}
    if not rows:
        return {"as_of": None, "themes": {}}
    return {"as_of": rows[0][0].isoformat(), "themes": {
        gid: {"rank": int(rank), "chg_1d": chg, "value": value, "members": int(members),
              "leader_ticker": leader, "leader_name": names.get(leader)}
        for _, gid, rank, chg, value, members, leader in rows}}


def attach_stock_metrics(stocks: list[dict]) -> list[dict]:
    """구성 종목 행에 name·chg_1d·value 를 더한다(기존 필드 유지). 조회 실패 시 None."""
    tickers = [s["ticker"] for s in stocks]
    if not tickers:
        return stocks
    try:
        names = _names(tickers)
    except Exception as exc:  # noqa: BLE001
        log.warning("종목 이름 조회 실패: %s", exc)
        names = {}
    try:
        rows = _query(f"SELECT ticker, chg_1d, value FROM {DB}.market_stock_daily FINAL "
                      f"WHERE date = (SELECT max(date) FROM {DB}.market_stock_daily) AND ticker IN %(t)s",
                      {"t": tickers})
    except Exception as exc:  # noqa: BLE001
        log.warning("종목 지표 조회 실패: %s", exc)
        rows = []
    by_ticker = {t: (chg, value) for t, chg, value in rows}
    for s in stocks:
        chg, value = by_ticker.get(s["ticker"], (None, None))
        s.update({"name": names.get(s["ticker"]), "chg_1d": chg, "value": value})
    return stocks
```

`backend/apps/stock_api/routers/themes_admin.py` 를 수정한다.
- import 부분에 다음을 추가한다.

```python
from fastapi.concurrency import run_in_threadpool

from apps.stock_api.services import theme_metrics
```

- `list_themes` 라우트 바로 아래에 추가한다.

```python
@router.get("/metrics")
async def theme_metrics_(_admin: User = Depends(require_admin)):
    """테마별 최신 기준일 시장 지표 — 목록 응답(기존 형태)과 따로 받아 화면에서 합친다."""
    return await run_in_threadpool(theme_metrics.theme_metrics)
```

`list_stocks` 라우트 본문을 다음으로 바꾼다.

```python
@router.get("/{theme_id}/stocks")
async def list_stocks(theme_id: int, _admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    try:
        rows = await svc.list_stocks(db, theme_id)
    except svc.ThemeNotFound:
        raise _404()
    return await run_in_threadpool(theme_metrics.attach_stock_metrics, rows)
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_theme_metrics.py tests/test_themes_admin.py -q`
Expected: 모두 passed. 기존 `test_admin_flow` 의 목록 비교(`listed == [...]`)도 그대로 통과해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/stock_api/services/theme_metrics.py backend/apps/stock_api/routers/themes_admin.py backend/tests/test_theme_metrics.py backend/tests/test_themes_admin.py
git commit -m "feat(stock_api): 테마 관리자 지표 — /themes/metrics(최신 순위·등락·거래대금), 종목 목록에 이름·등락(기존 필드 유지)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 계산 수동 실행 서비스

**Files:**
- Create: `backend/apps/stock_api/services/admin_jobs.py`
- Test: `backend/tests/test_admin_jobs.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_admin_jobs.py`

```python
"""관리자 계산 수동 실행 — 화이트리스트, 실행 중 409, 끝난 잠금 교체, 기록 30건, 큐 장애 시 잠금 해제(fakeredis)."""
from __future__ import annotations

import json
from types import SimpleNamespace

import fakeredis
import pytest

from apps.stock_api.services import admin_jobs as aj


@pytest.fixture
def env(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    states: dict = {}
    sent: list = []
    monkeypatch.setattr(aj, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(aj, "_task_state", lambda tid: states.get(tid, ("PENDING", None)))
    monkeypatch.setattr(aj.celery_app, "send_task",
                        lambda name, kwargs=None, task_id=None: sent.append((name, kwargs, task_id)))
    return SimpleNamespace(redis=fake, states=states, sent=sent)


def _job(overview, key):
    return next(j for j in overview["jobs"] if j["key"] == key)


def test_unknown_job_rejected(env):
    with pytest.raises(aj.UnknownJob):
        aj.run("settle_trading_season", "관리자")
    assert env.sent == []


def test_run_sends_whitelisted_task_and_records(env):
    out = aj.run("backfill_market_groups", "관리자")
    assert env.sent == [("collector.backfill_market_groups", {"days": 60}, out["task_id"])]
    assert 0 < env.redis.ttl("admin:job:backfill_market_groups") <= 3600
    ov = aj.overview()
    assert [j["key"] for j in ov["jobs"]] == ["canslim", "market_groups", "backfill_canslim", "backfill_market_groups"]
    job = _job(ov, "backfill_market_groups")
    assert job["status"] == "queued" and job["task_id"] == out["task_id"]
    assert _job(ov, "canslim")["status"] == "idle"
    h = ov["history"][0]
    assert h["actor"] == "관리자" and h["state"] == "PENDING" and h["label"] == "시장 그룹 60일 백필"


def test_second_run_while_active_conflicts(env):
    first = aj.run("canslim", "A")
    env.states[first["task_id"]] = ("STARTED", None)
    with pytest.raises(aj.JobRunning) as e:
        aj.run("canslim", "B")
    assert e.value.info["task_id"] == first["task_id"] and e.value.info["actor"] == "A"
    assert len(env.sent) == 1
    assert _job(aj.overview(), "canslim")["status"] == "running"


def test_finished_lock_is_replaced(env):
    first = aj.run("canslim", "A")
    env.states[first["task_id"]] = ("SUCCESS", {"rows": 2400})
    second = aj.run("canslim", "B")
    assert second["task_id"] != first["task_id"] and len(env.sent) == 2
    ov = aj.overview()
    assert _job(ov, "canslim")["status"] == "queued"
    assert ov["history"][0]["task_id"] == second["task_id"]
    assert ov["history"][1]["state"] == "SUCCESS" and '"rows": 2400' in ov["history"][1]["result_summary"]


def test_failure_summary_and_expired_history(env):
    first = aj.run("market_groups", "A")
    env.states[first["task_id"]] = ("FAILURE", RuntimeError("no bars"))
    env.redis.rpush(aj.HISTORY_KEY, json.dumps({"job": "canslim", "task_id": "old", "actor": "A",
                                                "requested_at": "2026-10-14T11:00:00+00:00"}))
    ov = aj.overview()
    assert ov["history"][0]["state"] == "FAILURE" and "no bars" in ov["history"][0]["result_summary"]
    assert ov["history"][1]["state"] == "UNKNOWN" and ov["history"][1]["result_summary"] is None


def test_history_trimmed(env):
    for _ in range(aj.HISTORY_MAX + 3):
        out = aj.run("market_groups", "A")
        env.states[out["task_id"]] = ("SUCCESS", {})
    assert env.redis.llen(aj.HISTORY_KEY) == aj.HISTORY_MAX


def test_queue_failure_releases_lock(env, monkeypatch):
    def down(*a, **k):
        raise ConnectionError("broker down")

    monkeypatch.setattr(aj.celery_app, "send_task", down)
    with pytest.raises(aj.QueueUnavailable):
        aj.run("canslim", "A")
    assert env.redis.get("admin:job:canslim") is None
    assert env.redis.llen(aj.HISTORY_KEY) == 0
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_admin_jobs.py -q`
Expected: FAIL — `ImportError: cannot import name 'admin_jobs'`

- [ ] **Step 3: 구현** — `backend/apps/stock_api/services/admin_jobs.py`

```python
"""관리자 계산 수동 실행 — 서버가 정한 작업(JOBS)만, 같은 작업 중복 실행 방지, 최근 실행 기록(Redis).

중복 방지는 여기(관리자 실행)에서만 한다. 작업 본문에는 잠금을 걸지 않는다 — 테마 보정마다 보내는
compute_market_groups 가 '실행 중이라 건너뜀'이 되면 마지막 보정이 다음 날까지 반영되지 않는다(계산은 멱등).
잠금 값에 task_id 를 넣고 Celery 상태로 실제 실행 여부를 확인한다. 배포로 워커가 바뀌어 STARTED 에 멈춘
잠금은 TTL 이 지나면 풀린다. KIS 를 호출하는 수집 작업은 2단계(파이프라인 잠금과 함께)에서 추가한다.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import redis

from apps.collector.celery_app import celery_app
from shared.sync_redis import get_sync_redis

log = logging.getLogger("stock_api.admin_jobs")


@dataclass(frozen=True)
class Job:
    key: str
    label: str
    description: str
    task: str
    eta: str
    lock_ttl: int  # 초
    kwargs: dict = field(default_factory=dict)


JOBS: dict[str, Job] = {j.key: j for j in (
    Job("canslim", "CANSLIM 계산", "최신 거래일 CANSLIM 점수와 시장 상태를 다시 계산해요",
        "collector.compute_canslim", "수 초", 600),
    Job("market_groups", "시장 그룹 계산", "최신 거래일 테마·업종 순위를 다시 계산해요",
        "collector.compute_market_groups", "수 초", 600),
    Job("backfill_canslim", "CANSLIM 60일 백필", "최근 60거래일 CANSLIM 을 다시 계산해요",
        "collector.backfill_canslim", "수 분", 3600, {"days": 60}),
    Job("backfill_market_groups", "시장 그룹 60일 백필", "최근 60거래일 테마·업종 순위를 다시 계산해요",
        "collector.backfill_market_groups", "수 분", 3600, {"days": 60}),
)}
LOCK_KEY = "admin:job:{}"
HISTORY_KEY = "admin:job:history"
HISTORY_MAX = 30
SUMMARY_MAX = 200
_ACTIVE = frozenset({"PENDING", "RECEIVED", "STARTED", "RETRY"})


class UnknownJob(Exception):
    pass


class QueueUnavailable(Exception):
    pass


class JobRunning(Exception):
    def __init__(self, info: dict):
        super().__init__(info.get("task_id"))
        self.info = info


def _task_state(task_id: str) -> tuple[str, object]:
    """(Celery 상태, 끝났으면 결과). 모르는 id 는 Celery 가 PENDING 으로 답한다."""
    r = celery_app.AsyncResult(task_id)
    state = r.state
    return state, (r.result if state in ("SUCCESS", "FAILURE") else None)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _held(r, job: Job) -> dict | None:
    """실제로 대기·실행 중인 잠금이면 {..., state}, 아니면 None."""
    raw = r.get(LOCK_KEY.format(job.key))
    if not raw:
        return None
    info = json.loads(raw)
    state, _ = _task_state(info["task_id"])
    return {**info, "state": state} if state in _ACTIVE else None


def _replace_if_same(r, key: str, old: str | None, new: str, ttl: int) -> bool:
    """읽은 값 그대로일 때만 교체 — 동시에 누른 다른 관리자의 새 잠금을 덮지 않게."""
    with r.pipeline() as p:
        try:
            p.watch(key)
            if p.get(key) != old:
                return False
            p.multi()
            p.set(key, new, ex=ttl)
            p.execute()
            return True
        except redis.WatchError:
            return False


def run(job_key: str, actor: str) -> dict:
    job = JOBS.get(job_key)
    if job is None:
        raise UnknownJob(job_key)
    r = get_sync_redis()
    key = LOCK_KEY.format(job.key)
    info = {"task_id": uuid.uuid4().hex, "job": job.key, "actor": actor, "requested_at": _now()}
    payload = json.dumps(info, ensure_ascii=False)
    if not r.set(key, payload, nx=True, ex=job.lock_ttl):
        old = r.get(key)
        held = json.loads(old) if old else None
        if held and _task_state(held["task_id"])[0] in _ACTIVE:
            raise JobRunning(held)
        if not _replace_if_same(r, key, old, payload, job.lock_ttl):
            raise JobRunning(json.loads(r.get(key) or payload))
    try:
        celery_app.send_task(job.task, kwargs=job.kwargs, task_id=info["task_id"])
    except Exception as exc:  # noqa: BLE001
        r.delete(key)
        raise QueueUnavailable(str(exc)) from exc
    r.lpush(HISTORY_KEY, payload)
    r.ltrim(HISTORY_KEY, 0, HISTORY_MAX - 1)
    log.info("admin job run job=%s task=%s actor=%s", job.key, info["task_id"], actor)
    return {"task_id": info["task_id"], "requested_at": info["requested_at"]}


def _summary(state: str, result) -> str | None:
    if result is None:
        return None
    if state == "SUCCESS":
        return json.dumps(result, ensure_ascii=False, default=str)[:SUMMARY_MAX]
    return repr(result)[:SUMMARY_MAX]


def overview() -> dict:
    r = get_sync_redis()
    jobs, active_ids = [], set()
    for job in JOBS.values():
        held = _held(r, job)
        status = "idle"
        if held:
            status = "queued" if held["state"] == "PENDING" else "running"
            active_ids.add(held["task_id"])
        jobs.append({"key": job.key, "label": job.label, "description": job.description, "eta": job.eta,
                     "status": status, "task_id": held["task_id"] if held else None,
                     "requested_at": held["requested_at"] if held else None})
    history = []
    for raw in r.lrange(HISTORY_KEY, 0, HISTORY_MAX - 1):
        h = json.loads(raw)
        state, result = _task_state(h["task_id"])
        if state == "PENDING" and h["task_id"] not in active_ids:
            state = "UNKNOWN"  # Celery 결과 만료(1일) — 기록만 남음
        job = JOBS.get(h["job"])
        history.append({"job": h["job"], "label": job.label if job else h["job"], "task_id": h["task_id"],
                        "actor": h.get("actor"), "requested_at": h.get("requested_at"), "state": state,
                        "result_summary": _summary(state, result)})
    return {"jobs": jobs, "history": history}
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_admin_jobs.py -q`
Expected: `7 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/stock_api/services/admin_jobs.py backend/tests/test_admin_jobs.py
git commit -m "feat(stock_api): 관리자 계산 수동 실행 — 화이트리스트 4개·Redis 잠금(task_id+TTL)·최근 기록 30건

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 관리자 시장 라우터

**Files:**
- Create: `backend/apps/stock_api/routers/market_admin.py`
- Modify: `backend/apps/stock_api/main.py`
- Test: `backend/tests/test_market_admin_api.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_market_admin_api.py`

```python
"""관리자 시장 REST — 관리자만, 현황·작업 목록, 실행 결과 코드(202·404·409·503)."""
from __future__ import annotations

import httpx
import pytest

from apps.stock_api.main import app
from apps.stock_api.services import admin_jobs, data_status
from shared.auth import get_current_user
from shared.models import User, UserRole


@pytest.fixture
async def api():
    state: dict = {}

    async def _user():
        return state["user"]

    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


ADMIN = User(id=1, nickname="관리자", role=UserRole.ADMIN, is_active=True)
FREE = User(id=2, nickname="일반", role=UserRole.FREE, is_active=True)


async def test_non_admin_forbidden(api):
    client, state = api
    state["user"] = FREE
    assert (await client.get("/api/v1/admin/market/status")).status_code == 403
    assert (await client.get("/api/v1/admin/market/jobs")).status_code == 403
    assert (await client.post("/api/v1/admin/market/jobs/canslim")).status_code == 403


async def test_status_and_jobs(api, monkeypatch):
    client, state = api
    state["user"] = ADMIN
    monkeypatch.setattr(data_status, "build_status", lambda: {"ref_date": "2026-10-16"})
    monkeypatch.setattr(admin_jobs, "overview", lambda: {"jobs": [], "history": []})
    assert (await client.get("/api/v1/admin/market/status")).json() == {"ref_date": "2026-10-16"}
    assert (await client.get("/api/v1/admin/market/jobs")).json() == {"jobs": [], "history": []}


async def test_run_job_status_codes(api, monkeypatch):
    client, state = api
    state["user"] = ADMIN
    calls = []

    def ok(job, actor):
        calls.append((job, actor))
        return {"task_id": "t1", "requested_at": "2026-10-16T12:00:00+00:00"}

    monkeypatch.setattr(admin_jobs, "run", ok)
    r = await client.post("/api/v1/admin/market/jobs/canslim")
    assert r.status_code == 202 and r.json()["task_id"] == "t1"
    assert calls == [("canslim", "관리자")]

    def unknown(job, actor):
        raise admin_jobs.UnknownJob(job)

    monkeypatch.setattr(admin_jobs, "run", unknown)
    r = await client.post("/api/v1/admin/market/jobs/nope")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "JOB_NOT_FOUND"

    def running(job, actor):
        raise admin_jobs.JobRunning({"task_id": "t0", "actor": "다른 관리자", "requested_at": "2026-10-16T11:59:00+00:00"})

    monkeypatch.setattr(admin_jobs, "run", running)
    r = await client.post("/api/v1/admin/market/jobs/canslim")
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "JOB_RUNNING", "message": "이미 실행 중이에요", "task_id": "t0",
                                  "actor": "다른 관리자", "requested_at": "2026-10-16T11:59:00+00:00"}

    def down(job, actor):
        raise admin_jobs.QueueUnavailable("broker down")

    monkeypatch.setattr(admin_jobs, "run", down)
    r = await client.post("/api/v1/admin/market/jobs/canslim")
    assert r.status_code == 503 and r.json()["detail"]["code"] == "QUEUE_UNAVAILABLE"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_market_admin_api.py -q`
Expected: FAIL — status·jobs 경로가 404 라 단언이 실패한다

- [ ] **Step 3: 구현** — `backend/apps/stock_api/routers/market_admin.py`

```python
"""관리자 시장 데이터 REST — 데이터 현황, 계산 수동 실행(관리자 JWT 만). 서비스는 동기라 스레드풀에서 돈다."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from apps.stock_api.services import admin_jobs, data_status
from shared.auth import require_admin
from shared.models import User

router = APIRouter(prefix="/api/v1/admin/market", tags=["market-admin"])


@router.get("/status")
async def market_status(_admin: User = Depends(require_admin)):
    return await run_in_threadpool(data_status.build_status)


@router.get("/jobs")
async def list_jobs(_admin: User = Depends(require_admin)):
    return await run_in_threadpool(admin_jobs.overview)


@router.post("/jobs/{job}", status_code=status.HTTP_202_ACCEPTED)
async def run_job(job: str, admin: User = Depends(require_admin)):
    actor = admin.nickname or admin.email or f"#{admin.id}"
    try:
        return await run_in_threadpool(admin_jobs.run, job, actor)
    except admin_jobs.UnknownJob:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "JOB_NOT_FOUND", "message": "없는 작업입니다."})
    except admin_jobs.JobRunning as e:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "JOB_RUNNING", "message": "이미 실행 중이에요", "task_id": e.info.get("task_id"),
            "actor": e.info.get("actor"), "requested_at": e.info.get("requested_at")})
    except admin_jobs.QueueUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail={
            "code": "QUEUE_UNAVAILABLE", "message": "작업 큐에 연결할 수 없어요. 잠시 뒤 다시 시도하세요."})
```

`backend/apps/stock_api/main.py`
- import 줄 `from apps.stock_api.routers import themes_admin` 을 `from apps.stock_api.routers import market_admin, themes_admin` 로 바꾼다.
- `app.include_router(themes_admin.router)` 아래에 추가한다.

```python

# 관리자 시장 데이터(관리자 JWT) — 데이터 현황, KIS 를 호출하지 않는 계산 수동 실행
app.include_router(market_admin.router)
```

- [ ] **Step 4: 통과 확인 + 백엔드 전체 회귀**

Run: `cd backend && conda run -n stock_app uv run pytest -q`
Expected: 전체 passed(기존 1,098개 + 신규), failed 0

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/stock_api/routers/market_admin.py backend/apps/stock_api/main.py backend/tests/test_market_admin_api.py
git commit -m "feat(stock_api): 관리자 시장 라우터 — /admin/market/status·jobs·jobs/{job}(202·404·409·503)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: 관리자 웹 — API 클라이언트·타입·도우미

**Files:**
- Modify: `admin_web/src/api/client.ts`
- Create: `admin_web/src/types/marketAdmin.ts`
- Create: `admin_web/src/api/marketAdmin.ts`
- Create: `admin_web/src/lib/apiError.ts`
- Create: `admin_web/src/lib/marketFormat.ts`

- [ ] **Step 1: `client.ts` 수정**
  - import 를 `import { API_BASE_URL as BLOG_BASE_URL, AUTH_BASE_URL, GAME_API_URL, STOCK_API_URL } from '../config'` 로 바꾼다.
  - `gameClient` 정의 아래에 다음을 추가한다.

```ts
// stock_api REST(관리자 테마 보정·데이터 현황) — GraphQL 엔드포인트에서 /graphql 을 뗀 주소
export const stockAdminClient = makeClient(STOCK_API_URL.replace(/\/graphql\/?$/, ''))
```

- [ ] **Step 2: 타입** — `admin_web/src/types/marketAdmin.ts`

```ts
// 관리자 시장 데이터 응답 타입 — backend/apps/stock_api/routers/{themes_admin,market_admin}.py

export interface AdminTheme {
  id: number
  kis_code: string | null
  name: string
  source: 'kis' | 'admin'
  is_hidden: boolean
  description: string | null
  stock_count: number
}

export interface ThemeMetric {
  rank: number
  chg_1d: number | null // %
  value: number // 거래대금(원)
  members: number
  leader_ticker: string
  leader_name: string | null
}

export interface ThemeMetrics {
  as_of: string | null
  themes: Record<string, ThemeMetric> // 키: 테마 id 문자열
}

export interface ThemeStockRow {
  ticker: string
  source: 'kis' | 'admin'
  is_excluded: boolean
  reason: string | null
  name: string | null
  chg_1d: number | null
  value: number | null
}

export type DatasetStatus = 'ok' | 'stale' | 'warn' | 'empty' | 'off' | 'error'

export interface DatasetItem {
  code: string
  name?: string
  latest: string | null
  status: DatasetStatus
}

export interface Dataset {
  key: string
  label: string
  latest: string | null
  count: number | null
  unit: string
  status: DatasetStatus
  note: string
  items?: DatasetItem[]
}

export interface PipelineStep {
  name: string
  ok: boolean
  seconds: number
  summary: string
}

export interface PipelineRecord {
  started_at: string
  finished_at: string
  steps: PipelineStep[]
}

export interface MarketStatusReport {
  ref_date: string | null
  generated_at: string
  datasets: Dataset[]
  settings: { fred_key: boolean; q_cumulative: 'true' | 'false' | 'unset' }
  pipeline: PipelineRecord | null
}

export type JobStatus = 'idle' | 'queued' | 'running'

export interface AdminJob {
  key: string
  label: string
  description: string
  eta: string
  status: JobStatus
  task_id: string | null
  requested_at: string | null
}

export interface JobRun {
  job: string
  label: string
  task_id: string
  actor: string | null
  requested_at: string | null
  state: string // Celery 상태 | UNKNOWN(결과 만료)
  result_summary: string | null
}

export interface JobsOverview {
  jobs: AdminJob[]
  history: JobRun[]
}
```

- [ ] **Step 3: API 함수** — `admin_web/src/api/marketAdmin.ts`

```ts
import { stockAdminClient as http } from './client'
import type {
  AdminTheme,
  JobsOverview,
  MarketStatusReport,
  ThemeMetrics,
  ThemeStockRow,
} from '../types/marketAdmin'

// stock_api 관리자 REST(관리자 JWT). 보정(생성·수정·추가·제외) 뒤 테마 순위 재계산은 서버가 맡는다.
const THEMES = '/api/v1/admin/themes'
const MARKET = '/api/v1/admin/market'

export const listThemes = async (): Promise<AdminTheme[]> => (await http.get<AdminTheme[]>(THEMES)).data

export const getThemeMetrics = async (): Promise<ThemeMetrics> =>
  (await http.get<ThemeMetrics>(`${THEMES}/metrics`)).data

export const createTheme = async (name: string, description: string | null): Promise<AdminTheme> =>
  (await http.post<AdminTheme>(THEMES, { name, description })).data

export const updateTheme = async (
  id: number,
  changes: Partial<Pick<AdminTheme, 'name' | 'description' | 'is_hidden'>>,
): Promise<AdminTheme> => (await http.patch<AdminTheme>(`${THEMES}/${id}`, changes)).data

export const listThemeStocks = async (id: number): Promise<ThemeStockRow[]> =>
  (await http.get<ThemeStockRow[]>(`${THEMES}/${id}/stocks`)).data

export const addThemeStock = async (id: number, ticker: string, reason: string | null): Promise<void> => {
  await http.post(`${THEMES}/${id}/stocks`, { ticker, reason })
}

export const excludeThemeStock = async (id: number, ticker: string): Promise<void> => {
  await http.delete(`${THEMES}/${id}/stocks/${encodeURIComponent(ticker)}`)
}

export const getMarketStatus = async (): Promise<MarketStatusReport> =>
  (await http.get<MarketStatusReport>(`${MARKET}/status`)).data

export const getJobs = async (): Promise<JobsOverview> => (await http.get<JobsOverview>(`${MARKET}/jobs`)).data

export const runJob = async (key: string): Promise<{ task_id: string; requested_at: string }> =>
  (await http.post<{ task_id: string; requested_at: string }>(`${MARKET}/jobs/${encodeURIComponent(key)}`)).data
```

- [ ] **Step 4: 도우미** — `admin_web/src/lib/apiError.ts`

```ts
import type { AxiosError } from 'axios'

// 서버 오류 → 화면 메시지. detail 형태: 문자열 | {code, message, ...} | 검증 오류 배열(422)

/** detail 이 객체({code, message, ...})면 그대로, 아니면 null */
export const apiErrorDetail = (caught: unknown): Record<string, unknown> | null => {
  const detail = (caught as AxiosError<{ detail?: unknown }>).response?.data?.detail
  return typeof detail === 'object' && detail !== null && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : null
}

export const apiErrorMessage = (caught: unknown, fallback = '서버에 연결할 수 없습니다.'): string => {
  const err = caught as AxiosError<{ detail?: unknown }>
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  const coded = apiErrorDetail(caught)
  if (coded && typeof coded.message === 'string') return coded.message
  if (Array.isArray(detail)) return '입력값을 확인하세요.'
  if (err.response) return `요청 실패 (HTTP ${err.response.status})`
  return fallback
}
```

`admin_web/src/lib/marketFormat.ts`

```ts
// 시장 숫자 표시 — 등락은 % 값(3.2 = +3.2%), 거래대금은 원. 한국식 색(상승 빨강·하락 파랑).

export const formatAmount = (won: number | null | undefined): string => {
  if (won == null) return '—'
  if (won >= 1e12) return `${(won / 1e12).toFixed(1)}조`
  if (won >= 1e8) return `${Math.round(won / 1e8).toLocaleString('ko-KR')}억`
  return `${Math.round(won).toLocaleString('ko-KR')}원`
}

export const formatPct = (v: number | null | undefined): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`

export const pctClass = (v: number | null | undefined): string =>
  v == null ? 'text-slate-400' : v > 0 ? 'text-red-600' : v < 0 ? 'text-blue-600' : 'text-slate-600'

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'

export const formatSeconds = (s: number): string =>
  s < 60 ? `${s.toFixed(1)}초` : `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`
```

- [ ] **Step 5: 타입 검사**

Run: `cd admin_web && npx tsc --noEmit`
Expected: 오류 없음(출력 없음)

- [ ] **Step 6: 커밋**

```bash
git add admin_web/src/api/client.ts admin_web/src/api/marketAdmin.ts admin_web/src/types/marketAdmin.ts admin_web/src/lib/apiError.ts admin_web/src/lib/marketFormat.ts
git commit -m "feat(admin_web): 관리자 시장 데이터 API 클라이언트·타입·표시 도우미

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 8: 관리자 웹 — 테마 보정 화면

**Files:**
- Create: `admin_web/src/components/market/ThemeList.tsx`
- Create: `admin_web/src/components/market/StockSearchAdd.tsx`
- Create: `admin_web/src/components/market/ThemeDetail.tsx`
- Create: `admin_web/src/pages/MarketThemes.tsx`

- [ ] **Step 1: 목록** — `admin_web/src/components/market/ThemeList.tsx`

```tsx
import { formatAmount, formatPct, pctClass } from '../../lib/marketFormat'
import type { AdminTheme, ThemeMetric } from '../../types/marketAdmin'

export type ThemeRow = AdminTheme & { metric: ThemeMetric | null }

interface Props {
  rows: ThemeRow[]
  loading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
}

export default function ThemeList({ rows, loading, selectedId, onSelect }: Props) {
  if (loading) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">불러오는 중…</p>
  }
  if (rows.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">조건에 맞는 테마가 없어요.</p>
  }
  return (
    <ul className="divide-y divide-slate-100 self-start overflow-hidden rounded-xl border border-slate-200 bg-white">
      {rows.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onSelect(t.id)}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 ${
              t.id === selectedId ? 'bg-indigo-50' : ''
            } ${t.is_hidden ? 'opacity-60' : ''}`}
          >
            <span className="w-8 shrink-0 text-center text-sm font-semibold text-slate-500">{t.metric?.rank ?? '—'}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-slate-800">{t.name}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    t.source === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {t.source === 'admin' ? '관리자' : 'KIS'}
                </span>
                {t.is_hidden && (
                  <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">숨김</span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {t.stock_count}종목 · 거래대금 {formatAmount(t.metric?.value)}
              </span>
            </span>
            <span className={`shrink-0 text-sm font-semibold ${pctClass(t.metric?.chg_1d)}`}>
              {formatPct(t.metric?.chg_1d)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: 종목 추가** — `admin_web/src/components/market/StockSearchAdd.tsx`

```tsx
import { useEffect, useState } from 'react'
import { searchStocks } from '../../api/stockClient'
import type { Stock } from '../../types/stock'

const DEBOUNCE_MS = 300
const MAX_RESULTS = 8

interface Props {
  disabled: boolean
  existing: string[] // 이미 포함된(제외 아님) 종목 코드
  onAdd: (ticker: string, reason: string | null) => Promise<boolean>
}

// 국내 종목만(테마는 국내 보통주 대상). 검색은 기존 GraphQL searchStocks 재사용.
export default function StockSearchAdd({ disabled, existing, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [picked, setPicked] = useState<Stock | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    const q = query.trim()
    if (picked || !q) {
      setResults([])
      return
    }
    let alive = true
    const timer = window.setTimeout(() => {
      searchStocks(q)
        .then((rows) => {
          if (alive) setResults(rows.filter((r) => r.country === 'KR').slice(0, MAX_RESULTS))
        })
        .catch(() => {
          if (alive) setResults([])
        })
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, picked])

  const submit = async () => {
    if (!picked) return
    if (await onAdd(picked.symbol, reason.trim() || null)) {
      setPicked(null)
      setQuery('')
      setReason('')
    }
  }

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="mb-2 text-sm font-semibold text-slate-700">종목 추가</p>
      {picked ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm">
            <b>{picked.name}</b> <span className="text-xs text-slate-400">{picked.symbol}</span>
          </span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="편입 사유(선택) — 예: HBM 장비 공급"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void submit()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              추가
            </button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="종목명 또는 코드 검색"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((r) => {
                const already = existing.includes(r.symbol)
                return (
                  <li key={r.symbol}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => {
                        setPicked(r)
                        setResults([])
                      }}
                      className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40"
                    >
                      <span>
                        {r.name} <span className="text-xs text-slate-400">{r.symbol}</span>
                      </span>
                      {already && <span className="text-xs text-slate-500">이미 포함</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 상세** — `admin_web/src/components/market/ThemeDetail.tsx`

```tsx
import { useCallback, useEffect, useState } from 'react'
import { addThemeStock, excludeThemeStock, listThemeStocks, updateTheme } from '../../api/marketAdmin'
import { apiErrorMessage } from '../../lib/apiError'
import { formatPct, pctClass } from '../../lib/marketFormat'
import { showToast } from '../../lib/toast'
import type { AdminTheme, ThemeStockRow } from '../../types/marketAdmin'
import StockSearchAdd from './StockSearchAdd'

export const THEME_SAVED_MESSAGE = '저장했어요. 테마 순위는 잠시 뒤 다시 계산돼요'

interface Props {
  theme: AdminTheme
  onChanged: () => void
  onClose: () => void
}

const chgKey = (s: ThemeStockRow): number => s.chg_1d ?? -1e9

export default function ThemeDetail({ theme, onChanged, onClose }: Props) {
  const [name, setName] = useState(theme.name)
  const [description, setDescription] = useState(theme.description ?? '')
  const [stocks, setStocks] = useState<ThemeStockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const loadStocks = useCallback(async () => {
    setLoading(true)
    try {
      setStocks(await listThemeStocks(theme.id))
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setLoading(false)
    }
  }, [theme.id])

  useEffect(() => {
    void loadStocks()
  }, [loadStocks])

  // 바꾸는 요청 공통 — 성공하면 안내·목록 새로고침, 실패하면 오류 토스트. 성공 여부를 돌려준다.
  const act = async (fn: () => Promise<unknown>, reloadStocks = false): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      showToast(THEME_SAVED_MESSAGE)
      onChanged()
      if (reloadStocks) await loadStocks()
      return true
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const dirty = name.trim() !== theme.name || (description.trim() || null) !== (theme.description ?? null)
  const save = () => {
    if (!name.trim()) {
      showToast('테마 이름을 입력하세요', { icon: '⚠️' })
      return
    }
    void act(() => updateTheme(theme.id, { name: name.trim(), description: description.trim() || null }))
  }
  const exclude = (s: ThemeStockRow) => {
    if (!window.confirm(`${s.name ?? s.ticker} 을(를) 이 테마에서 제외할까요?`)) return
    void act(() => excludeThemeStock(theme.id, s.ticker), true)
  }

  const included = stocks.filter((s) => !s.is_excluded)
  const sorted = [...stocks].sort(
    (a, b) => Number(a.is_excluded) - Number(b.is_excluded) || chgKey(b) - chgKey(a),
  )

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-400">
            {theme.source === 'admin' ? '관리자 테마' : `KIS 테마 ${theme.kis_code ?? ''}`}
          </p>
          <h2 className="text-lg font-bold text-slate-800">{theme.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
        >
          ✕
        </button>
      </div>

      <div className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="설명(선택) — 웹 테마 상세에 보여요"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={save}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            저장
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => updateTheme(theme.id, { is_hidden: !theme.is_hidden }))}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {theme.is_hidden ? '다시 보이기' : '숨기기'}
          </button>
        </div>
        {theme.is_hidden && (
          <p className="text-xs text-amber-600">숨긴 테마는 웹 스크리너 테마 순위·트리맵에 나오지 않아요.</p>
        )}
      </div>

      <StockSearchAdd
        disabled={busy}
        existing={included.map((s) => s.ticker)}
        onAdd={(ticker, reason) => act(() => addThemeStock(theme.id, ticker, reason), true)}
      />

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">구성 종목 {included.length}개</p>
        {loading ? (
          <p className="text-sm text-slate-500">불러오는 중…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                  <th className="py-2">종목</th>
                  <th>출처</th>
                  <th className="text-right">1일</th>
                  <th className="pl-3">편입 사유</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.ticker} className={`border-b border-slate-100 ${s.is_excluded ? 'opacity-50' : ''}`}>
                    <td className="py-2">
                      <span className="font-medium text-slate-800">{s.name ?? s.ticker}</span>{' '}
                      <span className="text-xs text-slate-400">{s.ticker}</span>
                    </td>
                    <td className="text-xs text-slate-500">{s.source === 'admin' ? '관리자' : 'KIS'}</td>
                    <td className={`text-right font-medium ${pctClass(s.chg_1d)}`}>{formatPct(s.chg_1d)}</td>
                    <td className="max-w-[200px] truncate pl-3 text-xs text-slate-500" title={s.reason ?? ''}>
                      {s.reason ?? '—'}
                    </td>
                    <td className="text-right">
                      {s.is_excluded ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(() => addThemeStock(theme.id, s.ticker, null), true)}
                          className="text-xs font-semibold text-indigo-600 disabled:opacity-40"
                        >
                          복구
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => exclude(s)}
                          className="text-xs font-semibold text-red-500 disabled:opacity-40"
                        >
                          제외
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: 화면** — `admin_web/src/pages/MarketThemes.tsx`

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTheme, getThemeMetrics, listThemes } from '../api/marketAdmin'
import ThemeDetail, { THEME_SAVED_MESSAGE } from '../components/market/ThemeDetail'
import ThemeList, { type ThemeRow } from '../components/market/ThemeList'
import { apiErrorMessage } from '../lib/apiError'
import { showToast } from '../lib/toast'
import type { AdminTheme, ThemeMetrics } from '../types/marketAdmin'

type SortKey = 'rank' | 'chg_1d' | 'value' | 'stock_count' | 'name'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rank', label: '순위' },
  { key: 'chg_1d', label: '1일 등락' },
  { key: 'value', label: '거래대금' },
  { key: 'stock_count', label: '종목 수' },
  { key: 'name', label: '이름' },
]
const EMPTY_METRICS: ThemeMetrics = { as_of: null, themes: {} }
const NARROW = 1024 // 이 폭 미만이면 상세가 목록 아래에 열린다 → 스크롤해 보여준다

// 지표 없는 테마(숨김·종목 3개 미만)는 지표 정렬에서 항상 뒤로
const compare =
  (key: SortKey) =>
  (a: ThemeRow, b: ThemeRow): number => {
    if (key === 'name') return a.name.localeCompare(b.name, 'ko')
    if (key === 'stock_count') return b.stock_count - a.stock_count
    const av = a.metric?.[key] ?? null
    const bv = b.metric?.[key] ?? null
    if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1
    return key === 'rank' ? av - bv : bv - av
  }

export default function MarketThemes() {
  const [themes, setThemes] = useState<AdminTheme[]>([])
  const [metrics, setMetrics] = useState<ThemeMetrics>(EMPTY_METRICS)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('rank')
  const [showHidden, setShowHidden] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [list, m] = await Promise.all([listThemes(), getThemeMetrics().catch(() => EMPTY_METRICS)])
      setThemes(list)
      setMetrics(m)
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (selectedId != null && window.innerWidth < NARROW) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selectedId])

  const rows = useMemo<ThemeRow[]>(() => {
    const q = query.trim().toLowerCase()
    return themes
      .filter((t) => showHidden || !t.is_hidden)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .map((t) => ({ ...t, metric: metrics.themes[String(t.id)] ?? null }))
      .sort(compare(sort))
  }, [themes, metrics, query, sort, showHidden])

  const selected = themes.find((t) => t.id === selectedId) ?? null

  const create = async () => {
    if (!newName.trim()) {
      showToast('테마 이름을 입력하세요', { icon: '⚠️' })
      return
    }
    setCreating(true)
    try {
      const t = await createTheme(newName.trim(), newDesc.trim() || null)
      setNewName('')
      setNewDesc('')
      showToast(THEME_SAVED_MESSAGE)
      await load()
      setSelectedId(t.id)
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">테마 보정</h1>
        <p className="mt-1 text-sm text-slate-500">
          KIS 테마를 숨기거나 이름을 고치고, 종목을 추가·제외해요. 바꾼 내용은 웹 스크리너 테마 탭에 반영돼요.
          {metrics.as_of && ` · 지표 기준일 ${metrics.as_of}`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="테마 검색"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-56"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}순
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> 숨긴 테마 보기
        </label>
      </div>

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">＋ 새 테마 만들기</summary>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="테마 이름"
            maxLength={100}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-48"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="설명(선택)"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={creating}
            onClick={() => void create()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            만들기
          </button>
        </div>
      </details>

      <div className={`grid gap-4 ${selected ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}`}>
        <ThemeList rows={rows} loading={loading} selectedId={selectedId} onSelect={setSelectedId} />
        {selected && (
          <div ref={detailRef} className="scroll-mt-4">
            <ThemeDetail
              key={selected.id}
              theme={selected}
              onChanged={() => void load()}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: 타입 검사**

Run: `cd admin_web && npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add admin_web/src/components/market/ThemeList.tsx admin_web/src/components/market/StockSearchAdd.tsx admin_web/src/components/market/ThemeDetail.tsx admin_web/src/pages/MarketThemes.tsx
git commit -m "feat(admin_web): 테마 보정 화면 — 시장 지표 목록·정렬·숨김, 이름·설명 수정, 종목 검색 추가·제외·복구

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 9: 관리자 웹 — 데이터 현황 + 수동 실행 화면

**Files:**
- Create: `admin_web/src/components/market/DatasetCard.tsx`
- Create: `admin_web/src/components/market/PipelineCard.tsx`
- Create: `admin_web/src/components/market/JobsPanel.tsx`
- Create: `admin_web/src/pages/MarketStatus.tsx`

- [ ] **Step 1: 데이터 카드** — `admin_web/src/components/market/DatasetCard.tsx`

```tsx
import { useState } from 'react'
import type { Dataset, DatasetStatus } from '../../types/marketAdmin'

const BADGE: Record<DatasetStatus, { label: string; className: string }> = {
  ok: { label: '정상', className: 'bg-emerald-100 text-emerald-700' },
  stale: { label: '오래됨', className: 'bg-red-100 text-red-700' },
  warn: { label: '주의', className: 'bg-amber-100 text-amber-700' },
  empty: { label: '없음', className: 'bg-slate-200 text-slate-600' },
  off: { label: '꺼짐', className: 'bg-slate-100 text-slate-500' },
  error: { label: '오류', className: 'bg-red-600 text-white' },
}

function StatusBadge({ status }: { status: DatasetStatus }) {
  const b = BADGE[status]
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${b.className}`}>{b.label}</span>
}

export default function DatasetCard({ data }: { data: Dataset }) {
  const [open, setOpen] = useState(false)
  const count = data.count != null ? `${data.count.toLocaleString('ko-KR')}${data.unit}` : ''
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">{data.label}</p>
        <StatusBadge status={data.status} />
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-800">{data.latest ?? '—'}</p>
      <p className="text-xs text-slate-500">{[count, data.note].filter(Boolean).join(' · ')}</p>
      {data.items && data.items.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-xs font-semibold text-indigo-600">
            {open ? '접기' : `코드별 보기(${data.items.length})`}
          </button>
          {open && (
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">
              {data.items.map((i) => (
                <li key={i.code} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-600">
                    {i.name ? `${i.name} ` : ''}
                    <span className="text-slate-400">{i.code}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-slate-500">{i.latest ?? '—'}</span>
                    <StatusBadge status={i.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 파이프라인 카드** — `admin_web/src/components/market/PipelineCard.tsx`

```tsx
import { useState } from 'react'
import { formatDateTime, formatSeconds } from '../../lib/marketFormat'
import type { PipelineRecord } from '../../types/marketAdmin'

const STEP_LABEL: Record<string, string> = {
  daily: '전종목 일봉',
  indices_kr: '국내 지수',
  investor: '투자자 순매수',
  canslim: 'CANSLIM',
  market_groups: '시장 그룹',
}

export default function PipelineCard({ record }: { record: PipelineRecord | null }) {
  const [openStep, setOpenStep] = useState<string | null>(null)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-800">
        최근 일일 파이프라인 <span className="font-normal text-slate-400">(매일 20:30)</span>
      </p>
      {!record ? (
        <p className="mt-2 text-sm text-slate-500">기록이 없어요. 이 기능 배포 뒤 첫 20:30 실행부터 남아요.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTime(record.started_at)} 시작 · {formatDateTime(record.finished_at)} 끝
          </p>
          <ul className="mt-3 space-y-1">
            {record.steps.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => setOpenStep(openStep === s.name ? null : s.name)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  <span>
                    {s.ok ? '✅' : '❌'} {STEP_LABEL[s.name] ?? s.name}
                  </span>
                  <span className="text-xs text-slate-500">{formatSeconds(s.seconds)}</span>
                </button>
                {openStep === s.name && (
                  <pre className="mx-2 mb-1 whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                    {s.summary}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 수동 실행 패널** — `admin_web/src/components/market/JobsPanel.tsx`

```tsx
import { useCallback, useEffect, useState } from 'react'
import { getJobs, runJob } from '../../api/marketAdmin'
import { apiErrorDetail, apiErrorMessage } from '../../lib/apiError'
import { formatDateTime } from '../../lib/marketFormat'
import { showToast } from '../../lib/toast'
import type { AdminJob, JobStatus, JobsOverview } from '../../types/marketAdmin'

const POLL_MS = 5000
const JOB_STATUS: Record<JobStatus, string> = { idle: '실행', queued: '대기 중', running: '실행 중' }
const RUN_STATE: Record<string, string> = {
  PENDING: '대기 중',
  RECEIVED: '대기 중',
  STARTED: '실행 중',
  RETRY: '재시도 중',
  SUCCESS: '완료',
  FAILURE: '실패',
  REVOKED: '취소됨',
  UNKNOWN: '결과 만료',
}
const stateClass = (s: string): string =>
  s === 'FAILURE' ? 'text-red-600' : s === 'SUCCESS' ? 'text-emerald-600' : 'text-slate-500'

export default function JobsPanel() {
  const [data, setData] = useState<JobsOverview | null>(null)
  const [sending, setSending] = useState<string | null>(null)

  // 폴링 중 오류는 조용히(5초마다 토스트가 쌓이지 않게)
  const load = useCallback(async (silent = false) => {
    try {
      setData(await getJobs())
    } catch (e) {
      if (!silent) showToast(apiErrorMessage(e), { icon: '⚠️' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const active = data?.jobs.some((j) => j.status !== 'idle') ?? false
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void load(true), POLL_MS)
    return () => window.clearInterval(timer)
  }, [active, load])

  const run = async (job: AdminJob) => {
    if (!window.confirm(`${job.label}을(를) 실행할까요?\n예상 시간: ${job.eta} · KIS 호출 없음`)) return
    setSending(job.key)
    try {
      await runJob(job.key)
      showToast(`${job.label} 실행을 요청했어요`)
    } catch (e) {
      const d = apiErrorDetail(e)
      if (d?.code === 'JOB_RUNNING') {
        showToast(`이미 실행 중이에요(${formatDateTime(d.requested_at as string | null)} 시작)`, { icon: '⏳' })
      } else {
        showToast(apiErrorMessage(e), { icon: '⚠️' })
      }
    } finally {
      setSending(null)
      await load()
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-slate-800">계산 수동 실행</h2>
        <p className="text-sm text-slate-500">
          KIS 를 호출하지 않는 계산만 실행할 수 있어요. 같은 작업은 한 번에 하나만 돌아요. 수집 작업은 다음 단계에서 추가돼요.
        </p>
      </div>
      {!data ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.jobs.map((job) => (
              <div key={job.key} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{job.label}</p>
                    {job.status !== 'idle' && (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {JOB_STATUS[job.status]}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{job.description}</p>
                  <p className="mt-1 text-xs text-slate-400">예상 {job.eta} · KIS 호출 없음</p>
                </div>
                <button
                  type="button"
                  disabled={job.status !== 'idle' || sending === job.key}
                  onClick={() => void run(job)}
                  className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {JOB_STATUS[job.status]}
                </button>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                  <th className="px-4 py-2">요청 시각</th>
                  <th>작업</th>
                  <th>실행자</th>
                  <th>상태</th>
                  <th className="pr-4">결과</th>
                </tr>
              </thead>
              <tbody>
                {data.history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-center text-slate-400">
                      실행 기록이 없어요
                    </td>
                  </tr>
                ) : (
                  data.history.map((h) => (
                    <tr key={h.task_id} className="border-b border-slate-100">
                      <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(h.requested_at)}</td>
                      <td>{h.label}</td>
                      <td className="text-xs">{h.actor ?? '—'}</td>
                      <td className={`text-xs font-semibold ${stateClass(h.state)}`}>{RUN_STATE[h.state] ?? h.state}</td>
                      <td className="max-w-[240px] truncate pr-4 text-xs text-slate-500" title={h.result_summary ?? ''}>
                        {h.result_summary ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: 화면** — `admin_web/src/pages/MarketStatus.tsx`

```tsx
import { useCallback, useEffect, useState } from 'react'
import { getMarketStatus } from '../api/marketAdmin'
import DatasetCard from '../components/market/DatasetCard'
import JobsPanel from '../components/market/JobsPanel'
import PipelineCard from '../components/market/PipelineCard'
import { apiErrorMessage } from '../lib/apiError'
import { formatDateTime } from '../lib/marketFormat'
import { showToast } from '../lib/toast'
import type { MarketStatusReport } from '../types/marketAdmin'

const Q_LABEL: Record<MarketStatusReport['settings']['q_cumulative'], string> = {
  true: '누적(연초부터)',
  false: '단독 분기',
  unset: '미설정 — CANSLIM C 는 준비 중으로 표시',
}

export default function MarketStatus() {
  const [data, setData] = useState<MarketStatusReport | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await getMarketStatus())
    } catch (e) {
      showToast(apiErrorMessage(e), { icon: '⚠️' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">데이터 현황</h1>
          <p className="mt-1 text-sm text-slate-500">
            기준 거래일 {data?.ref_date ?? '—'} · 지연은 이 날짜와 비교해요
            {data && ` · ${formatDateTime(data.generated_at)} 조회`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.datasets.map((d) => (
              <DatasetCard key={d.key} data={d} />
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <PipelineCard record={data.pipeline} />
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-800">설정 상태</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">FRED API 키</dt>
                  <dd className={data.settings.fred_key ? 'text-emerald-600' : 'text-red-600'}>
                    {data.settings.fred_key ? '설정됨' : '없음'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">분기 EPS 형식</dt>
                  <dd className="text-right">{Q_LABEL[data.settings.q_cumulative]}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-slate-400">
                서버 환경 변수에서 읽어요(값 자체는 보여주지 않아요). 분기 EPS 형식은 다음 단계에서 이 화면에서 바꿀 수 있게 돼요.
              </p>
            </div>
          </div>
        </>
      )}

      <JobsPanel />
    </div>
  )
}
```

- [ ] **Step 5: 타입 검사**

Run: `cd admin_web && npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add admin_web/src/components/market/DatasetCard.tsx admin_web/src/components/market/PipelineCard.tsx admin_web/src/components/market/JobsPanel.tsx admin_web/src/pages/MarketStatus.tsx
git commit -m "feat(admin_web): 데이터 현황 화면 — 데이터별 상태 카드·코드별 최신일·설정 상태·일일 파이프라인·계산 수동 실행

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 10: 메뉴·라우트 연결, 문서, 브라우저 확인

**Files:**
- Modify: `admin_web/src/App.tsx`
- Modify: `admin_web/src/components/Sidebar.tsx`
- Modify: `README.md` (관리자 웹 기능 목록 위치)

- [ ] **Step 1: 라우트** — `admin_web/src/App.tsx`
  - import 에 다음을 추가한다.

```tsx
import MarketThemes from './pages/MarketThemes'
import MarketStatus from './pages/MarketStatus'
```

- `<Route path="game/quizzes" .../>` 아래에 다음을 추가한다.

```tsx
        <Route path="market/themes" element={<MarketThemes />} />
        <Route path="market/status" element={<MarketStatus />} />
```

- [ ] **Step 2: 메뉴** — `admin_web/src/components/Sidebar.tsx`
  - `NAV_GROUPS` 의 '트레이딩 게임' 그룹 뒤에 다음 그룹을 추가한다.

```tsx
  {
    title: '시장 데이터',
    items: [
      { to: '/market/themes', label: '테마 보정', icon: '🏷️' },
      { to: '/market/status', label: '데이터 현황', icon: '🩺' },
    ],
  },
```

- [ ] **Step 3: 빌드 검사**

Run: `cd admin_web && npx tsc --noEmit && npx vite build --mode development`
Expected: 타입 오류가 없고, 빌드 끝에 `✓ built in`. 운영 모드 빌드는 VITE_* env 검사로 막히므로 development 모드로 확인한다.

- [ ] **Step 4: README 갱신**
  - `README.md` 에서 관리자 웹(admin_web) 기능을 설명하는 부분을 찾는다(`grep -n "admin_web\|관리자 웹" README.md`).
  - 그 목록에 다음 항목을 추가한다.

```markdown
- **시장 데이터 › 테마 보정**(`/market/themes`): KIS 테마 숨김·이름·설명 수정, 관리자 테마 생성, 종목 검색 추가·제외. 최신 순위·1일 등락·거래대금을 함께 표시하고, 저장하면 서버가 테마 순위를 다시 계산한다.
- **시장 데이터 › 데이터 현황**(`/market/status`): 일봉·지수·투자자·재무·FRED·공모주·CANSLIM·시장 그룹의 최신일과 상태(기준 거래일 비교), 설정 상태(값은 표시 안 함), 최근 일일 파이프라인 단계별 결과.
  KIS 를 호출하지 않는 계산 4개(CANSLIM·시장 그룹 계산과 각 60일 백필)는 버튼으로 실행한다. 같은 작업은 동시에 하나만 돈다(Redis 잠금).
  API: stock_api `GET /api/v1/admin/market/status`, `GET·POST /api/v1/admin/market/jobs[/{job}]`(관리자 JWT).
```

- [ ] **Step 5: 브라우저 확인(데스크톱 + 모바일 390px)**
  - 로컬 서버를 띄운다. 개발 DB 터널은 `scripts/dev-db-tunnel.sh` 이고, Redis 는 로컬을 쓴다.
    - `cd backend && conda run -n stock_app uv run uvicorn apps.stock_api.main:app --port 8002`
    - auth 8001, `cd admin_web && npm run dev`
  - 관리자로 로그인해 다음을 확인한다.
    - 테마 보정: 목록에 지표가 보이는지, 정렬·검색·숨긴 테마 토글, 상세 열기. 저장·추가·제외는 개발 DB 에 쓰므로 실행하지 않고 버튼 상태만 본다.
    - 데이터 현황: 카드 9개, 코드별 펼치기, 설정 카드, 파이프라인 카드("기록이 없어요" 정상), 작업 4개 카드와 기록 표
    - 수동 실행: 로컬 Redis 에 워커가 없으면 "대기 중"으로 남는 것이 정상이다. 실행 버튼은 누르지 않는다.
  - 모바일 폭(390px)에서 확인한다. 가로 스크롤이 생기지 않는지, 표는 카드 안에서만 스크롤되는지, 테마를 고르면 상세 위치로 스크롤되는지 본다.
  - 콘솔 오류 0개(`read_console_messages`)

- [ ] **Step 6: 백엔드 전체 테스트 재확인 후 커밋**

Run: `cd backend && conda run -n stock_app uv run pytest -q`
Expected: failed 0

```bash
git add admin_web/src/App.tsx admin_web/src/components/Sidebar.tsx README.md
git commit -m "feat(admin_web): 사이드바 '시장 데이터' 메뉴(테마 보정·데이터 현황) + README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```
