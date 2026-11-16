"""키움 일봉 실측 도구 — KRX / `_NX` / `_AL` 일봉을 CH `daily_prices`(KIS UN 통합) FINAL 과 비교.

실행(상용 서버에서만 — 키움은 상용 서버 IP 만 허용):
    docker compose -f docker-compose.prod.yml run --rm celery_worker python -m apps.collector.kiwoom.probe
    옵션: --ticker 005930 --date 20260805 --non-nxt 293490

- 키가 없으면 안내만 출력하고 종료(코드 0, 호출 없음).
- 앱키·시크릿·토큰 값은 절대 출력하지 않는다.
- CH 연결이 안 되면 CH 줄만 "조회 불가"로 두고 계속한다. 조회마다 오류를 잡아 오류코드를 보여 주고 다음으로 넘어간다.
- 마지막에 docs/kiwoom_setup_and_dev_spec.md 에 붙여 넣을 요약 한 블록을 출력한다.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime
from typing import Callable

from apps.collector.kiwoom.client import KST, KiwoomApiError, KiwoomClient, KiwoomError
from apps.collector.kiwoom.normalize import SUFFIX_NXT, SUFFIX_SOR, daily_row
from shared.kiwoom_config import get_kiwoom_config

NOT_CONFIGURED_MSG = ("키움 키가 설정되지 않았어요 — KIWOOM_APP_KEY·KIWOOM_APP_SECRET 을 "
                      "상용 서버 env 에 넣은 뒤 다시 실행하세요. (호출하지 않고 종료)")
NO_ROW = "행 없음"
CH_UNAVAILABLE = "조회 불가"
_MARKETS = (("코스피", "0"), ("코스닥", "10"))  # ka10099 mrkt_tp

Bar = dict  # daily_row 모양(date·open·high·low·close·volume·trading_value)


# ------------------------------------------------------------------ 인자
def parse_yyyymmdd(s: str) -> date:
    return datetime.strptime(s, "%Y%m%d").date()


def _yyyymmdd(s: str) -> str:
    try:
        parse_yyyymmdd(s)
    except ValueError as e:
        raise argparse.ArgumentTypeError("YYYYMMDD 형식이어야 해요") from e
    return s


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="python -m apps.collector.kiwoom.probe",
        description="키움 일봉(KRX/_NX/_AL)을 CH daily_prices(KIS UN) 와 비교하는 실측 도구(상용 서버 전용)",
    )
    p.add_argument("--ticker", default="005930", help="NXT 상장 비교 종목 (기본 005930)")
    p.add_argument("--date", type=_yyyymmdd, default="20260805", help="비교 기준일 YYYYMMDD (기본 20260805)")
    p.add_argument("--non-nxt", dest="non_nxt", default="293490", help="NXT 미상장 종목 (기본 293490)")
    return p.parse_args(argv)


# ------------------------------------------------------------------ 순수 함수
def pick_row(raw_rows: list[dict], yyyymmdd: str) -> Bar | None:
    """base_dt 부터 과거로 오는 여러 행 중 정확히 그날 행만 정규화해 돌려준다."""
    for raw in raw_rows:
        if str(raw.get("dt", "")).strip() == yyyymmdd:
            return daily_row(raw)
    return None


def compare(a, b) -> dict | None:
    """두 일봉의 종가·거래량 일치 여부. 어느 한쪽이 값이 아니면 None(비교 불가)."""
    if not isinstance(a, dict) or not isinstance(b, dict):
        return None
    return {"close": float(a["close"]) == float(b["close"]), "volume": int(a["volume"]) == int(b["volume"])}


def mark(ok: bool) -> str:
    return "✅" if ok else "❌"


def _num(v) -> str:
    return "-" if v is None else f"{int(v):,}"


def _fmt_row(label: str, r) -> str:
    if not isinstance(r, dict):
        return f"{label:<24} {r}"
    cells = [_num(r.get(k)) for k in ("open", "high", "low", "close", "volume", "trading_value")]
    return f"{label:<24} " + " ".join(f"{c:>15}" for c in cells)


def _cmp_text(c: dict | None) -> str:
    if c is None:
        return "비교 불가"
    return f"종가 {mark(c['close'])} · 거래량 {mark(c['volume'])}"


def _short(r) -> str:
    if isinstance(r, dict):
        return f"종가 {_num(r['close'])} 거래량 {_num(r['volume'])}"
    return str(r)


# ------------------------------------------------------------------ 조회(실패는 사유 문자열로)
def _fetch_bar(client, stk_cd: str, yyyymmdd: str):
    try:
        row = pick_row(client.get_daily_chart(stk_cd, yyyymmdd), yyyymmdd)
    except KiwoomApiError as e:
        return f"오류 {e.code}: {e.msg}"
    except KiwoomError as e:
        return f"오류: {e}"
    return row if row is not None else NO_ROW


def ch_daily_bar(ticker: str, d: date) -> Bar | None:
    """CH daily_prices FINAL 하루치(KIS UN→J 수집값). 거래대금 컬럼은 없다."""
    from shared.clickhouse_schema import CLICKHOUSE_DB, get_client  # 키 없을 때 CH 를 건드리지 않게 지연 import

    rows = get_client().query(
        f"SELECT open, high, low, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
        "WHERE ticker = %(t)s AND date = %(d)s",
        parameters={"t": ticker, "d": d},
    ).result_rows
    if not rows:
        return None
    o, h, lo, c, v = rows[0]
    return {"open": float(o), "high": float(h), "low": float(lo), "close": float(c), "volume": int(v),
            "trading_value": None}


def _fetch_ch(ch_fetch: Callable, ticker: str, d: date):
    try:
        bar = ch_fetch(ticker, d)
    except Exception as e:  # noqa: BLE001 — CH 장애는 이 줄만 "조회 불가"로 두고 계속
        return f"{CH_UNAVAILABLE} ({type(e).__name__})"
    return bar if bar is not None else NO_ROW


# ------------------------------------------------------------------ 실행
def run(args: argparse.Namespace, *, client, ch_fetch: Callable, out: Callable[[str], None]) -> int:
    t, dt, non_nxt = args.ticker, args.date, args.non_nxt
    d = parse_yyyymmdd(dt)

    # 1) 토큰
    try:
        info = client.get_token_info()
    except KiwoomError as e:
        out(f"[FAIL] 토큰 발급 실패 — {e}")
        return 1
    exp = info.expires_at.astimezone(KST).strftime("%Y-%m-%d %H:%M") if info.expires_at else "알 수 없음"
    out(f"[OK] 토큰 {'캐시' if info.cached else '발급'} — 만료 {exp}")

    # 2) NXT 상장 종목: KRX / _NX / _AL / CH
    out("")
    out(f"== {t} {d.isoformat()} 일봉 비교 (수정주가) ==")
    out(f"{'구분':<24} " + " ".join(f"{h:>15}" for h in ("시가", "고가", "저가", "종가", "거래량", "거래대금(원)")))
    krx = _fetch_bar(client, t, dt)
    nxt = _fetch_bar(client, f"{t}{SUFFIX_NXT}", dt)
    sor = _fetch_bar(client, f"{t}{SUFFIX_SOR}", dt)
    ch = _fetch_ch(ch_fetch, t, d)
    for label, r in ((f"KRX ({t})", krx), (f"NXT ({t}{SUFFIX_NXT})", nxt), (f"SOR ({t}{SUFFIX_SOR})", sor),
                     ("CH daily_prices FINAL", ch)):
        out(_fmt_row(label, r))
    al_vs_ch = compare(sor, ch)
    out(f"_AL vs CH(KIS UN): {_cmp_text(al_vs_ch)}")
    sum_ok = None
    if all(isinstance(r, dict) for r in (krx, nxt, sor)):
        sum_ok = int(krx["volume"]) + int(nxt["volume"]) == int(sor["volume"])
        out(f"KRX+NXT 거래량 합 {_num(krx['volume'] + nxt['volume'])} = _AL 거래량 {_num(sor['volume'])}: "
            f"{mark(sum_ok)}")
    else:
        out("KRX+NXT 거래량 합 = _AL: 비교 불가")

    # 3) NXT 미상장 종목
    out("")
    out(f"== NXT 미상장 {non_nxt} ==")
    nn_sor = _fetch_bar(client, f"{non_nxt}{SUFFIX_SOR}", dt)
    nn_krx = _fetch_bar(client, non_nxt, dt)
    out(f"{non_nxt}{SUFFIX_SOR}: {_short(nn_sor)}")
    out(f"{non_nxt} (접미사 없음): {_short(nn_krx)}")

    # 4) ka10099 종목 수
    out("")
    out("== ka10099 종목 수 ==")
    counts: list[str] = []
    for name, tp in _MARKETS:
        try:
            rows = client.list_stocks(tp)
        except KiwoomError as e:
            line = f"{name} 오류 {getattr(e, 'code', '')}: {getattr(e, 'msg', e)}"
        else:
            y = sum(1 for r in rows if str(r.get("nxtEnable", "")).strip().upper() == "Y")
            line = f"{name} {len(rows)}개 (nxtEnable=Y {y}개)"
        out(line)
        counts.append(line)

    # 5) 문서 기록용 요약
    out("")
    out("---- 요약 (docs/kiwoom_setup_and_dev_spec.md 실측 결과에 붙여 넣기) ----")
    out(f"- 실측 {datetime.now(KST).strftime('%Y-%m-%d %H:%M')} KST, 종목 {t}, 기준일 {d.isoformat()}")
    out(f"- `_AL` vs CH(KIS UN): {_cmp_text(al_vs_ch)}")
    out(f"- KRX+NXT 거래량 합 = `_AL`: {'비교 불가' if sum_ok is None else mark(sum_ok)}")
    out(f"- NXT 미상장 {non_nxt}: `_AL` → {_short(nn_sor)} / 접미사 없음 → {_short(nn_krx)}")
    out(f"- ka10099: {', '.join(counts)}")
    out("----")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    cfg = get_kiwoom_config()
    if not cfg.is_configured:
        print(NOT_CONFIGURED_MSG)
        return 0
    client = KiwoomClient(cfg)
    try:
        return run(args, client=client, ch_fetch=ch_daily_bar, out=print)
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
