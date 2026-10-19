# 시장 데이터 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스크리너 데이터가 맞는지 두 가지로 확인한다.
1. 관리자 웹 "데이터 검증" 화면: 종목 하나의 우리 값과 외부 사이트 링크를 한 곳에 모은다.
2. 표본 점검 CLI: 무작위 N 종목을 KRX(pykrx)와 비교하고, 내부 계산값이 원천과 맞는지 검사해 보고서와 종료 코드를 남긴다.

**Architecture:**
- **collector `apps/collector/verify/`(CLI 전용, 운영 이미지에서 실행하지 않음):**
  - `checks.py` 는 판정 순수 함수다.
  - `spot_check.py` 는 CH·PG·pykrx 를 읽어 `checks` 에 넘기고, 마크다운 보고서를 쓴다.
  - pykrx 는 외부 조회 함수 안에서만 import 한다(`uv run --with pykrx`). pyproject 에 넣지 않는다.
- **stock_api:**
  - `services/verify_ticker.py` 는 종목 하나의 섹션별 값을 모은다. 섹션마다 실패를 격리한다.
  - 기존 `routers/market_admin.py` 에 `GET /verify` 를 추가한다.
- **admin_web:** `/market/verify` 화면(검색·기준일·카드)을 만들고 사이드바 '시장 데이터' 그룹에 메뉴를 추가한다.

**Tech Stack:** FastAPI, ClickHouse(clickhouse-connect), SQLAlchemy(sync), pytest(가짜 CH — SQL 문자열 라우팅), pykrx(로컬 전용), React 18 + Vite + Tailwind + axios + react-router-dom 6.

**Spec:** `docs/superpowers/specs/2026-10-19-market-data-verification-design.md`

**규칙(모든 태스크 공통)**
- **백엔드 테스트:** `cd backend && uv run pytest <경로> -p no:cacheprovider`
  - conda 환경(stock_app)이 없으므로 conda 를 쓰지 않는다.
  - pyproject `addopts` 에 이미 `-q` 가 있으므로 `-q` 를 붙이지 않는다.
- **관리자 웹 검사:** `cd admin_web && npx tsc --noEmit`. `npm install` 은 하지 않는다.
- **커밋:**
  - dev 브랜치에 커밋한다. `git add` 는 경로를 하나씩 지정한다(`-A`·`.` 금지).
  - 메시지 끝에 정확히 다음 두 줄을 붙인다.
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
    ```
  - 테스트에 failed 가 하나라도 있으면 커밋하지 않는다.
- **금지:**
  - env 파일을 수정하거나 값을 출력하지 않는다.
  - 실제 KIS 를 호출하지 않는다.
  - 셸에서 `rm -rf`·`sleep` 을 쓰지 않는다(스크립트 안의 파이썬 `time.sleep` 은 괜찮고, 주입 가능하게 만든다).
  - `npm install` 을 하지 않는다.
- **커밋하지 않는 파일:** `.claude/`, `.serena/project.yml`, `*.tsbuildinfo`, 실행해서 만든 `spot_check_*.md` 보고서

**참고한 코드(근거)**
- 일봉 DDL `backend/shared/clickhouse_schema.py:30-54`
  - `daily_prices(ticker, date, open, high, low, close, volume UInt64, …)`, ReplacingMergeTree, `ORDER BY (ticker, date)`
- 투자자 `backend/apps/collector/repositories/clickhouse_market.py:30-46`
  - `investor_daily(prsn_qty, frgn_qty, orgn_qty, prsn_amt, frgn_amt, orgn_amt)`
  - 금액은 KIS `*_ntby_tr_pbmn` 원값이다(`market_parsers.py:61-63`). 단위는 확인되지 않아 변환하지 않는다.
- 재무 `clickhouse_market.py:48-66`
  - `fundamentals_periodic(ticker, period 'Q'|'Y', stac_yymm, eps, bps, sps, roe, sales_growth, op_growth, ni_growth, debt_ratio)`
- CANSLIM `backend/apps/collector/repositories/clickhouse_canslim.py:23-62`
  - 판정 값 `PASS, FAIL, NA, PENDING = 1, 0, -1, -2`(`canslim/rules.py:10`)
- 시장 그룹 `backend/apps/collector/repositories/clickhouse_market_groups.py:17-61`
  - `market_stock_daily`, `market_group_daily(members=0 은 tombstone)`
  - 일봉 창 `load_bars(days=45)`(같은 파일 74-83)
- 그룹 집계 규칙 `backend/apps/collector/market_groups/compute.py`
  - `_chg` 18-21, `_mean` 35-37, `aggregate` 40-61(중복 제거·거래정지 제외·구성 0 은 행 없음), `compute_day` 64-91(업종 = sector_m 코드, 일봉이 기준일에 있는 종목만)
- PG 도우미 `backend/shared/market_repo.py`
  - `group_profile_map` 104-108, `theme_groups` 111-122(숨김 테마·제외 종목 뺌)
- 기존 관례
  - `services/data_status.py`: `_ch`/`_query` 37-43, `_missing_table` 185-188, `_safe` 191-198
  - `tests/test_data_status.py`: `_CH` 19-31
  - `tests/test_market_admin_api.py`: `api` 픽스처 13-23
- `shared/__init__.py:7-9` 가 `load_env()` 로 `backend/.env.{APP_ENV}` 를 자동 로드한다. 그래서 CLI 도 env 를 수정하지 않고 터널 포트로 붙는다.
- Python 3.12(`backend/pyproject.toml:6`)에서는 `date.fromisoformat("20261016")` 도 통과한다. 그래서 날짜는 정규식으로 먼저 형식을 확인한다.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `backend/apps/collector/verify/__init__.py` (신규) | 패키지 표시(빈 docstring) |
| `backend/apps/collector/verify/checks.py` (신규) | 판정 순수 함수: KRX 비교 분류, 종가·1일 등락, 그룹 평균 재현·drift, 이름 중복, 종료 코드 |
| `backend/apps/collector/verify/spot_check.py` (신규) | CH·PG·pykrx 읽기, 표본 추출, 보고서, CLI `main` |
| `backend/tests/test_verify_checks.py` (신규) | checks 테스트 |
| `backend/tests/test_spot_check.py` (신규) | spot_check 테스트(가짜 CH·PG·KRX, 네트워크 없음) |
| `backend/apps/stock_api/services/verify_ticker.py` (신규) | 종목 하나의 섹션별 값 모음 + 외부 링크 |
| `backend/tests/test_verify_ticker.py` (신규) | 서비스 테스트 |
| `backend/apps/stock_api/routers/market_admin.py` (수정) | `GET /api/v1/admin/market/verify` |
| `backend/tests/test_market_admin_api.py` (수정) | 라우터 테스트 2개 추가 |
| `admin_web/src/types/marketAdmin.ts` (수정) | `VerifyReport` 등 타입 추가 |
| `admin_web/src/api/marketAdmin.ts` (수정) | `getVerify` 추가 |
| `admin_web/src/lib/marketFormat.ts` (수정) | `formatNum` 추가 |
| `admin_web/src/components/market/VerifyStockPicker.tsx` (신규) | 국내 종목 검색(300ms 디바운스, 6자리 코드 + Enter) |
| `admin_web/src/components/market/VerifyCards.tsx` (신규) | 카드 틀 + 기본 정보·계산값·투자자·CANSLIM·링크 카드 |
| `admin_web/src/components/market/VerifyTables.tsx` (신규) | 일봉·재무·소속 그룹 표 카드 |
| `admin_web/src/pages/MarketVerify.tsx` (신규) | 화면(주소 쿼리 `?ticker=&date=`) |
| `admin_web/src/App.tsx`, `components/Sidebar.tsx` (수정) | 라우트·메뉴 |
| `README.md` (수정) | 화면 안내 + 표본 점검 실행법(터널 + `uv run --with pykrx`) |

---

### Task 1: 표본 점검 판정 순수 함수

**Files:**
- Create: `backend/apps/collector/verify/__init__.py`
- Create: `backend/apps/collector/verify/checks.py`
- Test: `backend/tests/test_verify_checks.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_verify_checks.py`

```python
"""표본 점검 판정(순수) — KRX 비교 분류, 종가·1일 등락 재계산, 그룹 평균 재현·drift, 이름 중복, 종료 코드."""
from __future__ import annotations

import pytest

from apps.collector.verify import checks as ck
from apps.collector.verify.checks import Bar

KRX = Bar(100, 110, 95, 105, 1000)


def test_judge_exact_when_volume_and_prices_equal():
    assert ck.judge_bar(Bar(100, 110, 95, 105, 1000), KRX) == (ck.EXACT, [])


def test_judge_consistent_un_superset():
    # 통합(UN) 시세: 시가·종가는 달라도 되고 고가≥·저가≤·거래량≥ 이면 정상
    assert ck.judge_bar(Bar(99, 112, 94, 104, 1500), KRX) == (ck.CONSISTENT, [])


@pytest.mark.parametrize("ours, word", [
    (Bar(100, 109, 95, 105, 1500), "고가"),
    (Bar(100, 110, 96, 105, 1500), "저가"),
    (Bar(100, 110, 95, 105, 900), "거래량"),
])
def test_judge_violation_reasons(ours, word):
    status, reasons = ck.judge_bar(ours, KRX)
    assert status == ck.VIOLATION and len(reasons) == 1 and reasons[0].startswith(word)


def test_judge_equal_volume_requires_equal_prices():
    # 거래량이 같다 = 넥스트레이드 미상장 → OHLC 도 KRX 와 같아야 한다
    assert ck.judge_bar(Bar(100, 110, 95, 104, 1000), KRX) == (ck.VIOLATION, ["종가 104 ≠ KRX 105"])


def test_judge_missing():
    assert ck.judge_bar(KRX, None) == (ck.MISSING, [])
    assert ck.judge_bar(KRX, Bar(0, 0, 0, 0, 0)) == (ck.MISSING, [])


def test_reason_numbers_are_readable():
    _, reasons = ck.judge_bar(Bar(1_000_000, 1_000_000, 1, 1, 5), Bar(1, 1_200_000, 1, 1, 9))
    assert reasons == ["고가 1,000,000 < KRX 1,200,000", "거래량 5 < KRX 9"]


def test_check_stock_rows():
    rows = {
        "A": {"close": 110.0, "chg_1d": 10.0},        # 정상
        "B": {"close": 51.0, "chg_1d": 0.0},          # (a) 종가 다름
        "C": {"close": 30.0, "chg_1d": 5.0},          # (b) 직전 봉 없음 → None 이어야
        "D": {"close": 20.0, "chg_1d": None},         # 직전 봉 없음 + None → 정상
        "E": {"close": 9.0, "chg_1d": None},          # 그날 일봉 없음
        "F": {"close": 100.0, "chg_1d": 25.0000001},  # 허용 오차 안
        "G": {"close": 10.0, "chg_1d": None},         # 직전 종가 0 → None
    }
    closes = {"A": 110.0, "B": 50.0, "C": 30.0, "D": 20.0, "F": 100.0, "G": 10.0}
    prev = {"A": 100.0, "B": 50.0, "F": 80.0, "G": 0.0}
    out = ck.check_stock_rows(rows, closes, prev)
    assert [(m["check"], m["ticker"]) for m in out] == [("close", "B"), ("chg_1d", "C"), ("close", "E")]
    assert out[0] == {"check": "close", "ticker": "B", "ours": 51.0, "expected": 50.0}
    assert out[1]["expected"] is None and out[2]["expected"] is None


def _stocks():
    return {
        "A": {"chg_1d": 10.0, "sector_m": "0013"},
        "B": {"chg_1d": -20.0, "sector_m": "0013"},
        "C": {"chg_1d": None, "sector_m": "0013"},   # 구성 수엔 들어가고 평균에선 빠진다
        "H": {"chg_1d": 50.0, "sector_m": "0013"},   # 거래정지
        "X": {"chg_1d": 1.0, "sector_m": ""},         # 업종 없음
    }


def test_expected_groups_mirrors_aggregate():
    themes = {"7": ("반도체", ["A", "A", "B", "ZZ", "H"]), "9": ("빈", ["ZZ"]), "10": ("정지만", ["H"])}
    exp = ck.expected_groups(_stocks(), themes, halted={"H"})
    assert exp[("theme", "7")] == {"members": 2, "chg_1d": pytest.approx(-5.0)}
    assert exp[("sector", "0013")] == {"members": 3, "chg_1d": pytest.approx(-5.0)}
    assert ("theme", "9") not in exp and ("theme", "10") not in exp
    assert set(exp) == {("theme", "7"), ("sector", "0013")}


def test_check_groups_mismatch_vs_drift():
    exp = {("sector", "0013"): {"members": 3, "chg_1d": -5.0}, ("theme", "7"): {"members": 2, "chg_1d": -5.0},
           ("theme", "11"): {"members": 5, "chg_1d": 1.0}, ("theme", "12"): {"members": 1, "chg_1d": None}}
    rows = [
        {"kind": "sector", "group_id": "0013", "name": "전기·전자", "members": 3, "chg_1d": -5.0000000001},  # 정상
        {"kind": "theme", "group_id": "7", "name": "반도체", "members": 2, "chg_1d": 1.0},     # 불일치
        {"kind": "theme", "group_id": "8", "name": "사라짐", "members": 4, "chg_1d": 1.0},     # 재현 없음 → drift
        {"kind": "theme", "group_id": "11", "name": "바뀜", "members": 4, "chg_1d": 1.0},      # 구성 수 다름 → drift
        {"kind": "theme", "group_id": "12", "name": "값 없음", "members": 1, "chg_1d": None},  # None == None 정상
    ]
    mism, drift = ck.check_groups(rows, exp)
    assert [(m["group_id"], m["ours"], m["expected"]) for m in mism] == [("7", 1.0, -5.0)]
    assert [(d["group_id"], d["members"], d["expected_members"]) for d in drift] == [("8", 4, 0), ("11", 4, 5)]


