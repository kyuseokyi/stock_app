"""시장 전체 투자자별(외국인·기관·연기금) 순매수 상위 집계 — 시황 탭 수급 전광판용.

1순위 키움 ka10058(KIWOOM_APP_KEY/SECRET 이 있을 때만 — 상용 서버) → 2순위 pykrx(KRX 로그인 env KRX_ID/KRX_PW 가
있을 때만) → 3순위 ClickHouse investor_daily(KIS, 20:30 적재).
- 키움에서 빠진(실패·빈) 투자자는 **같은 날** pykrx 로만 채운다(투자자별 혼합). 날짜가 다를 수 있는 KIS 와는 섞지 않는다.
  혼합 뒤에도 외국인·기관 중 하나가 비면 전체를 KIS 로 넘긴다. 최상위 source 는 외국인·기관이 모두 키움이면 "kiwoom",
  아니면 "pykrx"(투자자별 출처는 로그에 남긴다 — 응답 구조는 그대로).
KIS 폴백은 연기금이 없고, 기준일이 전 거래일일 수 있다 → 결과에 source·date 를 담는다.
설계: docs/superpowers/specs/2026-11-17-kiwoom-investor-flow-design.md
이 모듈은 수집·집계만 한다(Redis 저장·AI 해설은 상위 태스크/서비스 담당).

금액 단위는 모두 원(KRW)으로 통일한다.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from shared.config import krx_credentials

log = logging.getLogger(__name__)

TOP_N = 10  # 응답에 싣는 상위 개수
POOL_N = 50  # 동반 순매수 계산용으로 넉넉히 받는 상위 개수
LOOKBACK_DAYS = 14  # KIS 폴백: 기준일 이전 이 기간 안에서 최신 적재일을 찾는다

PYKRX_MARKETS = ("KOSPI", "KOSDAQ")
PYKRX_INVESTORS = {"foreign": "외국인", "institution": "기관합계", "pension": "연기금"}
INVESTORS = tuple(PYKRX_INVESTORS)  # foreign, institution, pension
KIWOOM_MARKETS = ("kospi", "kosdaq")
KIWOOM_MAX_PAGES = 2  # 시장·투자자당 연속조회 상한(POOL_N 50 을 채우면 충분 — 쪽당 행 수는 probe 로 확인)

# ⚠️ 미검증: KIS inquire-investor 의 *_ntby_tr_pbmn(순매수 거래대금) 단위.
# 저장소 안에는 근거가 없다(docs/superpowers/plans/2026-10-19-market-data-verification.md:48 "단위는 확인되지 않아 변환하지 않는다").
# KIS 문서상 거래대금(pbmn) 필드는 백만원 단위로 알려져 있어 ×1,000,000 으로 원 환산한다.
# 검증 방법: 같은 날짜 |frgn_amt × 1e6 / frgn_qty| 가 daily_prices 종가 근처면 백만원이 맞다(종가 ×1e6 근처면 원 단위 → 1 로 고칠 것).
KIS_AMT_TO_WON = 1_000_000


def _flow(ticker: str, name: str, amount) -> dict:
    return {"ticker": ticker, "name": name, "net_amount": float(amount)}


def _top(rows: list[dict], n: int) -> list[dict]:
    """순매수(양수)만 금액 내림차순 상위 n."""
    return sorted((r for r in rows if r["net_amount"] > 0), key=lambda r: r["net_amount"], reverse=True)[:n]


def double_buy(foreign: list[dict], institution: list[dict], n: int = TOP_N) -> list[dict]:
    """외국인·기관이 모두 순매수(양수)한 종목 — 두 금액 합계 내림차순 상위 n."""
    inst = {r["ticker"]: r for r in institution if r["net_amount"] > 0}
    out = [
        {"ticker": f["ticker"], "name": f["name"] or inst[f["ticker"]]["name"],
         "foreign_amount": f["net_amount"], "institution_amount": inst[f["ticker"]]["net_amount"]}
        for f in foreign if f["net_amount"] > 0 and f["ticker"] in inst
    ]
    out.sort(key=lambda r: r["foreign_amount"] + r["institution_amount"], reverse=True)
    return out[:n]


# --- 2순위: pykrx ------------------------------------------------------------- #
def _pykrx_rows(df) -> list[dict] | None:
    """pykrx DataFrame(인덱스=티커) → [{ticker,name,net_amount}]. 필요한 컬럼이 없으면 None.

    컬럼명 '종목명'·'순매수거래대금'(원) 은 설치본 pykrx 소스 docstring 기준 — 실호출 미검증.
    """
    if df is None or getattr(df, "empty", True):
        return []
    cols = list(df.columns)
    if "종목명" not in cols or "순매수거래대금" not in cols:
        log.warning("pykrx 순매수 응답에 예상 컬럼 없음: %s", cols)
        return None
    return [_flow(str(t), str(r["종목명"]), r["순매수거래대금"]) for t, r in df.iterrows()]


def fetch_pykrx(day: date, investors: tuple[str, ...] | list[str] | None = None) -> dict | None:
    """KRX 로그인 정보가 없으면 pykrx 를 import 하지도 않고 None.

    pykrx 1.2.9 는 import 시점에 KRX 로그인을 시도하고 stdout 에 출력하므로 반드시 함수 안에서 지연 import 한다.
    investors: 받을 투자자 키(기본 셋 다) — 키움에서 빠진 투자자만 채울 때 일부만 부른다.
    반환: {"date","source":"pykrx","foreign":[상위 POOL_N],"institution":[...],"pension":[...]} 또는 None.
    """
    keys = tuple(investors) if investors else INVESTORS
    if krx_credentials() is None:
        return None
    try:
        from pykrx import stock  # 지연 import — 위 주석 참고
    except Exception as exc:  # noqa: BLE001
        log.warning("pykrx import 실패: %s", exc)
        return None
    d = day.strftime("%Y%m%d")
    out: dict = {"date": day.isoformat(), "source": "pykrx"}
    try:
        for key in keys:
            investor = PYKRX_INVESTORS[key]
            rows: list[dict] = []
            for market in PYKRX_MARKETS:
                parsed = _pykrx_rows(stock.get_market_net_purchases_of_equities(d, d, market, investor))
                if parsed is None:
                    return None
                rows.extend(parsed)
            out[key] = _top(rows, POOL_N)
    except Exception as exc:  # noqa: BLE001 — 로그인 실패·응답 형식 변경 등
        log.warning("pykrx 투자자 순매수 조회 실패: %s", exc)
        return None
    if not any(out[k] for k in keys):
        return None
    return out


# --- 1순위: 키움 ka10058 ------------------------------------------------------ #
def fetch_kiwoom(day: date, *, session=None, client_factory=None) -> dict | None:
    """키움 키가 없으면 클라이언트·Redis 를 건드리지 않고 None(개발 서버는 기존 순서 그대로).

    투자자마다 코스피·코스닥 순매수 행을 받아 보통주 유니버스로 거른 뒤(ETF·스팩·우선주 제외, KIS 폴백과 같은 기준)
    금액 내림차순 상위 POOL_N. 실패·빈 투자자는 키를 빼고 돌려준다(상위에서 pykrx 로 채움).
    등록 IP 밖(8010)·키 미설정이면 남은 호출을 하지 않는다.
    반환: {"date","source":"kiwoom", <성공한 투자자>: [...]} 또는 None(하나도 없을 때).
    """
    from shared.kiwoom_config import get_kiwoom_config

    cfg = get_kiwoom_config()
    if not cfg.is_configured:
        return None
    from apps.collector.kiwoom.client import KiwoomClient, KiwoomIpError, KiwoomNotConfigured
    from apps.collector.kiwoom.normalize import KIWOOM_FLOW_QTY_PRICE_RATIO, implied_amt_unit, investor_flow_row

    try:
        client = client_factory() if client_factory else KiwoomClient(cfg)
    except Exception as exc:  # noqa: BLE001
        log.warning("키움 클라이언트 생성 실패: %s", exc)
        return None
    d = day.strftime("%Y%m%d")
    got: dict[str, list[dict]] = {}
    try:
        for key in INVESTORS:
            try:
                by_ticker: dict[str, dict] = {}
                for market in KIWOOM_MARKETS:
                    for raw in client.investor_daily_top(key, d, d, market, max_pages=KIWOOM_MAX_PAGES):
                        row = investor_flow_row(raw)
                        if row is not None:
                            by_ticker.setdefault(row["ticker"], row)
                got[key] = list(by_ticker.values())
            except (KiwoomIpError, KiwoomNotConfigured) as exc:
                log.warning("키움 투자자 순매수 호출 불가 — 남은 호출 중단: %s", exc)
                break
            except Exception as exc:  # noqa: BLE001 — 그 투자자만 다음 출처로
                log.warning("키움 %s 순매수 조회 실패: %s", key, exc)
    finally:
        close = getattr(client, "close", None)
        if close is not None:
            close()

    all_rows = [r for rows in got.values() for r in rows]
    if not all_rows:
        return None
    unit = implied_amt_unit(all_rows)
    if unit is not None and unit != KIWOOM_FLOW_QTY_PRICE_RATIO:
        log.warning("키움 ka10058 금액 단위 추정 비율 %s ≠ 예상 %s — 응답 단위가 바뀌었는지 normalize 확인 필요",
                    unit, KIWOOM_FLOW_QTY_PRICE_RATIO)
    names = _universe_names(session, sorted({r["ticker"] for r in all_rows}))
    out: dict = {"date": day.isoformat(), "source": "kiwoom"}
    for key, rows in got.items():
        top = _top([_flow(r["ticker"], names[r["ticker"]], r["net_amount"]) for r in rows if r["ticker"] in names],
                   POOL_N)
        if top:
            out[key] = top
    if not any(k in out for k in INVESTORS):
        return None
    return out


def _fill_from_pykrx(day: date, kw: dict) -> dict | None:
    """키움 결과에서 빠진 투자자만 같은 날 pykrx 로 채운다. 외국인·기관이 둘 다 차야 성공(아니면 None → KIS)."""
    sources = {k: "kiwoom" for k in INVESTORS if kw.get(k)}
    missing = [k for k in INVESTORS if not kw.get(k)]
    merged = {"date": kw["date"], **{k: kw.get(k) or [] for k in INVESTORS}}
    if missing:
        px = fetch_pykrx(day, missing) or {}
        for k in missing:
            if px.get(k):
                merged[k] = px[k]
                sources[k] = "pykrx"
    if not merged["foreign"] or not merged["institution"]:
        log.warning("키움+pykrx 로 외국인·기관을 다 채우지 못함(%s) — KIS 로 넘김", sources)
        return None
    merged["source"] = "kiwoom" if sources.get("foreign") == sources.get("institution") == "kiwoom" else "pykrx"
    if any(v != "kiwoom" for v in sources.values()) or len(sources) < len(INVESTORS):
        log.info("투자자 순매수 출처 혼합: %s", sources)
    return merged


# --- 3순위: ClickHouse investor_daily(KIS) ------------------------------------ #
def fetch_kis_fallback(ch, day: date, session=None) -> dict | None:
    """day 이하 최신 적재일 하나를 골라 외국인·기관 순매수 상위(양수만). 보통주 유니버스로 ETF·스팩·우선주 제외.

    반환: {"date"(실제 사용일),"source":"kis","foreign","institution","pension":[], "double_buy"(전 종목 기준)} 또는 None.
    """
    from shared.clickhouse_schema import CLICKHOUSE_DB

    try:
        picked = ch.query(
            f"SELECT date FROM {CLICKHOUSE_DB}.investor_daily WHERE date <= %(d)s AND date >= %(lo)s "
            "ORDER BY date DESC LIMIT 1",
            parameters={"d": day, "lo": day - timedelta(days=LOOKBACK_DAYS)},
        ).result_rows
        if not picked or picked[0][0] is None:
            return None
        used = picked[0][0]
        rows = ch.query(
            f"SELECT ticker, frgn_amt, orgn_amt FROM {CLICKHOUSE_DB}.investor_daily FINAL WHERE date = %(d)s",
            parameters={"d": used},
        ).result_rows
    except Exception as exc:  # noqa: BLE001
        log.warning("investor_daily 조회 실패: %s", exc)
        return None
    if not rows:
        return None

    names = _universe_names(session, [r[0] for r in rows])
    foreign, institution = [], []
    for ticker, frgn, orgn in rows:
        if ticker not in names:
            continue
        foreign.append(_flow(ticker, names[ticker], (frgn or 0) * KIS_AMT_TO_WON))
        institution.append(_flow(ticker, names[ticker], (orgn or 0) * KIS_AMT_TO_WON))
    out = {
        "date": used.isoformat() if hasattr(used, "isoformat") else str(used),
        "source": "kis",
        "foreign": _top(foreign, POOL_N),
        "institution": _top(institution, POOL_N),
        "pension": [],
        "double_buy": double_buy(foreign, institution),  # 상위 목록이 아니라 전 종목 기준
    }
    if not out["foreign"] and not out["institution"]:
        return None
    return out


def _universe_names(session, tickers: list[str]) -> dict[str, str]:
    """보통주 유니버스(ticker→name). 유니버스가 비면 이름만 붙이고 거르지 않는다."""
    from shared import market_repo

    own = session is None
    if own:
        from shared.database import SyncSessionLocal
        session = SyncSessionLocal()
    try:
        universe = {t: n for t, n, _m in market_repo.analysis_universe(session)}
        if universe:
            return universe
        log.warning("분석 대상 유니버스 비어 있음 — ETF·스팩 거르지 않고 이름만 붙임")
        return {t: n for t, n in market_repo.names_for(session, tickers).items()} or {t: t for t in tickers}
    finally:
        if own:
            session.close()


# --- 진입점 ------------------------------------------------------------------- #
def collect(day: date, *, ch=None, session=None) -> dict | None:
    """키움(설정 시) → pykrx → KIS(CH) 폴백 → 모두 없으면 None.

    반환 키(API 계약과 동일): date, source, foreign_top, institution_top, pension_top, double_buy.
    """
    kw = fetch_kiwoom(day, session=session)
    raw = fetch_pykrx(day) if kw is None else _fill_from_pykrx(day, kw)
    if raw is None:
        if ch is None:
            from shared.clickhouse_schema import get_client
            try:
                ch = get_client()
            except Exception as exc:  # noqa: BLE001
                log.warning("ClickHouse 연결 실패: %s", exc)
                return None
        raw = fetch_kis_fallback(ch, day, session=session)
    if raw is None:
        return None
    pairs = raw.get("double_buy")
    if pairs is None:
        pairs = double_buy(raw["foreign"], raw["institution"])
    return {
        "date": raw["date"],
        "source": raw["source"],
        "foreign_top": raw["foreign"][:TOP_N],
        "institution_top": raw["institution"][:TOP_N],
        "pension_top": raw.get("pension", [])[:TOP_N],
        "double_buy": pairs[:TOP_N],
    }
