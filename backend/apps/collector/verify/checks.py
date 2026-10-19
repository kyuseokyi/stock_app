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