def test_duplicate_names_same_kind_only():
    rows = [{"kind": "sector", "group_id": "0151", "name": "의료·정밀기기"},
            {"kind": "sector", "group_id": "0021", "name": "의료·정밀기기"},
            {"kind": "theme", "group_id": "3", "name": "의료·정밀기기"},
            {"kind": "theme", "group_id": "4", "name": "반도체"}]
    assert ck.duplicate_names(rows) == [{"kind": "sector", "name": "의료·정밀기기", "group_ids": ["0021", "0151"]}]


def _result(external=(), **internal):
    base = {"stock_mismatches": [], "group_mismatches": [], "group_drifts": [], "duplicates": []}
    return {"external": [{"status": s} for s in external], "internal": base | internal}


def test_exit_code():
    assert ck.exit_code(_result([ck.EXACT, ck.CONSISTENT, ck.MISSING, ck.ERROR],
                                group_drifts=[{}], duplicates=[{}])) == 0   # 경고만
    assert ck.exit_code(_result([ck.VIOLATION])) == 1
    assert ck.exit_code(_result(stock_mismatches=[{}])) == 1
    assert ck.exit_code(_result(group_mismatches=[{}])) == 1
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_verify_checks.py -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.collector.verify'`

- [ ] **Step 3: 구현** — `backend/apps/collector/verify/__init__.py`

```python
"""시장 데이터 검증 도구(로컬 CLI 전용) — 표본 점검(spot_check)과 판정 함수(checks)."""
```

`backend/apps/collector/verify/checks.py`

```python
"""시장 데이터 표본 점검 — 판정 순수 함수(I/O 없음). spot_check 가 CH·PG·pykrx 에서 읽어 넘긴다.

외부 비교(KRX 단독, pykrx): 우리 일봉은 KRX+넥스트레이드 통합(UN) 시세다.
  고가 ≥ KRX 고가, 저가 ≤ KRX 저가, 거래량 ≥ KRX 거래량 이면 정상이다.
  거래량이 같으면(넥스트레이드 미상장) 시가·고가·저가·종가도 모두 같아야 한다.
내부 비교: market_stock_daily ↔ daily_prices, 그룹 1일 평균 ↔ 구성 종목 평균.
  그룹 규칙은 market_groups/compute.py(aggregate·compute_day)와 같다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

EXACT, CONSISTENT, VIOLATION, MISSING, ERROR = "exact", "consistent", "violation", "missing", "error"
REL_TOL = 1e-6
ABS_TOL = 1e-6
_PRICE_LABELS = {"open": "시가", "high": "고가", "low": "저가", "close": "종가"}


@dataclass(frozen=True)
class Bar:
    open: float
    high: float
    low: float
    close: float
    volume: int


def _n(v) -> str:
    """보고서용 숫자 — 정수면 천 단위 쉼표, 아니면 소수 둘째 자리."""
    return f"{v:,.0f}" if float(v).is_integer() else f"{v:,.2f}"


def judge_bar(ours: Bar, krx: Bar | None) -> tuple[str, list[str]]:
    """(분류, 위반 사유). KRX 행이 없거나 거래량 0 이면 비교할 수 없다(missing)."""
    if krx is None or krx.volume == 0:
        return MISSING, []
    if ours.volume == krx.volume:
        diffs = [f"{label} {_n(getattr(ours, k))} ≠ KRX {_n(getattr(krx, k))}"
                 for k, label in _PRICE_LABELS.items() if getattr(ours, k) != getattr(krx, k)]
        return (VIOLATION, diffs) if diffs else (EXACT, [])
    reasons = []
    if ours.high < krx.high:
        reasons.append(f"고가 {_n(ours.high)} < KRX {_n(krx.high)}")
    if ours.low > krx.low:
        reasons.append(f"저가 {_n(ours.low)} > KRX {_n(krx.low)}")
    if ours.volume < krx.volume:
        reasons.append(f"거래량 {_n(ours.volume)} < KRX {_n(krx.volume)}")
    return (VIOLATION, reasons) if reasons else (CONSISTENT, [])


def _same(a: float | None, b: float | None) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=ABS_TOL)


def expected_chg_1d(close: float, prev_close: float | None) -> float | None:
    """compute._chg(n=1) 와 같은 식 — 직전 봉이 없거나 0 이면 None."""
    if not prev_close:
        return None
    return close / prev_close * 100 - 100


def check_stock_rows(stock_rows: dict[str, dict], closes: dict[str, float],
                     prev_closes: dict[str, float]) -> list[dict]:
    """(a) 종가 (b) 1일 등락. stock_rows: {ticker: {close, chg_1d}}(market_stock_daily).

    closes: 그날 daily_prices 종가, prev_closes: 그 종목의 직전 봉 종가.
    불일치 항목: {"check": "close"|"chg_1d", "ticker", "ours", "expected"}.
    """
    out = []
    for t in sorted(stock_rows):
        row = stock_rows[t]
        close = closes.get(t)
        if close is None:
            out.append({"check": "close", "ticker": t, "ours": row["close"], "expected": None})
            continue
        if not _same(row["close"], close):
            out.append({"check": "close", "ticker": t, "ours": row["close"], "expected": close})
        exp = expected_chg_1d(close, prev_closes.get(t))
        if not _same(row["chg_1d"], exp):
            out.append({"check": "chg_1d", "ticker": t, "ours": row["chg_1d"], "expected": exp})
    return out


def _mean(values: list[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def expected_groups(stock_rows: dict[str, dict], themes: dict[str, tuple[str, list[str]]],
                    halted: set[str]) -> dict[tuple[str, str], dict]:
    """compute_day·aggregate 와 같은 규칙으로 {(kind, group_id): {members, chg_1d}} 를 다시 만든다.

    구성 = 그날 market_stock_daily 에 있는 종목 중 거래정지 아닌 것(중복 티커는 한 번).
    업종은 sector_m 코드로, 테마는 market_repo.theme_groups 형태로 묶는다. 구성 0 그룹은 넣지 않는다.
    """
    sectors: dict[str, list[str]] = {}
    for t, row in stock_rows.items():
        if row.get("sector_m"):
            sectors.setdefault(row["sector_m"], []).append(t)
    out: dict[tuple[str, str], dict] = {}
    for kind, groups in (("theme", {gid: ts for gid, (_name, ts) in themes.items()}), ("sector", sectors)):
        for gid, tickers in groups.items():
            members = [t for t in dict.fromkeys(tickers) if t in stock_rows and t not in halted]
            if members:
                out[(kind, gid)] = {"members": len(members),
                                    "chg_1d": _mean([stock_rows[t]["chg_1d"] for t in members])}
    return out


def check_groups(rows: list[dict], expected: dict[tuple[str, str], dict]) -> tuple[list[dict], list[dict]]:
    """(c) rows: market_group_daily(members > 0) [{kind, group_id, name, members, chg_1d}] → (불일치, drift).

    테마 소속·거래정지는 현재 PG 값이라 과거 날짜는 계산 당시와 다를 수 있다.
    → 구성 수가 다르거나 재현한 그룹이 없으면 drift(경고)로 두고, 같을 때만 평균을 비교한다.
    """
    mismatches, drifts = [], []
    for r in rows:
        exp = expected.get((r["kind"], r["group_id"]))
        base = {"kind": r["kind"], "group_id": r["group_id"], "name": r["name"], "members": r["members"]}
        if exp is None or exp["members"] != r["members"]:
            drifts.append(base | {"expected_members": exp["members"] if exp else 0})
        elif not _same(r["chg_1d"], exp["chg_1d"]):
            mismatches.append(base | {"ours": r["chg_1d"], "expected": exp["chg_1d"]})
    return mismatches, drifts


def duplicate_names(rows: list[dict]) -> list[dict]:
    """(d) 같은 날·같은 kind 에서 이름이 겹치는 그룹(예: 업종 '의료·정밀기기' 2개) — 경고만, 고치지 않는다."""
    seen: dict[tuple[str, str], list[str]] = {}
    for r in rows:
        seen.setdefault((r["kind"], r["name"]), []).append(r["group_id"])
    return [{"kind": k, "name": n, "group_ids": sorted(ids)} for (k, n), ids in sorted(seen.items()) if len(ids) > 1]


def exit_code(result: dict) -> int:
    """외부 위반이나 내부 불일치(a·b·c)가 하나라도 있으면 1. drift·이름 중복·missing·error 는 경고(0)."""
    internal = result.get("internal") or {}
    bad = any(e["status"] == VIOLATION for e in result["external"])
    return 1 if bad or internal.get("stock_mismatches") or internal.get("group_mismatches") else 0
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_verify_checks.py -p no:cacheprovider`
Expected: `13 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/collector/verify/__init__.py backend/apps/collector/verify/checks.py backend/tests/test_verify_checks.py
git commit -m "feat(collector): 표본 점검 판정 순수 함수 — KRX 비교 분류·종가/등락·그룹 평균 재현·이름 중복

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 표본 점검 CLI — 외부 비교·내부 검사 연결, 보고서, 종료 코드

**Files:**
- Create: `backend/apps/collector/verify/spot_check.py`
- Test: `backend/tests/test_spot_check.py`

**결정 사항**
- **표본:** 그날 daily_prices 종목을 **정렬한 뒤** `random.Random(seed).sample` 로 뽑는다. `SELECT DISTINCT` 는 순서가 정해져 있지 않아, 정렬하지 않으면 같은 seed 라도 다른 종목이 나온다.
  - pykrx 가 빈 값을 주는 종목(그날 KRX 거래 없음 등)은 `missing` 으로 분류된다(위반 아님). ETF 도 pykrx 가 값을 준다(069500 확인).
- **pykrx 실측(2026-10-16, 005930):**
  - 컬럼은 `['시가', '고가', '저가', '종가', '거래량', '등락률']` 이고, 값은 int 다.
  - "KRX 로그인 실패: KRX_ID 또는 KRX_PW…" 경고와 numpy 2 경고가 출력되지만 OHLCV 는 정상으로 온다. KRX 계정은 설정하지 않는다.
- **직전 봉:** 그 종목의 기준일 이전 마지막 행이다(`argMax(close, date)`, 45일 창). 시장 직전 거래일이 아니다. 거래정지 종목의 직전 봉은 며칠 전일 수 있다.
- **조회 방식:** CH 조회는 테이블 하나씩 단순하게 한다. 결합은 파이썬에서 한다. 테스트의 가짜 CH 가 SQL 문자열로 라우팅하므로, JOIN 을 쓰면 라우팅이 모호해진다.
- **pykrx 컬럼 매핑:** `bar_from_krx_rows` 한 곳에만 둔다. 컬럼은 `시가·고가·저가·종가·거래량`, 날짜는 `YYYYMMDD` 문자열이다. 테스트는 DataFrame 없이 dict 로 한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_spot_check.py`

