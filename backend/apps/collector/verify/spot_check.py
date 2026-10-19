"""시장 데이터 표본 점검 CLI — 외부(KRX 단독, pykrx) 비교 + 내부 일관성 검사 → 마크다운 보고서.

실행(로컬, 개발 DB 터널 scripts/dev-db-tunnel.sh 필요):
    cd backend && uv run --with pykrx python -m apps.collector.verify.spot_check --n 30 [--date YYYY-MM-DD] [--seed S] [--out PATH]

- pykrx 는 운영 의존성이 아니다(pyproject 에 없음) → krx_bar 안에서만 import 한다.
- 읽기 전용. KIS 는 호출하지 않는다.
- 종료 코드: 외부 위반·내부 불일치가 있으면 1, 경고(구성 변경 추정·이름 중복·KRX 없음·조회 오류)만 있으면 0,
  일봉이 아예 없으면 2, 위반·불일치는 없지만 KRX 조회 오류가 표본의 절반을 넘으면 3.
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
ERROR_MAJORITY_MSG = "pykrx·KRX 조회 실패가 표본의 절반을 넘음 — 외부 비교 결과를 믿을 수 없음"
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


def error_majority(result: dict) -> bool:
    """KRX 조회 오류(error)가 표본의 절반을 넘는가."""
    ext = result["external"]
    return bool(ext) and sum(e["status"] == checks.ERROR for e in ext) * 2 > len(ext)


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
        "- 테마 일관성 점검은 최신 거래일 실행을 권장(과거 날짜는 테마 구성 변경으로 '구성 변경 추정'이 많음)",
        "- 그룹 평균 검사의 테마 소속·거래정지는 현재 PG 값이다. 구성 수가 다르면 '구성 변경 추정'(경고)으로 두고 평균은 비교하지 않는다.",
        "", "## 요약", "", "| 항목 | 수 |", "|---|---|",
        *[f"| 외부 {_LABEL[s]} | {c[s]} |" for s in _LABEL],
        f"| 내부 종목 검사 / 불일치 | {c['stocks_checked']} / {c['stock_mismatches']} |",
        f"| 내부 그룹 검사 / 불일치 | {c['groups_checked']} / {c['group_mismatches']} |",
        f"| 구성 변경 추정(경고) | {c['group_drifts']} |",
        f"| 이름 중복(경고) | {c['duplicates']} |",
    ]
    if error_majority(result):
        lines += ["", f"> **경고: {ERROR_MAJORITY_MSG}**"]
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
    code = checks.exit_code(result)
    if code == 0 and error_majority(result):
        print(ERROR_MAJORITY_MSG)
        return 3
    return code


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    sys.exit(main())
