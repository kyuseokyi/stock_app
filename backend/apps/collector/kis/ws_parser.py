"""KIS 실시간 체결(H0UNCNT0 통합 · H0STCNT0 KRX · H0NXCNT0 NXT) 수신 문자열 파서.

세 TR 은 공식 예제(koreainvestment/open-trading-api examples_llm/domestic_stock/
ccnl_total·ccnl_krx·ccnl_nxt) 기준 필드 순서·개수(47)가 동일하다(21번 이름만 다름).

데이터 프레임 형식: `{암호화flag}|{tr_id}|{건수}|{필드^필드^...}` (평문 flag='0').
건수>1 이면 고정 길이(공식 47필드) 레코드가 연속되므로 레코드 단위로 분해한다.
제어 프레임(PINGPONG·구독응답)은 JSON('{' 시작)이라 None 을 반환한다.
"""
from __future__ import annotations

# 수용 TR: 통합(UN)·KRX·NXT 실시간 체결가 — 레이아웃 동일.
TICK_TR_IDS = frozenset({"H0UNCNT0", "H0STCNT0", "H0NXCNT0"})

# 체결 TR 공통 필드 인덱스(0-based). 공식 TR 출력 순서 기준.
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
    """체결 TR(TICK_TR_IDS) 데이터 프레임이면 tick dict 리스트, 그 외(제어/깨짐)는 None."""
    if raw is None:
        return None
    raw = raw.strip()
    if not raw or raw.startswith("{"):  # 빈 값 또는 제어 프레임(JSON)
        return None
    parts = raw.split("|")
    if len(parts) < 4:
        return None
    _flag, tr_id, count_str, payload = parts[0], parts[1], parts[2], parts[3]
    if tr_id not in TICK_TR_IDS:
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


# ---------------------------------------------------------------- 장운영정보(VI·거래정지·서킷브레이크·사이드카)
# H0STMKO0(KRX)·H0UNMKO0(통합)·H0NXMKO0(NXT). 공식 명세(KIS 포털 [실시간-049]) 필드 순서:
# 종목코드, 거래정지여부, 거래정지사유, 장운영구분코드, 예상장운영구분코드, 임의연장구분코드,
# 동시호가배분처리구분코드, 종목상태구분코드, VI적용구분코드, 시간외단일가VI적용구분코드, 거래소구분코드(11개).
# 통합 TR 문서는 종목코드를 빼고 10개로 적고 있어, 개수로 판별한다(10개면 종목코드 없음).
STATUS_TR_IDS = frozenset({"H0STMKO0", "H0UNMKO0", "H0NXMKO0"})
_STATUS_KEYS = (
    "trht_yn", "tr_susp_reas_cntt", "mkop_cls_code", "antc_mkop_cls_code", "mrkt_trtm_cls_code",
    "divi_app_cls_code", "iscd_stat_cls_code", "vi_cls_code", "ovtm_vi_cls_code", "exch_cls_code",
)


def frame_tr_id(raw: str | None) -> str | None:
    """데이터 프레임(`flag|tr_id|건수|payload`)의 tr_id. 제어 프레임(JSON)·깨진 값은 None."""
    if not raw:
        return None
    raw = raw.strip()
    if raw.startswith("{"):
        return None
    parts = raw.split("|", 3)
    return parts[1] if len(parts) == 4 else None


def parse_status_message(raw: str, ticker: str | None = None) -> list[dict] | None:
    """장운영정보 데이터 프레임 → [{ticker, trht_yn, mkop_cls_code, vi_cls_code, ...}]. 그 외는 None.

    ticker: 구독 종목(종목코드 필드가 없는 10필드 형식일 때 채운다). 11필드면 첫 필드가 종목코드여야 한다.
    """
    if frame_tr_id(raw) not in STATUS_TR_IDS:
        return None
    _flag, _tr, count_str, payload = raw.strip().split("|", 3)
    try:
        count = int(count_str)
    except ValueError:
        return None
    fields = payload.split("^")
    if count <= 0 or len(fields) % count != 0:
        return None
    per = len(fields) // count
    if per not in (len(_STATUS_KEYS), len(_STATUS_KEYS) + 1):
        return None
    out: list[dict] = []
    for i in range(count):
        rec = fields[i * per:(i + 1) * per]
        if per == len(_STATUS_KEYS) + 1:
            code, rec = rec[0].strip(), rec[1:]
            if ticker and code and code != ticker:
                return None  # 필드 순서가 예상과 다르면 잘못 읽느니 버린다
        else:
            code = ticker or ""
        item = {"ticker": code}
        item.update({k: v.strip() for k, v in zip(_STATUS_KEYS, rec)})
        out.append(item)
    return out