```python
"""표본 점검 CLI — 표본 재현성, 외부 비교 연결(대기 주입·오류 격리), 내부 검사 연결, 보고서·종료 코드(가짜 CH·PG·KRX)."""
from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from apps.collector.verify import checks
from apps.collector.verify import spot_check as sc
from apps.collector.verify.checks import Bar
from shared.clickhouse_schema import CLICKHOUSE_DB as DB

D = date(2026, 10, 16)
TICKERS = ["000001", "000002", "000003", "000004", "000005"]
MISSING = RuntimeError("Code: 60. DB::Exception: Unknown table expression identifier "
                       "'stock_data.x' in scope SELECT ... (UNKNOWN_TABLE)")


class _CH:
    """SQL 에 들어 있는 문자열로 결과를 고른다(먼저 맞는 것). 값이 예외면 던진다. 보낸 쿼리를 기록한다."""

    def __init__(self, routes):
        self.routes, self.queries = routes, []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        for key, rows in self.routes:
            if key in sql:
                if isinstance(rows, Exception):
                    raise rows
                return SimpleNamespace(result_rows=rows)
        return SimpleNamespace(result_rows=[])


def _routes(**over):
    base = {
        "latest": (f"max(date) FROM {DB}.daily_prices", [[D]]),
        "universe": (f"DISTINCT ticker FROM {DB}.daily_prices", [[t] for t in reversed(TICKERS)]),
        "bars": (f"open, high, low, close, volume FROM {DB}.daily_prices", [
            ["000001", 100.0, 112.0, 99.0, 110.0, 2000],
            ["000002", 210.0, 215.0, 195.0, 200.0, 1000],
            ["000003", 50.0, 52.0, 49.0, 50.0, 800],
            ["000004", 30.0, 31.0, 29.0, 30.0, 300],
            ["000005", 10.0, 10.0, 10.0, 10.0, 0]]),
        "prev": (f"argMax(close, date) FROM {DB}.daily_prices",
                 [["000001", 100.0], ["000002", 250.0], ["000003", 50.0], ["000005", 10.0]]),
        "close": (f"ticker, close FROM {DB}.daily_prices",
                  [["000001", 110.0], ["000002", 200.0], ["000003", 50.0], ["000004", 30.0], ["000005", 10.0]]),
        "stocks": (f"FROM {DB}.market_stock_daily", [
            ["000001", 110.0, 10.0, "0013"],
            ["000002", 200.0, -20.0, "0013"],
            ["000003", 51.0, 0.0, "0013"],    # (a) 종가 불일치(일봉 50)
            ["000004", 30.0, 5.0, "0021"],    # (b) 직전 봉 없음인데 값이 있음
            ["000005", 10.0, 0.0, ""]]),      # 거래정지
        "groups": (f"FROM {DB}.market_group_daily", [
            ["sector", "0013", "전기·전자", 3, -10.0 / 3],
            ["sector", "0021", "의료·정밀기기", 1, 5.0],
            ["sector", "0099", "의료·정밀기기", 2, 1.0],   # 재현 없음 → drift + 이름 중복
            ["theme", "7", "반도체", 2, 0.0],              # 평균 -5.0 → 불일치
            ["theme", "8", "작은", 2, 5.0]]),              # 정지 종목 빼고 (10+0)/2 → 정상
    }
    base.update(over)
    return list(base.values())


THEMES = {"7": ("반도체", ["000001", "000002"]), "8": ("작은", ["000001", "000003", "000005"])}
KRX = {"000001": Bar(100, 111, 99, 110, 1500),   # consistent
       "000002": Bar(210, 215, 195, 200, 1000),  # exact
       "000003": Bar(50, 53, 49, 50, 700),       # violation(고가 52 < 53)
       "000005": None}                           # missing


def _fetch(ticker, d):
    assert d == D
    if ticker == "000004":
        raise RuntimeError("KRX 응답 없음")
    return KRX[ticker]


@pytest.fixture
def env(monkeypatch):
    holder = {"ch": _CH(_routes())}
    monkeypatch.setattr(sc, "_ch", lambda: holder["ch"])
    monkeypatch.setattr(sc, "_theme_groups", lambda: THEMES)
    monkeypatch.setattr(sc, "_halted", lambda: {"000005"})

    def use(**over):
        holder["ch"] = _CH(_routes(**over))
        return holder["ch"]

    return SimpleNamespace(use=use, holder=holder)


def test_sample_is_sorted_and_reproducible(env):
    a = sc.sample_tickers(D, 3, seed=42)
    assert a == sc.sample_tickers(D, 3, seed=42) == sorted(a)
    assert len(a) == 3 and set(a) <= set(TICKERS)
    assert sc.sample_tickers(D, 99, seed=1) == TICKERS  # 종목 수보다 많이 달라면 전부


def test_external_check_classifies_and_throttles(env):
    waits = []
    out = sc.external_check(D, TICKERS, fetch=_fetch, pause=waits.append, throttle=0.3)
    assert [(e["ticker"], e["status"]) for e in out] == [
        ("000001", checks.CONSISTENT), ("000002", checks.EXACT), ("000003", checks.VIOLATION),
        ("000004", checks.ERROR), ("000005", checks.MISSING)]
    assert waits == [0.3] * 4  # 종목 사이에만 쉰다
    assert "KRX 응답 없음" in out[3]["reasons"][0]
    assert out[2]["ours"] == {"open": 50.0, "high": 52.0, "low": 49.0, "close": 50.0, "volume": 800}
    assert out[2]["krx"]["high"] == 53 and out[4]["krx"] is None


def test_bar_from_krx_rows_maps_korean_columns():
    row = {"시가": 100, "고가": 110, "저가": 95, "종가": 105, "거래량": 1000, "등락률": 1.2}
    assert sc.bar_from_krx_rows([row]) == Bar(100.0, 110.0, 95.0, 105.0, 1000)
    assert sc.bar_from_krx_rows([]) is None


def test_internal_checks(env):
    out = sc.internal_checks(D)
    assert out["stocks_checked"] == 5 and out["groups_checked"] == 5
    assert [(m["check"], m["ticker"]) for m in out["stock_mismatches"]] == [("close", "000003"), ("chg_1d", "000004")]
    assert [m["group_id"] for m in out["group_mismatches"]] == ["7"]
    assert [d["group_id"] for d in out["group_drifts"]] == ["0099"]
    assert out["duplicates"] == [{"kind": "sector", "name": "의료·정밀기기", "group_ids": ["0021", "0099"]}]
    assert out["notes"] == []


def test_internal_queries_use_final_and_market_groups_window(env):
    sc.internal_checks(D)
    queries = env.holder["ch"].queries
    sql, params = next(q for q in queries if "argMax(close, date)" in q[0])
    assert "FINAL" in sql and params == {"d": D, "since": D - timedelta(days=45)}
    group_sql = next(s for s, _ in queries if "market_group_daily" in s)
    assert "FINAL" in group_sql and "members > 0" in group_sql


def test_internal_theme_failure_checks_sectors_only(env, monkeypatch):
    def boom():
        raise RuntimeError("pg down")

    monkeypatch.setattr(sc, "_theme_groups", boom)
    out = sc.internal_checks(D)
    assert out["groups_checked"] == 3 and out["group_mismatches"] == []
    assert [d["group_id"] for d in out["group_drifts"]] == ["0099"]
    assert any("테마" in n for n in out["notes"])


def test_internal_halted_failure_skips_group_means(env, monkeypatch):
    def boom():
        raise RuntimeError("pg down")

    monkeypatch.setattr(sc, "_halted", boom)
    out = sc.internal_checks(D)
    assert out["groups_checked"] == 0 and out["group_mismatches"] == [] and out["group_drifts"] == []
    assert len(out["duplicates"]) == 1 and len(out["stock_mismatches"]) == 2
    assert any("거래정지" in n for n in out["notes"])


def test_internal_missing_tables_are_notes(env):
    env.use(stocks=(f"FROM {DB}.market_stock_daily", MISSING))
    out = sc.internal_checks(D)
    assert out["stocks_checked"] == 0 and "market_stock_daily" in out["notes"][0]
    env.use(groups=(f"FROM {DB}.market_group_daily", MISSING))
    out = sc.internal_checks(D)
    assert out["stocks_checked"] == 5 and out["groups_checked"] == 0
    assert any("market_group_daily" in n for n in out["notes"])


def test_main_writes_report_and_fails_on_violation(env, tmp_path, capsys):
    out = tmp_path / "r.md"
    waits = []
    code = sc.main(["--n", "5", "--seed", "7", "--out", str(out)], fetch=_fetch, pause=waits.append)
    assert code == 1 and len(waits) == 4
    text = out.read_text(encoding="utf-8")
    assert text.startswith("# 시장 데이터 표본 점검 — 2026-10-16")
    assert "seed 7" in text and "## 외부 위반" in text and "고가 52 < KRX 53" in text
    assert "## KRX 조회 오류" in text and "## 내부 불일치 — 종목" in text and "## 내부 불일치 — 그룹" in text
    assert "## 구성 변경 추정(경고)" in text and "## 이름 중복(경고)" in text and "0021, 0099" in text
    printed = capsys.readouterr().out
    assert "위반 1" in printed and str(out) in printed


def test_main_clean_run_exits_zero_with_warnings_only(env, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sc, "internal_checks", lambda d: {
        "stocks_checked": 5, "stock_mismatches": [], "groups_checked": 2, "group_mismatches": [],
        "group_drifts": [{"kind": "theme", "group_id": "8", "name": "작은", "members": 2, "expected_members": 3}],
        "duplicates": [{"kind": "sector", "name": "의료·정밀기기", "group_ids": ["0021", "0099"]}], "notes": []})
    code = sc.main(["--n", "5", "--date", "2026-10-16"],
                   fetch=lambda t, d: sc.our_bars(d, [t])[t], pause=lambda s: None)
    assert code == 0
    report = tmp_path / "spot_check_2026-10-16.md"  # 기본 경로 = 현재 디렉터리
    assert report.exists() and "seed " in report.read_text(encoding="utf-8")
    assert "seed " in capsys.readouterr().out       # seed 를 안 줘도 만들어 남긴다


def test_main_no_daily_data_exits_2(env, tmp_path):
    env.use(latest=(f"max(date) FROM {DB}.daily_prices", [[date(1970, 1, 1)]]))
    assert sc.main(["--out", str(tmp_path / "x.md")], fetch=_fetch, pause=lambda s: None) == 2
    assert not (tmp_path / "x.md").exists()
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_spot_check.py -p no:cacheprovider`
Expected: FAIL — `ImportError: cannot import name 'spot_check' from 'apps.collector.verify'`

- [ ] **Step 3: 구현** — `backend/apps/collector/verify/spot_check.py`

