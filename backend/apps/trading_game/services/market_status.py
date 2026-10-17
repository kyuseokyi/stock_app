"""종목·시장 장운영 상태 — VI·거래정지·서킷브레이크·시장임시정지·사이드카.

시세 데몬(run_game_ws)이 KIS 장운영정보(H0STMKO0) 이벤트를 apply_event 로 상태에 반영해
Redis stock:status:{ticker} 에 저장하고, 바뀌면 같은 이름 채널로 발행한다. tick_listener 가 채널을
WS(type=market_status)로 중계, 주문·청산 라우터와 공개 REST 는 read_status 로 조회한다.

코드표(KIS 포털 [실시간-049] 국내주식 장운영정보):
- 장운영구분코드 164 시장임시정지 / 174·184 서킷브레이크 발동·개시, 182 서킷브레이크 장중동시마감,
  175·185 서킷브레이크 해제 / 387·397 사이드카 매도·매수 발동, 388·398 해제 / 112 장개시 / 129 장마감
- 거래정지여부 Y·N, 종목상태구분코드 58 = 거래정지 지정 종목
- VI적용구분코드 Y·N, 시간외단일가VI적용구분코드 Y·N

이벤트로만 오는 상태라 '해제' 를 놓치면 영영 켜져 있게 된다 — 상태마다 최대 지속 시간을 두고
지나면 꺼진 것으로 본다(VI 5분, 서킷브레이크·시장임시정지 40분, 사이드카 10분, 거래정지는 날짜가 바뀌면).
조회 실패·키 없음은 NORMAL(fail-open) — 상태 기능 장애가 주문을 막지 않는다.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
KEY_TTL_SECONDS = 24 * 3600

VI_MAX_SEC = 5 * 60
CB_MAX_SEC = 40 * 60
PAUSE_MAX_SEC = 40 * 60
SIDECAR_MAX_SEC = 10 * 60

_CB_ON = {"174", "182", "184"}
_CB_OFF = {"175", "185"}
_PAUSE_ON = {"164"}
_SIDECAR_ON = {"387", "397"}
_SIDECAR_OFF = {"388", "398"}
_OPEN = "112"   # 장개시 — 임시정지·서킷브레이크가 남아 있으면 해제로 본다
_CLOSE = "129"  # 장마감 — 장중 상태를 모두 정리

NORMAL = "NORMAL"
HALTED = "HALTED"
CIRCUIT_BREAKER = "CIRCUIT_BREAKER"
MARKET_PAUSED = "MARKET_PAUSED"
VI = "VI"
SIDECAR = "SIDECAR"

# 사용자에게 그대로 보이는 문구(배너·주문 거부) — 이유와 언제 다시 되는지를 한 문장에
MESSAGES = {
    CIRCUIT_BREAKER: "시장이 급변해 서킷브레이커가 발동됐어요. 주식시장 전체 거래가 잠시 멈췄고, 재개되면 다시 거래할 수 있어요.",
    MARKET_PAUSED: "주식시장 전체 거래가 잠시 멈췄어요. 재개되면 다시 거래할 수 있어요.",
    VI: "주가가 크게 움직여 변동성 완화장치(VI)가 발동됐어요. 약 2분 뒤 거래가 다시 시작돼요.",
    SIDECAR: "사이드카가 발동돼 프로그램 매매가 5분간 멈췄어요. 일반 주문은 그대로 할 수 있어요.",
}
# 주문·청산을 막는 상태. 사이드카는 프로그램 매매만 멈추고 일반 체결은 계속되므로 안내만
BLOCKING = frozenset({HALTED, CIRCUIT_BREAKER, MARKET_PAUSED, VI})


def status_key(ticker: str) -> str:
    return f"stock:status:{ticker}"


def _kst_day(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, KST).date().isoformat()


def _set(state: dict, flag: str, on: bool, now: float) -> None:
    if on and not state.get(flag):
        state[f"{flag}_since"] = now
    if not on:
        state.pop(f"{flag}_since", None)
    state[flag] = on


def apply_event(prev: dict | None, ev: dict, now: float) -> dict:
    """장운영정보 이벤트 1건을 상태에 반영한 새 상태(원본 불변)."""
    state = dict(prev or {})
    trht = ev.get("trht_yn", "")
    stat = ev.get("iscd_stat_cls_code", "")
    if trht == "Y" or stat == "58":
        _set(state, "halted", True, now)
        state["halt_reason"] = ev.get("tr_susp_reas_cntt", "") or state.get("halt_reason", "")
        state["halt_day"] = _kst_day(now)
    elif trht == "N":
        _set(state, "halted", False, now)
        state.pop("halt_reason", None)
        state.pop("halt_day", None)

    vi, ovtm_vi = ev.get("vi_cls_code", ""), ev.get("ovtm_vi_cls_code", "")
    if "Y" in (vi, ovtm_vi):
        _set(state, "vi", True, now)
    elif vi == "N" or ovtm_vi == "N":
        _set(state, "vi", False, now)

    mkop = ev.get("mkop_cls_code", "")
    if mkop in _CB_ON:
        _set(state, "cb", True, now)
    elif mkop in _CB_OFF:
        _set(state, "cb", False, now)
        _set(state, "paused", False, now)
    if mkop in _PAUSE_ON:
        _set(state, "paused", True, now)
    if mkop in _SIDECAR_ON:
        _set(state, "sidecar", True, now)
    elif mkop in _SIDECAR_OFF:
        _set(state, "sidecar", False, now)
    if mkop == _OPEN:
        _set(state, "cb", False, now)
        _set(state, "paused", False, now)
    if mkop == _CLOSE:
        for flag in ("cb", "paused", "sidecar", "vi"):
            _set(state, flag, False, now)
    state["updated_at"] = now
    return state


def _active(state: dict, flag: str, max_sec: float, now: float) -> bool:
    if not state.get(flag):
        return False
    since = state.get(f"{flag}_since")
    return since is None or now - float(since) <= max_sec


def derive(state: dict | None, now: float) -> dict:
    """저장 상태 → {state, message, blocking, since}. 최대 지속 시간이 지난 상태는 꺼진 것으로 본다."""
    state = state or {}
    current, since = NORMAL, None
    if state.get("halted") and state.get("halt_day") == _kst_day(now):
        current, since = HALTED, state.get("halted_since")
    elif _active(state, "cb", CB_MAX_SEC, now):
        current, since = CIRCUIT_BREAKER, state.get("cb_since")
    elif _active(state, "paused", PAUSE_MAX_SEC, now):
        current, since = MARKET_PAUSED, state.get("paused_since")
    elif _active(state, "vi", VI_MAX_SEC, now):
        current, since = VI, state.get("vi_since")
    elif _active(state, "sidecar", SIDECAR_MAX_SEC, now):
        current, since = SIDECAR, state.get("sidecar_since")
    if current == HALTED:
        reason = (state.get("halt_reason") or "").strip()
        message = ("이 종목은 지금 거래가 정지됐어요." + (f" (사유: {reason})" if reason else "")
                   + " 정지가 풀리면 다시 거래할 수 있어요.")
    else:
        message = MESSAGES.get(current, "")
    return {
        "state": current,
        "message": message,
        "blocking": current in BLOCKING,
        "since": datetime.fromtimestamp(float(since), KST).isoformat() if since else None,
    }


async def save_event(redis, ticker: str, ev: dict, now: float) -> dict | None:
    """이벤트 반영·저장. 보이는 상태(derive)가 바뀌면 채널로 발행하고 그 payload 를 돌려준다(아니면 None)."""
    raw = await redis.get(status_key(ticker))
    prev = json.loads(raw) if raw else None
    before = derive(prev, now)
    state = apply_event(prev, ev, now)
    await redis.set(status_key(ticker), json.dumps(state), ex=KEY_TTL_SECONDS)
    after = derive(state, now)
    if (after["state"], after["message"]) == (before["state"], before["message"]):
        return None
    payload = {"type": "market_status", "ticker": ticker, **after}
    await redis.publish(status_key(ticker), json.dumps(payload, ensure_ascii=False))
    return payload


async def read_status(redis, ticker: str, now: float) -> dict:
    """현재 상태(derive). Redis 오류·깨진 값·키 없음은 NORMAL — 주문을 막지 않는다(fail-open)."""
    try:
        raw = await redis.get(status_key(ticker))
        return derive(json.loads(raw) if raw else None, now)
    except Exception:  # noqa: BLE001
        log.warning("장운영 상태 조회 실패 — NORMAL 로 진행 ticker=%s", ticker, exc_info=True)
        return derive(None, now)