```python
"""시장 데이터 표본 점검 CLI — 외부(KRX 단독, pykrx) 비교 + 내부 일관성 검사 → 마크다운 보고서.

실행(로컬, 개발 DB 터널 scripts/dev-db-tunnel.sh 필요):
    cd backend && uv run --with pykrx python -m apps.collector.verify.spot_check --n 30 [--date YYYY-MM-DD] [--seed S] [--out PATH]

- pykrx 는 운영 의존성이 아니다(pyproject 에 없음) → krx_bar 안에서만 import 한다.
- 읽기 전용. KIS 는 호출하지 않는다.
- 종료 코드: 외부 위반·내부 불일치가 있으면 1, 경고(구성 변경 추정·이름 중복·KRX 없음·조회 오류)만 있으면 0,
  일봉이 아예 없으면 2.
"""
from __future__ import annotations

import argparse
import logging
import random
import sys
import time
from collections import Counter
from dataclasses import asdict
from datetime import date, timedelta
from pathlib import Path
from typing import Callable

from apps.collector.verify import checks
from apps.collector.verify.checks import Bar
from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB as DB
from shared.clickhouse_schema import get_client
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)

_EPOCH = date(1970, 1, 1)
BARS_LOOKBACK_DAYS = 45  # clickhouse_market_groups.load_bars(days=45) 와 같은 창
THROTTLE_SECONDS = 0.3   # KRX 호출 간격
MAX_ROWS = 50            # 보고서 표 하나의 최대 행
_LABEL = {checks.EXACT: "일치", checks.CONSISTENT: "통합 정상", checks.VIOLATION: "위반",
          checks.MISSING: "KRX 없음", checks.ERROR: "오류"}


# ---------------------------------------------------------------- 저장소 접근(테스트에서 바꿔 끼운다)
def _ch():
    return get_client()


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def _theme_groups() -> dict[str, tuple[str, list[str]]]:
    with SyncSessionLocal() as db:
        return market_repo.theme_groups(db)


def _halted() -> set[str]:
    with SyncSessionLocal() as db:
        return {t for t, (_m, _s, _k, halted) in market_repo.group_profile_map(db).items() if halted}


def _missing_table(exc: Exception) -> bool:
    """CH 테이블이 아직 없음(Code 60 UNKNOWN_TABLE) — stock_api data_status 와 같은 판정."""
    msg = str(exc)
    return "UNKNOWN_TABLE" in msg or "Code: 60." in msg


# ---------------------------------------------------------------- 외부(KRX 단독)
def bar_from_krx_rows(rows: list[dict]) -> Bar | None:
    """pykrx 행(한글 컬럼) → Bar. 행이 없으면 None. 컬럼 매핑은 여기 한 곳에만 둔다."""
    if not rows:
        return None
    r = rows[0]
    return Bar(float(r["시가"]), float(r["고가"]), float(r["저가"]), float(r["종가"]), int(r["거래량"]))


def krx_bar(ticker: str, d: date) -> Bar | None:
    """KRX 단독 일봉 1개(pykrx). 로그인 없이 되는 개별 종목 OHLCV 만 쓴다(지수·투자자는 KRX 로그인 필요로 제외).

    adjusted=True(수정주가) — 우리 일봉도 수정주가(FID_ORG_ADJ_PRC='0')라 과거 날짜도 같은 기준.
    """
    from pykrx import stock  # 지연 import — 운영 이미지·pyproject 에는 없다(uv run --with pykrx)

    ymd = d.strftime("%Y%m%d")
    df = stock.get_market_ohlcv(ymd, ymd, ticker, adjusted=True)
    return bar_from_krx_rows(df.to_dict("records"))


# ---------------------------------------------------------------- 우리 값
def latest_date() -> date | None:
    rows = _query(f"SELECT max(date) FROM {DB}.daily_prices")
    d = rows[0][0] if rows else None
    return None if d is None or d <= _EPOCH else d


def sample_tickers(d: date, n: int, seed: int | None) -> list[str]:
    """그날 일봉이 있는 종목 중 n 개. 정렬한 뒤 뽑아서 같은 seed 면 같은 표본이 나온다."""
    rows = _query(f"SELECT DISTINCT ticker FROM {DB}.daily_prices WHERE date = %(d)s", {"d": d})
    tickers = sorted(r[0] for r in rows)
    return sorted(random.Random(seed).sample(tickers, min(n, len(tickers))))


def our_bars(d: date, tickers: list[str]) -> dict[str, Bar]:
    if not tickers:
        return {}
    rows = _query(f"SELECT ticker, open, high, low, close, volume FROM {DB}.daily_prices FINAL "
                  "WHERE date = %(d)s AND ticker IN %(tickers)s", {"d": d, "tickers": list(tickers)})
    return {t: Bar(float(o), float(h), float(lo), float(c), int(v)) for t, o, h, lo, c, v in rows}


def _bar_dict(b: Bar | None) -> dict | None:
    return None if b is None else asdict(b)


def external_check(d: date, tickers: list[str], fetch: Callable[[str, date], Bar | None] = krx_bar,
                   pause: Callable[[float], None] = time.sleep, throttle: float = THROTTLE_SECONDS) -> list[dict]:
    """종목마다 KRX 와 비교. 종목 사이에 throttle 초 쉰다(pause 는 테스트에서 바꿔 끼운다)."""
    ours = our_bars(d, tickers)
    out = []
    for i, t in enumerate(tickers):
        if i and throttle:
            pause(throttle)
        mine = ours.get(t)
        try:
            krx = fetch(t, d)
        except Exception as exc:  # noqa: BLE001 — 한 종목 실패가 점검 전체를 막지 않게
            out.append({"ticker": t, "status": checks.ERROR, "reasons": [f"KRX 조회 실패: {exc}"[:200]],
                        "ours": _bar_dict(mine), "krx": None})
            continue
        if mine is None:
            status, reasons = checks.ERROR, ["우리 일봉 없음"]
        else:
            status, reasons = checks.judge_bar(mine, krx)
        out.append({"ticker": t, "status": status, "reasons": reasons, "ours": _bar_dict(mine),
                    "krx": _bar_dict(krx)})
    return out


# ---------------------------------------------------------------- 내부 일관성
def _stock_rows(d: date) -> dict[str, dict]:
    rows = _query(f"SELECT ticker, close, chg_1d, sector_m FROM {DB}.market_stock_daily FINAL "
                  "WHERE date = %(d)s", {"d": d})
    return {t: {"close": float(c), "chg_1d": None if chg is None else float(chg), "sector_m": s or ""}
            for t, c, chg, s in rows}


def _closes(d: date) -> dict[str, float]:
    rows = _query(f"SELECT ticker, close FROM {DB}.daily_prices FINAL WHERE date = %(d)s", {"d": d})
    return {t: float(c) for t, c in rows}


def _prev_closes(d: date) -> dict[str, float]:
    """종목별 기준일 이전 마지막 봉 종가(45일 창) — compute._chg 의 closes[-2] 와 같다."""
    rows = _query(f"SELECT ticker, argMax(close, date) FROM {DB}.daily_prices FINAL "
                  "WHERE date < %(d)s AND date > %(since)s GROUP BY ticker",
                  {"d": d, "since": d - timedelta(days=BARS_LOOKBACK_DAYS)})
    return {t: float(c) for t, c in rows}


def _group_rows(d: date) -> list[dict]:
    rows = _query(f"SELECT kind, group_id, name, members, chg_1d FROM {DB}.market_group_daily FINAL "
                  "WHERE date = %(d)s AND members > 0", {"d": d})
    return [{"kind": k, "group_id": g, "name": n, "members": int(m), "chg_1d": None if c is None else float(c)}
            for k, g, n, m, c in rows]


def internal_checks(d: date) -> dict:
    """(a) 종가 (b) 1일 등락 (c) 그룹 1일 평균 (d) 이름 중복. 테이블·PG 실패는 notes 에 적고 건너뛴다."""
    out = {"stocks_checked": 0, "stock_mismatches": [], "groups_checked": 0, "group_mismatches": [],
           "group_drifts": [], "duplicates": [], "notes": []}
    try:
        stocks = _stock_rows(d)
    except Exception as exc:
        if not _missing_table(exc):
            raise
        out["notes"].append("market_stock_daily 테이블이 없어요(시장 그룹 계산 전) — 내부 검사를 건너뛰었어요")
        return out
    if not stocks:
        out["notes"].append(f"{d} 의 market_stock_daily 행이 없어요(그날 시장 그룹 계산 전) — 내부 검사를 건너뛰었어요")
        return out
    out["stocks_checked"] = len(stocks)
    out["stock_mismatches"] = checks.check_stock_rows(stocks, _closes(d), _prev_closes(d))

    try:
        groups = _group_rows(d)
    except Exception as exc:
        if not _missing_table(exc):
            raise
        out["notes"].append("market_group_daily 테이블이 없어요 — 그룹 검사를 건너뛰었어요")
        return out
    out["duplicates"] = checks.duplicate_names(groups)
    try:
        halted = _halted()
    except Exception as exc:  # noqa: BLE001
        log.warning("거래정지 목록 조회 실패: %s", exc)
        out["notes"].append("PG 거래정지 목록을 읽지 못해 그룹 평균 검사를 건너뛰었어요")
        return out
    try:
        themes = _theme_groups()
    except Exception as exc:  # noqa: BLE001
        log.warning("테마 소속 조회 실패: %s", exc)
        out["notes"].append("PG 테마 소속을 읽지 못해 테마는 건너뛰고 업종만 검사했어요")
        themes = {}
        groups = [g for g in groups if g["kind"] == "sector"]
    expected = checks.expected_groups(stocks, themes, halted)
    out["groups_checked"] = len(groups)
    out["group_mismatches"], out["group_drifts"] = checks.check_groups(groups, expected)
    return out


# ---------------------------------------------------------------- 보고서
def _v(x) -> str:
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:.6f}".rstrip("0").rstrip(".")
    return str(x)


def _bar_text(b: dict | None) -> str:
    if not b:
        return "—"
    return f"{_v(b['open'])}/{_v(b['high'])}/{_v(b['low'])}/{_v(b['close'])} · {b['volume']:,}"


def counts(result: dict) -> dict:
    ext = Counter(e["status"] for e in result["external"])
    i = result["internal"]
    return {**{s: ext.get(s, 0) for s in _LABEL},
            "stocks_checked": i["stocks_checked"], "stock_mismatches": len(i["stock_mismatches"]),
            "groups_checked": i["groups_checked"], "group_mismatches": len(i["group_mismatches"]),
            "group_drifts": len(i["group_drifts"]), "duplicates": len(i["duplicates"])}


def format_summary(result: dict) -> str:
    c = counts(result)
    ext = " · ".join(f"{_LABEL[s]} {c[s]}" for s in _LABEL)
    return (f"[{result['date']}] 외부 {result['n']}종목(seed {result['seed']}): {ext}\n"
            f"내부: 종목 {c['stocks_checked']}개 중 불일치 {c['stock_mismatches']} · 그룹 {c['groups_checked']}개 중 "
            f"불일치 {c['group_mismatches']} · 구성 변경 추정 {c['group_drifts']} · 이름 중복 {c['duplicates']}")


def _table(title: str, header: list[str], rows: list[list]) -> list[str]:
    if not rows:
        return []
    out = ["", f"## {title}", "", "| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(_v(v) for v in r) + " |" for r in rows[:MAX_ROWS]]
    if len(rows) > MAX_ROWS:
        out += ["", f"… 외 {len(rows) - MAX_ROWS}건"]
    return out


def render_report(result: dict) -> str:
    c = counts(result)
    ext, i = result["external"], result["internal"]
    lines = [
        f"# 시장 데이터 표본 점검 — {result['date']}", "",
        f"- 표본 {result['n']}종목 · seed {result['seed']} (같은 seed 로 다시 돌리면 같은 종목)",
        "- 외부 기준은 KRX 단독(pykrx, 수정주가)이다. 우리 일봉은 KRX+넥스트레이드 통합 시세라 고가≥, 저가≤, 거래량≥ 가 정상이다.",
        "  거래량이 같으면(넥스트레이드 미상장) 시가·고가·저가·종가도 같아야 한다.",
        "- 그룹 평균 검사의 테마 소속·거래정지는 현재 PG 값이다. 구성 수가 다르면 '구성 변경 추정'(경고)으로 두고 평균은 비교하지 않는다.",
        "", "## 요약", "", "| 항목 | 수 |", "|---|---|",
        *[f"| 외부 {_LABEL[s]} | {c[s]} |" for s in _LABEL],
        f"| 내부 종목 검사 / 불일치 | {c['stocks_checked']} / {c['stock_mismatches']} |",
        f"| 내부 그룹 검사 / 불일치 | {c['groups_checked']} / {c['group_mismatches']} |",
        f"| 구성 변경 추정(경고) | {c['group_drifts']} |",
        f"| 이름 중복(경고) | {c['duplicates']} |",
    ]
    lines += _table("외부 위반", ["종목", "사유", "우리(시/고/저/종 · 거래량)", "KRX"],
                    [[e["ticker"], "; ".join(e["reasons"]), _bar_text(e["ours"]), _bar_text(e["krx"])]
                     for e in ext if e["status"] == checks.VIOLATION])
    lines += _table("KRX 조회 오류", ["종목", "내용"],
                    [[e["ticker"], "; ".join(e["reasons"])] for e in ext if e["status"] == checks.ERROR])
    lines += _table("내부 불일치 — 종목", ["검사", "종목", "우리 값", "기대 값"],
                    [[m["check"], m["ticker"], m["ours"], m["expected"]] for m in i["stock_mismatches"]])
    lines += _table("내부 불일치 — 그룹", ["종류", "id", "이름", "구성 수", "우리 1일 평균", "기대 값"],
                    [[m["kind"], m["group_id"], m["name"], m["members"], m["ours"], m["expected"]]
                     for m in i["group_mismatches"]])
    lines += _table("구성 변경 추정(경고)", ["종류", "id", "이름", "저장된 구성 수", "현재 기준 구성 수"],
                    [[d["kind"], d["group_id"], d["name"], d["members"], d["expected_members"]]
                     for d in i["group_drifts"]])
    lines += _table("이름 중복(경고)", ["종류", "이름", "group_id"],
                    [[d["kind"], d["name"], ", ".join(d["group_ids"])] for d in i["duplicates"]])
    if i["notes"]:
        lines += ["", "## 참고", "", *[f"- {n}" for n in i["notes"]]]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- CLI
def main(argv: list[str] | None = None, *, fetch: Callable[[str, date], Bar | None] | None = None,
         pause: Callable[[float], None] = time.sleep) -> int:
    p = argparse.ArgumentParser(prog="spot_check", description="시장 데이터 표본 점검(KRX 비교 + 내부 일관성)")
    p.add_argument("--n", type=int, default=30, help="외부 비교 표본 종목 수(기본 30)")
    p.add_argument("--date", type=date.fromisoformat, default=None, help="기준일 YYYY-MM-DD(기본: 일봉 최신일)")
    p.add_argument("--seed", type=int, default=None, help="표본 seed(없으면 만들어서 보고서에 남김)")
    p.add_argument("--out", type=Path, default=None, help="보고서 경로(기본: ./spot_check_<date>.md)")
    args = p.parse_args(argv)

    d = args.date or latest_date()
    if d is None:
        print("일봉 데이터가 없어요 — 점검할 수 없어요", file=sys.stderr)
        return 2
    seed = args.seed if args.seed is not None else random.randrange(1_000_000)
    tickers = sample_tickers(d, args.n, seed)
    result = {"date": d.isoformat(), "n": len(tickers), "seed": seed,
              "external": external_check(d, tickers, fetch=fetch or krx_bar, pause=pause),
              "internal": internal_checks(d)}
    out = args.out or Path.cwd() / f"spot_check_{d.isoformat()}.md"
    out.write_text(render_report(result), encoding="utf-8")
    print(format_summary(result))
    print(f"보고서: {out}")
    return checks.exit_code(result)


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    sys.exit(main())
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_spot_check.py tests/test_verify_checks.py -p no:cacheprovider`
Expected: `24 passed`

- [ ] **Step 5: pykrx 없이 import 되는지 확인(운영 이미지 안전)**

Run: `cd backend && uv run python -c "import apps.collector.verify.spot_check as m; print(m.THROTTLE_SECONDS)"`
Expected: `0.3`. pykrx 를 import 하지 않으므로 `ModuleNotFoundError` 가 나지 않아야 한다.

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/collector/verify/spot_check.py backend/tests/test_spot_check.py
git commit -m "feat(collector): 표본 점검 CLI — pykrx KRX 비교·내부 일관성 검사·마크다운 보고서·종료 코드

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: 데이터 검증 서비스(stock_api)

**Files:**
- Create: `backend/apps/stock_api/services/verify_ticker.py`
- Test: `backend/tests/test_verify_ticker.py`

**결정 사항**
- **날짜를 주지 않으면:** 전체 최신일이 아니라 **그 종목의** `max(date)` daily_prices 를 쓴다. 거래정지 종목도 마지막 거래일 값이 보인다.
- **404 조건:** stock_meta 에 없고 일봉도 없을 때다. 둘 다 조회에 성공한 경우만 404 이다. 조회가 실패하면 404 대신 섹션 note 로 알린다.
- **소속 테마:** `market_repo.theme_groups` 를 재사용해 파이썬에서 거른다. PG 조회 1번이고, 계산 태스크와 같은 기준(숨김·제외 뺌)이다.
- **market_group_daily 가 없을 때:** 소속 목록은 그대로 보여주고, 지표만 null 로 두고 note 를 단다.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_verify_ticker.py`

```python
"""관리자 데이터 검증 — 입력 검증·404, 날짜 결정, 응답 형태, 섹션 실패 격리, 테이블 없음, PG 실패, 링크(가짜 CH·PG)."""
from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from apps.stock_api.services import verify_ticker as vt
from shared.clickhouse_schema import CLICKHOUSE_DB as DB

D = date(2026, 10, 16)
T = "005930"
MISSING = RuntimeError("Code: 60. DB::Exception: Unknown table expression identifier "
                       "'stock_data.canslim_daily' in scope SELECT ... (UNKNOWN_TABLE)")
INFO = {"name": "삼성전자", "market": "KOSPI", "is_active": True, "sector_code": "0013",
        "sector_name": "전기·전자", "listed_shares_k": 5969783, "is_halted": False}
CANSLIM_ROW = [65, 4, 1, 1, 0, 1, -1, 1, 1, -2, 32.5, "202606", 0, 12.0, 9.1, -3.2, 72800.0, 1.3, 88, 1.21,
               3, 40, 1500000.0, 6, 3.0, 9e11]
FUND = ([["Q", ym, 1000.0, 50000.0, None, 9.0, None, None, None, 26.0]
         for ym in ("202606", "202603", "202512", "202509", "202506", "202503", "202412", "202409", "202406")]
        + [["Y", f"{y}12", 4000.0, 50000.0, None, 9.0, None, None, None, 26.0] for y in range(2025, 2019, -1)])


class _CH:
    """SQL 에 들어 있는 문자열로 결과를 고른다(먼저 맞는 것). 값이 예외면 던진다. 보낸 쿼리를 기록한다."""

    def __init__(self, routes):
        self.routes, self.queries = routes, []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        for key, rows in self.routes:
            if key in sql:
                if isinstance(rows, Exception):
                    raise rows
                return SimpleNamespace(result_rows=rows)
        return SimpleNamespace(result_rows=[])


def _routes(**over):
    base = {
        "latest": (f"max(date) FROM {DB}.daily_prices WHERE ticker", [[D]]),
        "bars": (f"FROM {DB}.daily_prices FINAL",
                 [[D - timedelta(days=i), 70000.0, 71000.0, 69500.0, 70500.0, 1000 + i] for i in range(5)]),
        "computed": (f"FROM {DB}.market_stock_daily", [[70500.0, 0.71, 2.1, None, 8.7e11, 4.2e14, "0013"]]),
        "investor": (f"FROM {DB}.investor_daily", [[-1000, 800, 200, -70, 56, 14]]),
        "fund": (f"FROM {DB}.fundamentals_periodic", FUND),
        "canslim": (f"FROM {DB}.canslim_daily", [CANSLIM_ROW]),
        "groups": (f"FROM {DB}.market_group_daily",
                   [["sector", "0013", "전기·전자", 4, 0.9, 120], ["theme", "9", "다른 이름", 1, 3.0, 10]]),
    }
    base.update(over)
    return list(base.values())


@pytest.fixture
def env(monkeypatch):
    holder = {"ch": _CH(_routes())}
    monkeypatch.setattr(vt, "_ch", lambda: holder["ch"])
    monkeypatch.setattr(vt, "_stock_info", lambda t: dict(INFO))
    monkeypatch.setattr(vt, "_theme_memberships", lambda t: [("7", "반도체"), ("9", "HBM")])

    def use(**over):
        holder["ch"] = _CH(_routes(**over))
        return holder["ch"]

    return SimpleNamespace(use=use, holder=holder)


@pytest.mark.parametrize("raw", ["", "12345", "1234567", "00593!", " 0059 30"])
def test_invalid_ticker(raw):
    with pytest.raises(vt.InvalidTicker):
        vt.normalize_ticker(raw)


def test_ticker_is_trimmed_and_uppercased():
    assert vt.normalize_ticker(" 0001a0 ") == "0001A0"


@pytest.mark.parametrize("raw", ["2026-13-01", "20261016", "어제"])
def test_invalid_date(env, raw):
    with pytest.raises(vt.InvalidDate):
        vt.build(T, raw)


def test_full_report_shape(env):
    out = vt.build(T, None)
    assert list(out) == ["ticker", "date", "requested_date", "profile", "bars", "computed", "investor",
                         "fundamentals", "canslim", "memberships", "links", "notes"]
    assert out["ticker"] == T and out["date"] == "2026-10-16" and out["requested_date"] is None
    assert out["profile"] == INFO
    assert [b["date"] for b in out["bars"]] == ["2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"]
    assert out["bars"][0] == {"date": "2026-10-16", "open": 70000.0, "high": 71000.0, "low": 69500.0,
                              "close": 70500.0, "volume": 1000}
    assert out["computed"] == {"close": 70500.0, "chg_1d": 0.71, "chg_5d": 2.1, "chg_20d": None, "value": 8.7e11,
                               "mcap": 4.2e14, "sector_m": "0013"}
    assert out["investor"] == {"prsn_qty": -1000, "frgn_qty": 800, "orgn_qty": 200,
                               "prsn_amt": -70, "frgn_amt": 56, "orgn_amt": 14}
    f = out["fundamentals"]
    assert len(f["quarterly"]) == vt.QUARTERS and len(f["annual"]) == vt.YEARS
    assert f["quarterly"][0] == {"stac_yymm": "202606", "eps": 1000.0, "bps": 50000.0, "sps": None, "roe": 9.0,
                                 "sales_growth": None, "op_growth": None, "ni_growth": None, "debt_ratio": 26.0}
    assert f["annual"][0]["stac_yymm"] == "202512" and f["annual"][-1]["stac_yymm"] == "202112"
    assert list(out["canslim"]) == list(vt.CANSLIM_COLS)
    assert out["canslim"]["score"] == 65 and out["canslim"]["m"] == -2 and out["canslim"]["c_quarter"] == "202606"
    assert out["memberships"] == [
        {"kind": "sector", "group_id": "0013", "name": "전기·전자", "rank": 4, "chg_1d": 0.9, "members": 120},
        {"kind": "theme", "group_id": "7", "name": "반도체", "rank": None, "chg_1d": None, "members": None},
        {"kind": "theme", "group_id": "9", "name": "HBM", "rank": 1, "chg_1d": 3.0, "members": 10}]
    assert len(out["links"]) == 5 and out["notes"] == {}


def test_explicit_date_and_queries_filter_ticker_with_final(env):
    out = vt.build(T, "2026-10-15")
    assert out["date"] == out["requested_date"] == "2026-10-15"
    queries = env.holder["ch"].queries
    assert not any("max(date)" in s for s, _ in queries)  # 날짜를 주면 최신일을 조회하지 않는다
    for sql, params in queries:
        assert "FINAL" in sql
        if "market_group_daily" in sql:
            assert "members > 0" in sql and params["ids"] == ["0013", "7", "9"]
        else:
            assert params["t"] == T
        if "d" in params:
            assert params["d"] == date(2026, 10, 15)


def test_not_found_when_no_meta_and_no_bars(env, monkeypatch):
    monkeypatch.setattr(vt, "_stock_info", lambda t: None)
    env.use(latest=(f"max(date) FROM {DB}.daily_prices WHERE ticker", [[date(1970, 1, 1)]]))
    with pytest.raises(vt.StockNotFound):
        vt.build("999999", None)


def test_section_failure_is_isolated(env):
    env.use(investor=(f"FROM {DB}.investor_daily", RuntimeError("timeout")))
    out = vt.build(T, None)
    assert out["investor"] is None and out["notes"] == {"investor": vt.FAILED}
    assert out["bars"] and out["computed"] and out["canslim"] and out["memberships"]


def test_missing_tables_are_empty_with_note(env):
    env.use(canslim=(f"FROM {DB}.canslim_daily", MISSING),
            fund=(f"FROM {DB}.fundamentals_periodic", MISSING),
            groups=(f"FROM {DB}.market_group_daily", MISSING))
    out = vt.build(T, None)
    assert out["canslim"] is None and out["fundamentals"] == {"quarterly": [], "annual": []}
    assert [m["rank"] for m in out["memberships"]] == [None, None, None]  # 소속은 보이고 지표만 비어 있다
    assert out["notes"] == {"canslim": vt.TABLE_MISSING, "fundamentals": vt.TABLE_MISSING,
                            "memberships": vt.TABLE_MISSING}


def test_pg_failures_are_isolated(env, monkeypatch):
    def boom(t):
        raise RuntimeError("pg down")

    monkeypatch.setattr(vt, "_stock_info", boom)
    monkeypatch.setattr(vt, "_theme_memberships", boom)
    out = vt.build(T, None)
    assert out["profile"] is None and out["memberships"] is None
    assert out["notes"] == {"profile": vt.FAILED, "memberships": vt.FAILED}
    assert out["bars"] and len(out["links"]) == 4  # 이름을 몰라 DART 링크는 뺀다


def test_known_stock_without_bars(env):
    env.use(latest=(f"max(date) FROM {DB}.daily_prices WHERE ticker", [[date(1970, 1, 1)]]))
    out = vt.build(T, None)
    assert out["date"] is None
    assert out["bars"] is None and out["computed"] is None and out["canslim"] is None and out["memberships"] is None
    assert out["notes"] == {"date": vt.NO_BARS}
    assert out["fundamentals"]["quarterly"]  # 날짜와 무관한 재무는 보인다


def test_links():
    links = vt.links("005930", "삼성 전자&우")
    assert [l["label"] for l in links] == ["네이버 종목", "네이버 일별시세", "네이버 투자자별 매매", "FnGuide", "DART 공시"]
    assert links[0]["url"] == "https://finance.naver.com/item/main.naver?code=005930"
    assert links[1]["url"] == "https://finance.naver.com/item/sise_day.naver?code=005930"
    assert links[2]["url"] == "https://finance.naver.com/item/frgn.naver?code=005930"
    assert links[3]["url"] == "https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=A005930"
    assert links[4]["url"] == ("https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm="
                               "%EC%82%BC%EC%84%B1%20%EC%A0%84%EC%9E%90%26%EC%9A%B0")
    assert len(vt.links("005930", None)) == 4
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_verify_ticker.py -p no:cacheprovider`
Expected: FAIL — `ImportError: cannot import name 'verify_ticker' from 'apps.stock_api.services'`

- [ ] **Step 3: 구현** — `backend/apps/stock_api/services/verify_ticker.py`

```python
"""관리자 데이터 검증 — 종목 하나의 우리 값을 한 번에 모아 외부 사이트(네이버·FnGuide·DART)와 눈으로 비교하게 한다.

- 읽기 전용이다. 섹션마다 조회 실패를 격리한다(그 섹션만 null + notes[섹션]).
- CH 테이블이 아직 없으면(Code 60) 빈 값과 안내를 준다(data_status._missing_table 과 같은 판정).
- ReplacingMergeTree 테이블은 FINAL 을 쓰고 ticker 로 거른다.
- 날짜를 주지 않으면 그 종목의 최신 일봉 날짜를 쓴다. 거래정지 종목도 마지막 거래일 값이 보인다.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Callable
from urllib.parse import quote

from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB as DB
from shared.clickhouse_schema import get_client
from shared.database import SyncSessionLocal
from shared.market_models import Sector, StockProfile
from shared.models import StockMeta

log = logging.getLogger(__name__)

TICKER_RE = re.compile(r"[0-9A-Z]{6}")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")  # py3.12 fromisoformat 은 '20261016' 도 받아서 형식을 먼저 본다
_EPOCH = date(1970, 1, 1)
BAR_ROWS = 5
QUARTERS = 8
YEARS = 5
FAILED = "조회에 실패했어요(서버 로그 확인)"
TABLE_MISSING = "아직 계산·수집된 적이 없어요(테이블 없음)"
NO_BARS = "일봉이 없어 기준일을 정할 수 없어요"

INVESTOR_COLS = ("prsn_qty", "frgn_qty", "orgn_qty", "prsn_amt", "frgn_amt", "orgn_amt")
FUND_COLS = ("stac_yymm", "eps", "bps", "sps", "roe", "sales_growth", "op_growth", "ni_growth", "debt_ratio")
CANSLIM_COLS = ("score", "pass_count", "liquid", "c", "a", "n", "s", "l", "i", "m", "c_growth", "c_quarter",
                "c_turnaround", "a_cagr", "a_roe", "n_pct_from_high", "n_high_52w", "s_ud_ratio", "l_rs", "l_rs_raw",
                "sector_rs_rank", "sector_rs_count", "i_net_qty", "i_buy_days", "m_dist_days", "avg_value_20d")


class InvalidTicker(ValueError):
    """종목 코드 형식 오류(영문 대문자·숫자 6자리)."""


class InvalidDate(ValueError):
    """날짜 형식 오류(YYYY-MM-DD)."""


class StockNotFound(LookupError):
    """stock_meta 에도 없고 일봉도 없음."""


# ---------------------------------------------------------------- 저장소 접근(테스트에서 바꿔 끼운다)
def _ch():
    return get_client()


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def _stock_info(ticker: str) -> dict | None:
    """stock_meta + stock_profile + sectors. stock_meta 에 없으면 None."""
    with SyncSessionLocal() as db:
        meta = db.get(StockMeta, ticker)
        if meta is None:
            return None
        prof = db.get(StockProfile, ticker)
        code = prof.sector_m if prof is not None and prof.sector_m else None
        sector = db.get(Sector, code) if code else None
        market = meta.market.value if hasattr(meta.market, "value") else str(meta.market)
        return {"name": meta.name, "market": market, "is_active": bool(meta.is_active),
                "sector_code": code, "sector_name": sector.name if sector is not None else None,
                "listed_shares_k": prof.listed_shares_k if prof is not None else None,
                "is_halted": bool(prof.is_halted) if prof is not None else None}


def _theme_memberships(ticker: str) -> list[tuple[str, str]]:
    """[(테마 id 문자열, 이름)] — 숨김 테마·제외 종목 빼고(시장 그룹 계산과 같은 기준)."""
    with SyncSessionLocal() as db:
        groups = market_repo.theme_groups(db)
    return [(gid, name) for gid, (name, tickers) in groups.items() if ticker in tickers]


# ---------------------------------------------------------------- 입력
def normalize_ticker(raw: str | None) -> str:
    t = (raw or "").strip().upper()
    if not TICKER_RE.fullmatch(t):
        raise InvalidTicker(raw)
    return t


def parse_date(raw: str | None) -> date | None:
    if raw is None or not raw.strip():
        return None
    s = raw.strip()
    if not DATE_RE.fullmatch(s):
        raise InvalidDate(raw)
    try:
        return date.fromisoformat(s)
    except ValueError as exc:
        raise InvalidDate(raw) from exc


# ---------------------------------------------------------------- 도우미
def _missing_table(exc: Exception) -> bool:
    msg = str(exc)
    return "UNKNOWN_TABLE" in msg or "Code: 60." in msg


def _section(name: str, fn: Callable[[], object], notes: dict, empty=None):
    """섹션 하나 — 실패하면 null + notes[name]. 테이블이 없으면 empty + 안내."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 — 한 섹션 실패가 화면 전체를 막지 않게
        if _missing_table(exc):
            notes[name] = TABLE_MISSING
            return empty
        log.warning("데이터 검증 조회 실패 %s: %s", name, exc)
        notes[name] = FAILED
        return None


def _f(v) -> float | None:
    return None if v is None else float(v)


def links(ticker: str, name: str | None) -> list[dict]:
    out = [
        {"label": "네이버 종목", "url": f"https://finance.naver.com/item/main.naver?code={ticker}"},
        {"label": "네이버 일별시세", "url": f"https://finance.naver.com/item/sise_day.naver?code={ticker}"},
        {"label": "네이버 투자자별 매매", "url": f"https://finance.naver.com/item/frgn.naver?code={ticker}"},
        {"label": "FnGuide", "url": f"https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=A{ticker}"},
    ]
    if name:
        out.append({"label": "DART 공시",
                    "url": f"https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm={quote(name)}"})
    return out


# ---------------------------------------------------------------- 섹션
def _resolve_date(ticker: str, requested: date | None) -> date | None:
    if requested:
        return requested
    rows = _query(f"SELECT max(date) FROM {DB}.daily_prices WHERE ticker = %(t)s", {"t": ticker})
    d = rows[0][0] if rows else None
    return None if d is None or d <= _EPOCH else d


def _bars(ticker: str, d: date) -> list[dict]:
    rows = _query(f"SELECT date, open, high, low, close, volume FROM {DB}.daily_prices FINAL "
                  "WHERE ticker = %(t)s AND date <= %(d)s ORDER BY date DESC LIMIT %(n)s",
                  {"t": ticker, "d": d, "n": BAR_ROWS})
    return [{"date": r[0].isoformat(), "open": float(r[1]), "high": float(r[2]), "low": float(r[3]),
             "close": float(r[4]), "volume": int(r[5])} for r in rows]


def _computed(ticker: str, d: date) -> dict | None:
    rows = _query(f"SELECT close, chg_1d, chg_5d, chg_20d, value, mcap, sector_m FROM {DB}.market_stock_daily FINAL "
                  "WHERE date = %(d)s AND ticker = %(t)s", {"t": ticker, "d": d})
    if not rows:
        return None
    close, c1, c5, c20, value, mcap, sector_m = rows[0]
    return {"close": float(close), "chg_1d": _f(c1), "chg_5d": _f(c5), "chg_20d": _f(c20), "value": float(value),
            "mcap": _f(mcap), "sector_m": sector_m}


def _investor(ticker: str, d: date) -> dict | None:
    rows = _query(f"SELECT {', '.join(INVESTOR_COLS)} FROM {DB}.investor_daily FINAL "
                  "WHERE ticker = %(t)s AND date = %(d)s", {"t": ticker, "d": d})
    return dict(zip(INVESTOR_COLS, (int(v) for v in rows[0]))) if rows else None


def _fundamentals(ticker: str) -> dict:
    """분기 최근 QUARTERS 개·연간 최근 YEARS 개(최신이 앞). 누적/단독 판단은 관리자가 원값을 보고 한다."""
    rows = _query(f"SELECT period, {', '.join(FUND_COLS)} FROM {DB}.fundamentals_periodic FINAL "
                  "WHERE ticker = %(t)s ORDER BY period, stac_yymm DESC", {"t": ticker})
    quarterly, annual = [], []
    for period, ym, *vals in rows:
        item = {"stac_yymm": ym, **{c: _f(v) for c, v in zip(FUND_COLS[1:], vals)}}
        if period == "Q" and len(quarterly) < QUARTERS:
            quarterly.append(item)
        elif period == "Y" and len(annual) < YEARS:
            annual.append(item)
    return {"quarterly": quarterly, "annual": annual}


def _canslim(ticker: str, d: date) -> dict | None:
    rows = _query(f"SELECT {', '.join(CANSLIM_COLS)} FROM {DB}.canslim_daily FINAL "
                  "WHERE date = %(d)s AND ticker = %(t)s", {"t": ticker, "d": d})
    return dict(zip(CANSLIM_COLS, rows[0])) if rows else None


def _memberships(ticker: str, d: date, profile: dict | None, notes: dict) -> list[dict]:
    """업종 1개 + 소속 테마, 그날 market_group_daily 지표(members > 0 만 — 숨김 tombstone 제외)."""
    wanted: list[tuple[str, str, str | None]] = []
    if profile and profile.get("sector_code"):
        wanted.append(("sector", profile["sector_code"], profile.get("sector_name")))
    wanted += [("theme", gid, name) for gid, name in _theme_memberships(ticker)]
    if not wanted:
        return []
    try:
        rows = _query(f"SELECT kind, group_id, name, rank, chg_1d, members FROM {DB}.market_group_daily FINAL "
                      "WHERE date = %(d)s AND members > 0 AND group_id IN %(ids)s",
                      {"d": d, "ids": sorted({gid for _, gid, _ in wanted})})
    except Exception as exc:
        if not _missing_table(exc):
            raise
        notes["memberships"] = TABLE_MISSING
        rows = []
    found = {(k, g): (n, r, c, m) for k, g, n, r, c, m in rows}
    out = []
    for kind, gid, name in wanted:
        hit = found.get((kind, gid))
        out.append({"kind": kind, "group_id": gid, "name": name or (hit[0] if hit else gid),
                    "rank": int(hit[1]) if hit else None, "chg_1d": _f(hit[2]) if hit else None,
                    "members": int(hit[3]) if hit else None})
    return out


# ---------------------------------------------------------------- 진입점
def build(ticker_raw: str | None, date_raw: str | None = None) -> dict:
    ticker = normalize_ticker(ticker_raw)
    requested = parse_date(date_raw)
    notes: dict[str, str] = {}

    profile, profile_ok = None, True
    try:
        profile = _stock_info(ticker)
    except Exception as exc:  # noqa: BLE001
        log.warning("데이터 검증 프로필 조회 실패 %s: %s", ticker, exc)
        notes["profile"] = FAILED
        profile_ok = False

    d = _section("date", lambda: _resolve_date(ticker, requested), notes)
    if d is None and "date" not in notes:
        notes["date"] = NO_BARS

    def dated(name: str, fn: Callable[[str, date], object]):
        return None if d is None else _section(name, lambda: fn(ticker, d), notes)

    bars = dated("bars", _bars)
    if profile_ok and profile is None and not bars and notes.get("date", NO_BARS) == NO_BARS and "bars" not in notes:
        raise StockNotFound(ticker)

    return {
        "ticker": ticker,
        "date": d.isoformat() if d else None,
        "requested_date": requested.isoformat() if requested else None,
        "profile": profile,
        "bars": bars,
        "computed": dated("computed", _computed),
        "investor": dated("investor", _investor),
        "fundamentals": _section("fundamentals", lambda: _fundamentals(ticker), notes,
                                 empty={"quarterly": [], "annual": []}),
        "canslim": dated("canslim", _canslim),
        "memberships": None if d is None else _section(
            "memberships", lambda: _memberships(ticker, d, profile, notes), notes),
        "links": links(ticker, profile["name"] if profile else None),
        "notes": notes,
    }
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_verify_ticker.py -p no:cacheprovider`
Expected: `17 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/stock_api/services/verify_ticker.py backend/tests/test_verify_ticker.py
git commit -m "feat(stock_api): 데이터 검증 서비스 — 종목 하나의 일봉·계산값·투자자·재무·CANSLIM·소속 그룹 + 외부 링크

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: 관리자 라우터 `GET /api/v1/admin/market/verify`

**Files:**
- Modify: `backend/apps/stock_api/routers/market_admin.py` (import 7행, 파일 끝에 엔드포인트 추가)
- Modify: `backend/tests/test_market_admin_api.py` (import 8행, 파일 끝에 테스트 2개 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_market_admin_api.py`
  - 8행 import 를 `from apps.stock_api.services import admin_jobs, data_status, verify_ticker` 로 바꾼다.
  - 파일 끝에 다음을 추가한다.

```python
async def test_verify_admin_only_and_passes_params(api, monkeypatch):
    client, state = api
    state["user"] = FREE
    assert (await client.get("/api/v1/admin/market/verify", params={"ticker": "005930"})).status_code == 403
    state["user"] = ADMIN
    calls = []

    def ok(ticker, date):
        calls.append((ticker, date))
        return {"ticker": "005930", "date": "2026-10-16"}

    monkeypatch.setattr(verify_ticker, "build", ok)
    r = await client.get("/api/v1/admin/market/verify", params={"ticker": "005930", "date": "2026-10-16"})
    assert r.status_code == 200 and r.json() == {"ticker": "005930", "date": "2026-10-16"}
    await client.get("/api/v1/admin/market/verify", params={"ticker": "005930"})
    assert calls == [("005930", "2026-10-16"), ("005930", None)]


async def test_verify_error_codes(api, monkeypatch):
    client, state = api
    state["user"] = ADMIN
    # 실제 서비스: ticker 가 없으면 DB 에 닿기 전에 형식 오류 → FastAPI 기본 배열이 아닌 {code, message}
    r = await client.get("/api/v1/admin/market/verify")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "INVALID_TICKER"
    for exc, code, key in ((verify_ticker.InvalidTicker("x"), 422, "INVALID_TICKER"),
                           (verify_ticker.InvalidDate("x"), 422, "INVALID_DATE"),
                           (verify_ticker.StockNotFound("x"), 404, "STOCK_NOT_FOUND")):
        def raiser(ticker, date, exc=exc):
            raise exc

        monkeypatch.setattr(verify_ticker, "build", raiser)
        r = await client.get("/api/v1/admin/market/verify", params={"ticker": "005930"})
        detail = r.json()["detail"]
        assert r.status_code == code and detail["code"] == key and detail["message"]
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_market_admin_api.py -p no:cacheprovider`
Expected: FAIL — 새 테스트 2개가 실패한다(`/verify` 가 없어 404 이다). 기존 4개는 통과한다.

- [ ] **Step 3: 구현** — `backend/apps/stock_api/routers/market_admin.py`
  - 7행 import 를 바꾼다.

```python
from apps.stock_api.services import admin_jobs, data_status, verify_ticker
```

- 1행 docstring 을 바꾼다.

```python
"""관리자 시장 데이터 REST — 데이터 현황, 계산 수동 실행, 데이터 검증(관리자 JWT 만). 서비스는 동기라 스레드풀에서 돈다."""
```

- 파일 끝에 추가한다.

```python


@router.get("/verify")
async def verify(ticker: str = "", date: str | None = None, _admin: User = Depends(require_admin)):
    """종목 하나의 우리 값 모음(데이터 검증 화면). 형식 오류도 {code, message} 로 준다(FastAPI 기본 422 배열 아님)."""
    try:
        return await run_in_threadpool(verify_ticker.build, ticker, date)
    except verify_ticker.InvalidTicker:
        raise HTTPException(422, detail={"code": "INVALID_TICKER", "message": "종목 코드는 영문·숫자 6자리예요."})
    except verify_ticker.InvalidDate:
        raise HTTPException(422, detail={"code": "INVALID_DATE", "message": "날짜는 YYYY-MM-DD 형식이에요."})
    except verify_ticker.StockNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            detail={"code": "STOCK_NOT_FOUND", "message": "종목을 찾을 수 없어요."})
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_market_admin_api.py tests/test_verify_ticker.py -p no:cacheprovider`
Expected: `23 passed`(기존 4 + 신규 2 + 서비스 17)

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/stock_api/routers/market_admin.py backend/tests/test_market_admin_api.py
git commit -m "feat(stock_api): GET /api/v1/admin/market/verify — 데이터 검증(관리자, 422·404 {code,message})

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 관리자 웹 — 검증 응답 타입·API 함수·숫자 표시

**Files:**
- Modify: `admin_web/src/types/marketAdmin.ts` (파일 끝에 추가)
- Modify: `admin_web/src/api/marketAdmin.ts` (import 목록, 파일 끝)
- Modify: `admin_web/src/lib/marketFormat.ts` (파일 끝에 추가)

타입은 Task 3 의 `test_full_report_shape` 가 고정한 키와 1:1 로 맞춘다. 응답 키는 snake_case 그대로다(REST).

- [ ] **Step 1: 타입** — `admin_web/src/types/marketAdmin.ts` 끝에 추가한다.

```ts

// 데이터 검증 GET /api/v1/admin/market/verify — backend/apps/stock_api/services/verify_ticker.py
export interface VerifyProfile {
  name: string
  market: string
  is_active: boolean
  sector_code: string | null
  sector_name: string | null
  listed_shares_k: number | null // 천 주
  is_halted: boolean | null
}

export interface VerifyBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface VerifyComputed {
  close: number
  chg_1d: number | null // %
  chg_5d: number | null
  chg_20d: number | null
  value: number // 거래대금(원, 종가×거래량 근사)
  mcap: number | null // 원
  sector_m: string
}

export interface VerifyInvestor {
  prsn_qty: number
  frgn_qty: number
  orgn_qty: number
  prsn_amt: number // KIS 원값(단위 변환 없음)
  frgn_amt: number
  orgn_amt: number
}

export interface VerifyFundamentalRow {
  stac_yymm: string
  eps: number | null
  bps: number | null
  sps: number | null
  roe: number | null
  sales_growth: number | null
  op_growth: number | null
  ni_growth: number | null
  debt_ratio: number | null
}

export interface VerifyFundamentals {
  quarterly: VerifyFundamentalRow[] // 최신이 앞
  annual: VerifyFundamentalRow[]
}

// c~m: 1 통과 · 0 미달 · -1 판단 불가 · -2 준비 중 (backend/apps/collector/canslim/rules.py)
export interface VerifyCanslim {
  score: number
  pass_count: number
  liquid: number
  c: number
  a: number
  n: number
  s: number
  l: number
  i: number
  m: number
  c_growth: number | null
  c_quarter: string
  c_turnaround: number
  a_cagr: number | null
  a_roe: number | null
  n_pct_from_high: number | null
  n_high_52w: number | null
  s_ud_ratio: number | null
  l_rs: number | null
  l_rs_raw: number | null
  sector_rs_rank: number | null
  sector_rs_count: number | null
  i_net_qty: number | null
  i_buy_days: number | null
  m_dist_days: number | null
  avg_value_20d: number | null
}

export interface VerifyMembership {
  kind: 'theme' | 'sector'
  group_id: string
  name: string
  rank: number | null // 0 = 순위 제외(3종목 미만), null = 그날 계산 행 없음
  chg_1d: number | null
  members: number | null
}

export interface VerifyLink {
  label: string
  url: string
}

export type VerifySection =
  | 'date'
  | 'profile'
  | 'bars'
  | 'computed'
  | 'investor'
  | 'fundamentals'
  | 'canslim'
  | 'memberships'

export interface VerifyReport {
  ticker: string
  date: string | null // 결정된 기준일
  requested_date: string | null
  profile: VerifyProfile | null
  bars: VerifyBar[] | null // 최신이 앞
  computed: VerifyComputed | null
  investor: VerifyInvestor | null
  fundamentals: VerifyFundamentals | null
  canslim: VerifyCanslim | null
  memberships: VerifyMembership[] | null
  links: VerifyLink[]
  notes: Partial<Record<VerifySection, string>> // 섹션별 실패·없음 안내
}
```

- [ ] **Step 2: API 함수** — `admin_web/src/api/marketAdmin.ts`
  - import 목록에 `VerifyReport,` 를 `ThemeStockRow,` 아래에 추가한다(알파벳 순).
  - 파일 끝에 추가한다.

```ts

export const getVerify = async (ticker: string, date?: string): Promise<VerifyReport> =>
  (await http.get<VerifyReport>(`${MARKET}/verify`, { params: date ? { ticker, date } : { ticker } })).data
```

- [ ] **Step 3: 숫자 표시** — `admin_web/src/lib/marketFormat.ts` 끝에 추가한다.

```ts

export const formatNum = (v: number | null | undefined, digits = 0): string =>
  v == null ? '—' : v.toLocaleString('ko-KR', { maximumFractionDigits: digits })
```

- [ ] **Step 4: 타입 검사**

Run: `cd admin_web && npx tsc --noEmit`
Expected: 출력 없이 종료(코드 0)

- [ ] **Step 5: 커밋**

```bash
git add admin_web/src/types/marketAdmin.ts admin_web/src/api/marketAdmin.ts admin_web/src/lib/marketFormat.ts
git commit -m "feat(admin_web): 데이터 검증 응답 타입·getVerify·formatNum

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 관리자 웹 — 데이터 검증 화면

**Files:**
- Create: `admin_web/src/components/market/VerifyStockPicker.tsx`
- Create: `admin_web/src/components/market/VerifyCards.tsx`
- Create: `admin_web/src/components/market/VerifyTables.tsx`
- Create: `admin_web/src/pages/MarketVerify.tsx`

**모바일 390px 규칙:** 페이지가 가로로 넘치지 않아야 한다.
- 그리드 자식 카드는 `min-w-0` 이다.
- 표는 `overflow-x-auto` 안에 둔다. 숫자·날짜 칸은 `whitespace-nowrap` 이다.
- 한글 문장은 `break-keep` 이다.

- [ ] **Step 1: 종목 검색** — `admin_web/src/components/market/VerifyStockPicker.tsx`

```tsx
import { useEffect, useState } from 'react'
import { searchStocks } from '../../api/stockClient'
import type { Stock } from '../../types/stock'

const DEBOUNCE_MS = 300
const MAX_RESULTS = 8
const TICKER_RE = /^[0-9A-Za-z]{6}$/

interface Props {
  onPick: (ticker: string) => void
}

// 국내 종목 검색(기존 GraphQL searchStocks 재사용, StockSearchAdd 와 같은 디바운스).
// 6자리 코드를 치고 Enter 를 누르면 검색 결과 없이도 바로 조회한다(상장폐지 종목 확인용).
export default function VerifyStockPicker({ onPick }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      setSearched(false)
      return
    }
    let alive = true
    setSearched(false)
    const timer = window.setTimeout(() => {
      setSearching(true)
      searchStocks(q)
        .then((rows) => {
          if (alive) setResults(rows.filter((r) => r.country === 'KR').slice(0, MAX_RESULTS))
        })
        .catch(() => {
          if (alive) setResults([])
        })
        .finally(() => {
          if (alive) {
            setSearching(false)
            setSearched(true)
          }
        })
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query])

  const pick = (ticker: string) => {
    onPick(ticker.toUpperCase())
    setQuery('')
    setResults([])
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        value={query}
        aria-label="종목 검색"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && TICKER_RE.test(query.trim())) pick(query.trim())
        }}
        placeholder="종목명 또는 6자리 코드(Enter)"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      {query.trim() && searching && <p className="mt-1 text-xs text-slate-400">검색 중…</p>}
      {query.trim() && !searching && searched && results.length === 0 && (
        <p className="mt-1 text-xs text-slate-400">국내 종목 결과가 없어요</p>
      )}
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onClick={() => pick(r.symbol)}
                className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 text-xs text-slate-400">{r.symbol}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 카드 틀 + 값 카드** — `admin_web/src/components/market/VerifyCards.tsx`

```tsx
import type { ReactNode } from 'react'
import { formatAmount, formatNum, formatPct, pctClass } from '../../lib/marketFormat'
import type {
  VerifyCanslim,
  VerifyComputed,
  VerifyInvestor,
  VerifyLink,
  VerifyProfile,
} from '../../types/marketAdmin'

interface CardProps {
  title: string
  note?: string // 섹션 실패·없음 안내(서버 notes)
  hint?: string // 비교할 때 주의할 점(고정 문구)
  className?: string
  children: ReactNode
}

export function VerifyCard({ title, note, hint, className = '', children }: CardProps) {
  return (
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {hint && <p className="mt-1 break-keep text-xs text-slate-400">{hint}</p>}
      {note && <p className="mt-2 break-keep rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function Empty() {
  return <p className="text-sm text-slate-400">값이 없어요</p>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 break-keep text-right">{children}</dd>
    </div>
  )
}

export function ProfileCard({ data, note }: { data: VerifyProfile | null; note?: string }) {
  return (
    <VerifyCard title="기본 정보" note={note}>
      {data ? (
        <dl className="space-y-1.5 text-sm">
          <Row label="이름">{data.name}</Row>
          <Row label="시장">{data.market}</Row>
          <Row label="업종">{data.sector_code ? `${data.sector_name ?? '이름 없음'} (${data.sector_code})` : '—'}</Row>
          <Row label="상장주식수">{data.listed_shares_k == null ? '—' : `${formatNum(data.listed_shares_k)}천 주`}</Row>
          <Row label="상태">
            {[data.is_active ? '활성' : '비활성', data.is_halted ? '거래정지' : null].filter(Boolean).join(' · ')}
          </Row>
        </dl>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

const CHANGES: { key: 'chg_1d' | 'chg_5d' | 'chg_20d'; label: string }[] = [
  { key: 'chg_1d', label: '1일 등락' },
  { key: 'chg_5d', label: '5일 등락' },
  { key: 'chg_20d', label: '20일 등락' },
]

export function ComputedCard({ data, note }: { data: VerifyComputed | null; note?: string }) {
  return (
    <VerifyCard title="계산값(market_stock_daily)" note={note} hint="거래대금은 종가×거래량 근사, 시총은 종가×상장주식수">
      {data ? (
        <dl className="space-y-1.5 text-sm">
          <Row label="종가">{formatNum(data.close)}</Row>
          {CHANGES.map((c) => (
            <Row key={c.key} label={c.label}>
              <span className={pctClass(data[c.key])}>{formatPct(data[c.key])}</span>
            </Row>
          ))}
          <Row label="거래대금">{formatAmount(data.value)}</Row>
          <Row label="시가총액">{formatAmount(data.mcap)}</Row>
        </dl>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

const INVESTORS: { label: string; qty: keyof VerifyInvestor; amt: keyof VerifyInvestor }[] = [
  { label: '개인', qty: 'prsn_qty', amt: 'prsn_amt' },
  { label: '외국인', qty: 'frgn_qty', amt: 'frgn_amt' },
  { label: '기관', qty: 'orgn_qty', amt: 'orgn_amt' },
]

export function InvestorCard({ data, note }: { data: VerifyInvestor | null; note?: string }) {
  return (
    <VerifyCard
      title="투자자 순매수(investor_daily)"
      note={note}
      hint="금액은 KIS 원값 그대로(단위 변환 없음) — 수량으로 비교하세요"
    >
      {data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="whitespace-nowrap py-1 pr-3 text-left font-medium">주체</th>
                <th className="whitespace-nowrap py-1 pr-3 text-right font-medium">수량(주)</th>
                <th className="whitespace-nowrap py-1 text-right font-medium">금액(원값)</th>
              </tr>
            </thead>
            <tbody>
              {INVESTORS.map((r) => (
                <tr key={r.qty} className="border-t border-slate-100">
                  <td className="whitespace-nowrap py-1 pr-3">{r.label}</td>
                  <td className={`whitespace-nowrap py-1 pr-3 text-right ${pctClass(data[r.qty])}`}>
                    {formatNum(data[r.qty])}
                  </td>
                  <td className="whitespace-nowrap py-1 text-right">{formatNum(data[r.amt])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

const LETTERS = ['c', 'a', 'n', 's', 'l', 'i', 'm'] as const

const markInfo = (v: number): { label: string; className: string } =>
  v === 1
    ? { label: '통과', className: 'bg-emerald-100 text-emerald-700' }
    : v === 0
      ? { label: '미달', className: 'bg-red-100 text-red-700' }
      : v === -1
        ? { label: '판단 불가', className: 'bg-slate-100 text-slate-500' }
        : { label: '준비 중', className: 'bg-slate-100 text-slate-400' }

export function CanslimCard({ data, note }: { data: VerifyCanslim | null; note?: string }) {
  return (
    <VerifyCard title="CANSLIM(canslim_daily)" note={note}>
      {data ? (
        <>
          <p className="text-sm">
            점수 <b className="text-lg">{data.score}</b> · 통과 {data.pass_count}/7 · 유동성{' '}
            {data.liquid ? '충족' : '미달'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LETTERS.map((k) => {
              const m = markInfo(data[k])
              return (
                <span key={k} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${m.className}`}>
                  {k.toUpperCase()} {m.label}
                </span>
              )
            })}
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="c_growth · c_quarter">
              {`${formatNum(data.c_growth, 1)}% · ${data.c_quarter || '—'}${data.c_turnaround ? ' · 흑자 전환' : ''}`}
            </Row>
            <Row label="a_cagr · a_roe">{`${formatNum(data.a_cagr, 1)}% · ${formatNum(data.a_roe, 1)}%`}</Row>
            <Row label="n_pct_from_high · n_high_52w">
              {`${formatNum(data.n_pct_from_high, 1)}% · ${formatNum(data.n_high_52w)}`}
            </Row>
            <Row label="s_ud_ratio">{formatNum(data.s_ud_ratio, 2)}</Row>
            <Row label="l_rs (l_rs_raw)">{`${formatNum(data.l_rs)} (${formatNum(data.l_rs_raw, 3)})`}</Row>
            <Row label="업종 RS 순위">
              {data.sector_rs_rank == null ? '—' : `${data.sector_rs_rank} / ${formatNum(data.sector_rs_count)}`}
            </Row>
            <Row label="i_net_qty · i_buy_days">{`${formatNum(data.i_net_qty)} · ${formatNum(data.i_buy_days)}`}</Row>
            <Row label="m_dist_days">{formatNum(data.m_dist_days, 1)}</Row>
            <Row label="20일 평균 거래대금">{formatAmount(data.avg_value_20d)}</Row>
          </dl>
        </>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

export function LinksCard({ links }: { links: VerifyLink[] }) {
  return (
    <VerifyCard title="외부 사이트에서 비교" hint="새 탭에서 열려요">
      <ul className="flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.url}>
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-block whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-indigo-600 hover:bg-slate-50"
            >
              {l.label} ↗
            </a>
          </li>
        ))}
      </ul>
    </VerifyCard>
  )
}
```

- [ ] **Step 3: 표 카드** — `admin_web/src/components/market/VerifyTables.tsx`

```tsx
import { formatNum, formatPct, pctClass } from '../../lib/marketFormat'
import type {
  VerifyBar,
  VerifyFundamentalRow,
  VerifyFundamentals,
  VerifyMembership,
} from '../../types/marketAdmin'
import { Empty, VerifyCard } from './VerifyCards'

const TH = 'whitespace-nowrap py-1 pr-3 text-right font-medium'
const TH_LEFT = 'whitespace-nowrap py-1 pr-3 text-left font-medium'
const TD = 'whitespace-nowrap py-1 pr-3 text-right'
const BAR_HINT =
  '우리 일봉은 KRX+넥스트레이드 통합 시세 — 시가·거래량은 KRX 단독 사이트와 다를 수 있음(고가≥, 저가≤, 거래량≥ 가 정상)'
const GROUP_HINT = '테마·업종 등락은 구성 종목 단순 평균 — 사이트별 정의가 달라 흐름만 비교'
const FUND_HINT = '분기 EPS 는 원값 그대로 — 분기마다 계속 커지면 누적(연초부터), 들쭉날쭉하면 단독 분기로 보세요'

interface TableCardProps<T> {
  rows: T | null
  note?: string
  className?: string
}

export function BarsCard({ rows, note, className }: TableCardProps<VerifyBar[]>) {
  return (
    <VerifyCard title="일봉(daily_prices, 최근 5행)" note={note} hint={BAR_HINT} className={className}>
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className={TH_LEFT}>날짜</th>
                {['시가', '고가', '저가', '종가', '거래량'].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.date} className="border-t border-slate-100">
                  <td className="whitespace-nowrap py-1 pr-3">{b.date}</td>
                  <td className={TD}>{formatNum(b.open)}</td>
                  <td className={TD}>{formatNum(b.high)}</td>
                  <td className={TD}>{formatNum(b.low)}</td>
                  <td className={TD}>{formatNum(b.close)}</td>
                  <td className={TD}>{formatNum(b.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

type FundKey = Exclude<keyof VerifyFundamentalRow, 'stac_yymm'>

const FUND_COLS: { key: FundKey; label: string; digits: number }[] = [
  { key: 'eps', label: 'EPS', digits: 0 },
  { key: 'bps', label: 'BPS', digits: 0 },
  { key: 'sps', label: 'SPS', digits: 0 },
  { key: 'roe', label: 'ROE %', digits: 2 },
  { key: 'sales_growth', label: '매출 증가 %', digits: 2 },
  { key: 'op_growth', label: '영업이익 증가 %', digits: 2 },
  { key: 'ni_growth', label: '순이익 증가 %', digits: 2 },
  { key: 'debt_ratio', label: '부채비율 %', digits: 2 },
]

function FundTable({ title, rows }: { title: string; rows: VerifyFundamentalRow[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-slate-600">{title}</p>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className={TH_LEFT}>결산</th>
                {FUND_COLS.map((c) => (
                  <th key={c.key} className={TH}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.stac_yymm} className="border-t border-slate-100">
                  <td className="whitespace-nowrap py-1 pr-3">{r.stac_yymm}</td>
                  {FUND_COLS.map((c) => (
                    <td key={c.key} className={TD}>
                      {formatNum(r[c.key], c.digits)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function FundamentalsCard({ rows, note, className }: TableCardProps<VerifyFundamentals>) {
  return (
    <VerifyCard title="재무(fundamentals_periodic)" note={note} hint={FUND_HINT} className={className}>
      {rows ? (
        <div className="space-y-4">
          <FundTable title="분기(최근 8개)" rows={rows.quarterly} />
          <FundTable title="연간(최근 5개)" rows={rows.annual} />
        </div>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}

const rankText = (rank: number | null): string =>
  rank == null ? '—' : rank === 0 ? '제외(3종목 미만)' : `${rank}위`

export function MembershipsCard({ rows, note, className }: TableCardProps<VerifyMembership[]>) {
  return (
    <VerifyCard
      title="소속 그룹(market_group_daily)"
      note={note}
      hint={`${GROUP_HINT}. '—' 는 그날 계산 행이 없다는 뜻이에요.`}
      className={className}
    >
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className={TH_LEFT}>종류</th>
                <th className={TH_LEFT}>이름</th>
                <th className={TH}>순위</th>
                <th className={TH}>1일 등락</th>
                <th className={TH}>구성 수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={`${m.kind}:${m.group_id}`} className="border-t border-slate-100">
                  <td className="whitespace-nowrap py-1 pr-3">{m.kind === 'sector' ? '업종' : '테마'}</td>
                  <td className="min-w-[8rem] break-keep py-1 pr-3">
                    {m.name} <span className="text-xs text-slate-400">{m.group_id}</span>
                  </td>
                  <td className={TD}>{rankText(m.rank)}</td>
                  <td className={`${TD} ${pctClass(m.chg_1d)}`}>{formatPct(m.chg_1d)}</td>
                  <td className={TD}>{formatNum(m.members)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </VerifyCard>
  )
}
```

- [ ] **Step 4: 화면** — `admin_web/src/pages/MarketVerify.tsx`

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getVerify } from '../api/marketAdmin'
import { CanslimCard, ComputedCard, InvestorCard, LinksCard, ProfileCard } from '../components/market/VerifyCards'
import VerifyStockPicker from '../components/market/VerifyStockPicker'
import { BarsCard, FundamentalsCard, MembershipsCard } from '../components/market/VerifyTables'
import { apiErrorMessage } from '../lib/apiError'
import type { VerifyReport } from '../types/marketAdmin'

const WIDE = 'lg:col-span-2 xl:col-span-3'

// 종목·기준일은 주소 쿼리(?ticker=&date=)에 둔다 — 새로고침·공유해도 같은 화면. date 가 없으면 서버가 그 종목 최신 일봉일로 정한다.
export default function MarketVerify() {
  const [params, setParams] = useSearchParams()
  const ticker = params.get('ticker') ?? ''
  const date = params.get('date') ?? ''
  const [data, setData] = useState<VerifyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!ticker) {
      setData(null)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    getVerify(ticker, date || undefined)
      .then((r) => {
        if (alive) setData(r)
      })
      .catch((e: unknown) => {
        if (alive) {
          setData(null)
          setError(apiErrorMessage(e))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [ticker, date, reloadKey])

  const go = (next: { ticker?: string; date?: string }) => {
    const t = next.ticker ?? ticker
    const d = next.date ?? date
    const p: Record<string, string> = {}
    if (t) p.ticker = t
    if (d) p.date = d
    setParams(p)
  }

  const notes: VerifyReport['notes'] = data?.notes ?? {}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">데이터 검증</h1>
        <p className="mt-1 break-keep text-sm text-slate-500">
          종목 하나의 우리 값을 모아 보여줘요. 아래 링크의 외부 사이트와 눈으로 비교하세요(읽기 전용).
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <VerifyStockPicker onPick={(t) => go({ ticker: t })} />
        <div className="flex min-w-0 gap-2">
          <input
            type="date"
            aria-label="기준일"
            value={date || data?.date || ''}
            onChange={(e) => go({ date: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!date}
            onClick={() => go({ date: '' })}
            className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            최신일
          </button>
          <button
            type="button"
            disabled={!ticker || loading}
            onClick={() => setReloadKey((k) => k + 1)}
            className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
      </div>

      {!ticker && <p className="text-sm text-slate-400">종목을 검색해 고르세요.</p>}
      {error && <p className="break-keep rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          <p className="break-keep text-sm text-slate-600">
            <b className="text-slate-800">{data.profile?.name ?? data.ticker}</b>{' '}
            <span className="text-slate-400">{data.ticker}</span> · 기준일 {data.date ?? '—'}
            {data.date && !data.requested_date ? ' (최신 일봉)' : ''}
          </p>
          {notes.date && (
            <p className="break-keep rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{notes.date}</p>
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <ProfileCard data={data.profile} note={notes.profile} />
            <ComputedCard data={data.computed} note={notes.computed} />
            <InvestorCard data={data.investor} note={notes.investor} />
            <BarsCard rows={data.bars} note={notes.bars} className={WIDE} />
            <MembershipsCard rows={data.memberships} note={notes.memberships} className={WIDE} />
            <CanslimCard data={data.canslim} note={notes.canslim} />
            <LinksCard links={data.links} />
            <FundamentalsCard rows={data.fundamentals} note={notes.fundamentals} className={WIDE} />
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 5: 타입 검사**

Run: `cd admin_web && npx tsc --noEmit`
Expected: 출력 없이 종료(코드 0). 화면은 아직 라우트에 연결되지 않았지만 `include: ["src"]` 라서 검사된다.

- [ ] **Step 6: 커밋**

```bash
git add admin_web/src/components/market/VerifyStockPicker.tsx admin_web/src/components/market/VerifyCards.tsx admin_web/src/components/market/VerifyTables.tsx admin_web/src/pages/MarketVerify.tsx
git commit -m "feat(admin_web): 데이터 검증 화면 — 종목 검색·기준일·우리 값 카드·외부 링크·비교 안내

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: 메뉴·라우트 연결, README, 실데이터·브라우저 확인

**Files:**
- Modify: `admin_web/src/App.tsx` (import 16행 아래, 라우트 43행 아래)
- Modify: `admin_web/src/components/Sidebar.tsx` ('시장 데이터' 그룹 33-38행)
- Modify: `README.md` (관리자 웹 목록 150-152행 아래, `### 🗺️ 스크리너 탭` 위)

- [ ] **Step 1: 라우트** — `admin_web/src/App.tsx`
  - `import MarketStatus from './pages/MarketStatus'` 아래에 추가한다.

```tsx
import MarketVerify from './pages/MarketVerify'
```

- `<Route path="market/status" element={<MarketStatus />} />` 아래에 추가한다.

```tsx
        <Route path="market/verify" element={<MarketVerify />} />
```

- [ ] **Step 2: 메뉴** — `admin_web/src/components/Sidebar.tsx`
  - '시장 데이터' 그룹의 `{ to: '/market/status', label: '데이터 현황', icon: '🩺' },` 아래에 추가한다.

```tsx
      { to: '/market/verify', label: '데이터 검증', icon: '🔍' },
```

- [ ] **Step 3: 타입 검사**

Run: `cd admin_web && npx tsc --noEmit`
Expected: 출력 없이 종료(코드 0)

- [ ] **Step 4: README 갱신** — `README.md`
  - `- **시장 데이터 › 데이터 현황**` 항목(그 아래 들여쓴 두 줄 포함) 바로 아래에 추가한다.

```markdown
- **시장 데이터 › 데이터 검증**(`/market/verify`): 종목 하나의 우리 값(기본 정보·최근 5일 일봉·계산값·투자자 순매수·분기/연간 재무·CANSLIM·소속 테마/업종의 그날 순위)을 한 화면에 모으고, 네이버·FnGuide·DART 링크로 외부 값과 눈으로 비교한다. 날짜를 비우면 그 종목의 최신 일봉일이다. 읽기 전용.
  API: stock_api `GET /api/v1/admin/market/verify?ticker=&date=`(관리자 JWT, 형식 오류 422·없는 종목 404 `{code,message}`).
```

- `### 🗺️ 스크리너 탭` 제목 바로 위에 새 절을 추가한다.

````markdown
### 🔍 시장 데이터 표본 점검 (로컬 CLI)

무작위 N 종목의 일봉을 KRX(pykrx, KRX 단독·수정주가)와 비교하고, 내부 계산값이 원천과 맞는지 검사한다. 읽기 전용이고 KIS 는 호출하지 않는다. pykrx 는 운영 의존성이 아니라서 `uv run --with pykrx` 로만 쓴다.

```bash
# 1) 별도 터미널에서 개발 DB 터널 유지(PG 15432 · CH 18123 — backend/.env.development 가 이미 가리킴)
./scripts/dev-db-tunnel.sh

# 2) 점검(기본: 일봉 최신일, 30종목, 보고서 ./spot_check_<date>.md)
cd backend && uv run --with pykrx python -m apps.collector.verify.spot_check --n 30 [--date YYYY-MM-DD] [--seed S] [--out PATH]
```

- **외부:** 우리 일봉은 KRX+넥스트레이드 통합 시세다. 그래서 고가≥·저가≤·거래량≥ 이면 정상이고, 거래량이 같으면(NXT 미상장) OHLC 도 같아야 한다. 분류는 일치·통합 정상·위반·KRX 없음·오류다. pykrx 의 "KRX 로그인 실패" 경고는 무시해도 된다(개별 종목 OHLCV 는 로그인 없이 된다).
- **내부:**
  - (a) market_stock_daily 종가 = 일봉 종가
  - (b) 1일 등락 = 직전 봉 대비 재계산
  - (c) 테마·업종 1일 평균 = 구성 종목 평균(거래정지 제외)
  - (d) 같은 이름 그룹(경고)
  - 테마 소속·거래정지는 현재 PG 값이다. 그래서 구성 수가 다르면 "구성 변경 추정"(경고)으로 둔다.
- **종료 코드:** 위반·불일치가 있으면 1, 경고만 있으면 0, 일봉이 없으면 2.
- 보고서 파일은 커밋하지 않는다.
````

- [ ] **Step 5: 백엔드 전체 테스트**

Run: `cd backend && uv run pytest -p no:cacheprovider`
Expected: failed 0

- [ ] **Step 6: 실데이터 확인(로컬 터널, 커밋 안 함)**
  - 터널이 열려 있는지 확인한다(`./scripts/dev-db-tunnel.sh` 를 별도 터미널에서 실행).
  - 보고서는 저장소 밖에 쓴다.

```bash
cd backend && uv run --with pykrx python -m apps.collector.verify.spot_check --n 30 --seed 1 --out "$TMPDIR/spot_check.md"
```

  - Expected:
    - 요약 두 줄과 `보고서: …` 가 출력된다.
    - 외부 분류는 대부분 `일치` 또는 `통합 정상` 이다.
    - 이름 중복에 업종 "의료·정밀기기" 가 보인다(알려진 사례 — 고치지 않는다).
  - `위반`·`불일치` 가 나오면 보고서의 표를 보고 원인을 기록한다(수집 기준 J/UN 차이, 재계산 누락 등). 이 태스크에서 데이터를 고치지 않는다.
  - KRX 가 막혀 전부 `오류` 면 pykrx 쪽 문제이므로 기록만 한다.

- [ ] **Step 7: 브라우저 확인(데스크톱 + 모바일 390px)**
  - 로컬 서버를 띄운다.
    - `cd backend && uv run uvicorn apps.stock_api.main:app --port 8002`
    - auth 8001
    - `cd admin_web && npm run dev`
  - 관리자로 로그인해 사이드바 **시장 데이터 › 데이터 검증** 을 연다.
  - `005930` 검색 → 선택. 확인할 것:
    - 기준일이 채워지는지, 카드 8개가 보이는지
    - 링크 5개가 새 탭으로 열리는지
    - 일봉 카드에 비교 안내 문구가 있는지
  - `293490`(NXT 미상장)도 같은 방식으로 확인한다.
  - 날짜를 바꾸면 주소가 `?ticker=…&date=…` 로 바뀌고 다시 조회되는지, "최신일" 버튼을 확인한다.
  - 6자리 코드를 치고 Enter 를 누르면 바로 조회되는지 확인한다. 없는 코드(`999999`)면 "종목을 찾을 수 없어요" 가 나와야 한다.
  - 모바일 폭(390px)에서 확인한다.
    - 페이지 가로 스크롤이 없어야 한다(`document.documentElement.scrollWidth <= innerWidth`).
    - 표는 카드 안에서만 스크롤된다.
  - 콘솔 오류 0개(`read_console_messages`)

- [ ] **Step 8: 커밋**

```bash
git add admin_web/src/App.tsx admin_web/src/components/Sidebar.tsx README.md
git commit -m "feat(admin_web): '시장 데이터 › 데이터 검증' 메뉴·라우트 + README(검증 화면·표본 점검 실행법)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## 셀프 리뷰 체크(작성자 확인 완료)

- **응답 키 일치:** spec 의 응답 예 = Task 3 `test_full_report_shape` 의 키 순서 = Task 5 `VerifyReport` 필드다.
  - `notes` 키(`date, profile, bars, computed, investor, fundamentals, canslim, memberships`) = `VerifySection` 이다.
- **CANSLIM 컬럼:** `CANSLIM_COLS`(26개) = `VerifyCanslim` 필드 = `clickhouse_canslim.py` DDL 에서 date·ticker·market·sector_m·close·ingested_at 을 뺀 것이다.
- **판정 상수:** checks 판정 상수 5개 = spot_check `_LABEL` 키다. 종료 코드 규칙은 spec·checks.exit_code·README 에서 같다.
- **TS 컴포넌트 이름:** 라우터의 `verify`, 서비스의 `build/normalize_ticker/parse_date/links`, 컴포넌트 export(`VerifyCard, Empty, ProfileCard, ComputedCard, InvestorCard, CanslimCard, LinksCard, BarsCard, FundamentalsCard, MembershipsCard`)가 import 와 맞다.
- **실행 검증:** 작성 시점에 이 계획의 코드 블록을 임시 worktree(저장소 밖)에 그대로 적용해 확인했다.
  - 신규 테스트 47개 통과(13 + 11 + 17 + 6), 백엔드 전체 failed 0
  - `npx tsc --noEmit` 통과, pykrx 컬럼 실측 일치
