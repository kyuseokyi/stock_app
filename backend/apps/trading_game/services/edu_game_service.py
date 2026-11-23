"""교육용 합성 종가 게임 — 시즌 부트스트랩·상태 조회·하루 1회 제출·일일 정산.

명세: docs/edu_synthetic_daily_game_spec_and_plan.md 2.2·4·6(Step 2)
기존 실시간 게임(game_* 테이블·서비스)과 완전히 분리. 합성 데이터라 REAL_MARKET(시세 비노출) 판정과 무관하다.

잠금 순서(교착 방지): 시즌 → 계좌.
- 제출: 시즌 FOR SHARE → 내 계좌 FOR UPDATE (제출끼리는 막지 않고, 정산 중이면 정산이 끝날 때까지 대기)
- 정산: 시즌 FOR UPDATE → 그 시즌 전체 계좌 FOR UPDATE (한 트랜잭션)
하루 1회 판정은 day_index 기준(KST 날짜 아님) — 관리자가 하루에 여러 봉을 진행해도 봉마다 1회 참가.
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import EduGameAccount, EduGameCandle, EduGameDailyAction, EduGameSeason
from shared.models import User
from apps.trading_game.services import academy_service, reward_service, streak_service
from apps.trading_game.services import edu_synthetic_engine as engine

log = logging.getLogger("trading_game.edu_game")

KST = ZoneInfo("Asia/Seoul")
FLAG = "EDU_DAILY_GAME"
DISABLED_DETAIL = "edu_game_disabled"

DEFAULT_TITLE = "[교육 지수] AI·반도체 모멘텀 가상그룹"
DEFAULT_THEME = "IT/반도체"
DISCLAIMER = "본 차트는 투자 교육을 위해 서버가 자체 생성한 가상 일봉 데이터이며 실제 상장 종목과 무관합니다."

RATIOS = (Decimal("0.25"), Decimal("0.5"), Decimal("1.0"))
BASE_LEVERAGES = (1, 2)
STOP_LOSS_PCTS = (3, 5, 7)
TAKE_PROFIT_PCTS = (5, 10, 15)
# 관망 학습 보너스 — 현금 10,000원 지급. 원금(bonus_cash)은 기존 reward_service.principal_increment 와 같은 식
# (지급액 / (1 + 현재 ROI))만큼 늘려 지급 직후 ROI 가 그대로 유지되게 한다(랭킹에 유리·불리 없음).
HOLD_WATCH_BONUS = Decimal("10000")
MIN_ENTRY_AMOUNT = Decimal("10000")
STATE_BARS = 120
LEADERBOARD_LIMIT = 50
SETTLE_HOUR = 20                      # 자동 정산 시각(평일 KST)
HISTORY_WINDOW = 60                   # 다음 봉 지표 계산에 쓰는 직전 봉 수

LONG, SHORT = "LONG", "SHORT"
ENTER_ACTIONS = {"ENTER_LONG": LONG, "ENTER_SHORT": SHORT}
FLAT_ACTIONS = {"ENTER_LONG", "ENTER_SHORT", "HOLD_WATCH"}
HOLDING_ACTIONS = {"KEEP_POS", "PARTIAL_CLOSE", "FULL_CLOSE"}

MSG_STALE_DAY = "새 종가 캔들이 열렸어요. 화면을 새로고침한 뒤 다시 결정해 주세요."
MSG_ALREADY = "오늘은 이미 게임에 참가했어요. 내일 새 종가 캔들이 열리면 다시 참가할 수 있어요!"
CENT = Decimal("0.01")
PCT4 = Decimal("0.0001")
ROI_LIMIT = Decimal("9999.9999")
ASSET_LIMIT = Decimal("9999999999999.99")  # NUMERIC(15,2) 상한


class EduGameError(Exception):
    """code·HTTP 상태 — 라우터가 {"detail": {"code", "message"}} 로 바꾼다."""

    def __init__(self, code: str, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def already_participated() -> EduGameError:
    return EduGameError("ALREADY_PARTICIPATED_TODAY", MSG_ALREADY, 409)


# ---------------------------------------------------------------- 시각
def now_kst() -> datetime:
    return datetime.now(KST)


def next_settlement_at(now: datetime, last_advanced: date | None) -> datetime:
    """다음 자동 정산 시각 — 평일 20:00 KST, 오늘 이미 정산했으면 다음 평일."""
    now = now.astimezone(KST)
    d = now.date()
    if d.weekday() < 5 and now.hour < SETTLE_HOUR and last_advanced != d:
        return datetime.combine(d, time(SETTLE_HOUR), KST)
    return datetime.combine(engine.next_weekday(d), time(SETTLE_HOUR), KST)


# ---------------------------------------------------------------- 손익 계산(순수)
def position_pnl(side: str, entry: Decimal, exit_price: Decimal, size: Decimal, leverage: int) -> Decimal:
    """손익 = 진입금액 × 배율 × (청산가/진입가 − 1), SHORT 는 부호 반대. 손실은 진입금액까지."""
    move = Decimal(exit_price) / Decimal(entry) - 1
    if side == SHORT:
        move = -move
    pnl = Decimal(size) * leverage * move
    return max(pnl, -Decimal(size)).quantize(CENT, rounding=ROUND_HALF_UP)


def is_wiped(side: str, entry: Decimal, price: Decimal, size: Decimal, leverage: int) -> bool:
    """손실이 진입금액 전부에 닿았는지(강제 청산 지점)."""
    move = Decimal(price) / Decimal(entry) - 1
    if side == SHORT:
        move = -move
    return Decimal(size) * leverage * move <= -Decimal(size)


def stop_take_prices(side: str, entry: int, sl_pct: int, tp_pct: int) -> tuple[int, int]:
    """진입가 기준 % → 호가 단위 반올림 가격."""
    if side == LONG:
        return engine.round_tick(entry * (1 - sl_pct / 100)), engine.round_tick(entry * (1 + tp_pct / 100))
    return engine.round_tick(entry * (1 + sl_pct / 100)), engine.round_tick(entry * (1 - tp_pct / 100))


@dataclass
class Settlement:
    closed: bool
    exit_price: Decimal
    pnl: Decimal
    reason: str | None   # STOP_LOSS | TAKE_PROFIT | LIQUIDATED | None(보유 유지)
    note: str


def _pct_txt(pnl: Decimal, size: Decimal) -> str:
    pct = (pnl / size * 100) if size else Decimal(0)
    return f"{pct:+.1f}%"


def settle_on_candle(
    side: str, entry: Decimal, size: Decimal, leverage: int,
    stop_loss: Decimal | None, take_profit: Decimal | None,
    o: Decimal, h: Decimal, lo: Decimal, c: Decimal,
) -> Settlement:
    """새 봉 하나로 보유 포지션 판정.

    순서: ① 시가 갭이 손절/익절가를 이미 넘었으면 시가 체결(보수적) → ② 장중 고가·저가 도달
    (동시 도달이면 시가에 더 가까운 가격 우선, 같으면 손절) → ③ 손실 상한(진입금액) 도달이면 강제 청산 →
    ④ 미도달이면 종가 평가.
    """
    hit: tuple[str, Decimal, bool] | None = None  # (사유, 체결가, 갭 여부)
    if side == LONG:
        if stop_loss is not None and o <= stop_loss:
            hit = ("STOP_LOSS", o, True)
        elif take_profit is not None and o >= take_profit:
            hit = ("TAKE_PROFIT", o, True)
        else:
            sl_hit = stop_loss is not None and lo <= stop_loss
            tp_hit = take_profit is not None and h >= take_profit
            if sl_hit and tp_hit:
                hit = ("STOP_LOSS", stop_loss, False) if abs(o - stop_loss) <= abs(take_profit - o) \
                    else ("TAKE_PROFIT", take_profit, False)
            elif sl_hit:
                hit = ("STOP_LOSS", stop_loss, False)
            elif tp_hit:
                hit = ("TAKE_PROFIT", take_profit, False)
    else:
        if stop_loss is not None and o >= stop_loss:
            hit = ("STOP_LOSS", o, True)
        elif take_profit is not None and o <= take_profit:
            hit = ("TAKE_PROFIT", o, True)
        else:
            sl_hit = stop_loss is not None and h >= stop_loss
            tp_hit = take_profit is not None and lo <= take_profit
            if sl_hit and tp_hit:
                hit = ("STOP_LOSS", stop_loss, False) if abs(stop_loss - o) <= abs(o - take_profit) \
                    else ("TAKE_PROFIT", take_profit, False)
            elif sl_hit:
                hit = ("STOP_LOSS", stop_loss, False)
            elif tp_hit:
                hit = ("TAKE_PROFIT", take_profit, False)

    if hit is not None:
        reason, price, gap = hit
        pnl = position_pnl(side, entry, price, size, leverage)
        if is_wiped(side, entry, price, size, leverage):
            return Settlement(True, price, pnl, "LIQUIDATED",
                              f"손실 한도 도달 — {int(price):,}원 강제 청산 ({_pct_txt(pnl, size)})")
        label = "손절가" if reason == "STOP_LOSS" else "익절가"
        if gap:
            note = f"시가 갭으로 {label}를 넘어 시가 {int(price):,}원 체결 ({_pct_txt(pnl, size)})"
        else:
            note = f"{label} {int(price):,}원 도달 ({_pct_txt(pnl, size)})"
        return Settlement(True, price, pnl, reason, note)

    pnl = position_pnl(side, entry, c, size, leverage)
    if is_wiped(side, entry, c, size, leverage):
        return Settlement(True, c, pnl, "LIQUIDATED", f"손실 한도 도달 — 종가 {int(c):,}원 강제 청산 ({_pct_txt(pnl, size)})")
    return Settlement(False, c, pnl, None, f"종가 {int(c):,}원 평가 ({_pct_txt(pnl, size)})")


def _principal(acc: EduGameAccount, season: EduGameSeason) -> Decimal:
    return Decimal(season.initial_cash) + Decimal(acc.bonus_cash or 0)


def refresh_totals(acc: EduGameAccount, season: EduGameSeason, mark: Decimal | None) -> None:
    """총자산 = 현금 + (보유 시 진입금액 + 평가손익). ROI(%) = 총자산 / 원금(initial + bonus) − 1."""
    total = Decimal(acc.cash_balance)
    if acc.pos_side and acc.pos_size_amount is not None and mark is not None:
        size = Decimal(acc.pos_size_amount)
        total += size + position_pnl(acc.pos_side, acc.pos_entry_price, mark, size, acc.pos_leverage)
    # NUMERIC(15,2) 상한 — 넘치면 그날 정산 트랜잭션 전체가 실패하므로 고정(ROI 는 고정 전 값으로 계산)
    acc.total_asset = min(total, ASSET_LIMIT).quantize(CENT, rounding=ROUND_HALF_UP)
    principal = _principal(acc, season)
    roi = ((total / principal - 1) * 100).quantize(PCT4, rounding=ROUND_HALF_UP) if principal else Decimal(0)
    roi = max(min(roi, ROI_LIMIT), -ROI_LIMIT)  # NUMERIC(8,4) 상한 — 넘치면 그날 정산 트랜잭션 전체가 실패하므로 고정
    acc.current_roi = roi
    acc.max_roi = max(Decimal(acc.max_roi or 0), roi)


def _clear_position(acc: EduGameAccount) -> None:
    acc.pos_side = None
    acc.pos_entry_price = None
    acc.pos_size_amount = None
    acc.pos_leverage = 1
    acc.pos_stop_loss = None
    acc.pos_take_profit = None
    acc.pos_opened_day_index = None


# ---------------------------------------------------------------- 시즌
async def _active_season(db: AsyncSession, *, lock: str | None = None) -> EduGameSeason | None:
    stmt = select(EduGameSeason).where(EduGameSeason.status == "ACTIVE").order_by(EduGameSeason.id.desc()).limit(1)
    if lock == "update":
        stmt = stmt.with_for_update()
    elif lock == "share":
        stmt = stmt.with_for_update(read=True)
    stmt = stmt.execution_options(populate_existing=True)
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_active_season(db: AsyncSession) -> EduGameSeason | None:
    return await _active_season(db)


def _candle_row(season_id: int, bar: dict) -> EduGameCandle:
    return EduGameCandle(
        season_id=season_id, day_index=bar["day_index"], display_date=bar["display_date"],
        open=Decimal(bar["open"]), high=Decimal(bar["high"]), low=Decimal(bar["low"]), close=Decimal(bar["close"]),
        volume=bar["volume"], change_pct=bar["change_pct"], regime=bar["regime"],
        pattern_tag=bar.get("pattern_tag"), coach_comment=bar.get("coach_comment"),
        support_price=_dec(bar.get("support_price")), resistance_price=_dec(bar.get("resistance_price")),
        poc_price=_dec(bar.get("poc_price")),
    )


def _dec(v) -> Decimal | None:
    return None if v is None else Decimal(v)


def _int(v) -> int | None:
    return None if v is None else int(v)


def _candle_dict(c: EduGameCandle) -> dict:
    """엔진 입력용 dict(가격 정수)."""
    return {
        "day_index": c.day_index, "display_date": c.display_date,
        "open": int(c.open), "high": int(c.high), "low": int(c.low), "close": int(c.close), "volume": int(c.volume),
        "support_price": _int(c.support_price), "resistance_price": _int(c.resistance_price),
        "poc_price": _int(c.poc_price),
    }


async def _insert_season(
    db: AsyncSession, *, title: str, theme_category: str, hide_name: bool, start_price: int, today: date,
) -> EduGameSeason:
    """시즌 + 워밍업 120봉을 같은 트랜잭션에 추가(commit 은 호출자)."""
    last_no = (await db.execute(select(func.max(EduGameSeason.season_number)))).scalar() or 0
    number = last_no + 1
    season = EduGameSeason(
        season_number=number, synthetic_code=f"SYN-{number:02d}", title=title, theme_category=theme_category,
        hide_name=hide_name, seed_key=secrets.token_hex(32), status="ACTIVE", start_date=today,
        current_day_index=engine.WARMUP_BARS,
    )
    db.add(season)
    await db.flush()  # season.id 확정(난수 키에 쓰임) + ACTIVE 유일 인덱스 검사
    bars, regime, days_left = engine.generate_initial_candles(
        season.seed_key, season.id, today, start_price=start_price, count=engine.WARMUP_BARS,
    )
    db.add_all([_candle_row(season.id, b) for b in bars])
    season.current_regime = regime
    season.regime_days_left = days_left
    await db.flush()
    return season


async def get_or_create_active_season(db: AsyncSession, today: date | None = None) -> EduGameSeason:
    """활성 교육 시즌. 없으면 시즌 1기(또는 다음 번호) + 워밍업 120봉 자동 생성.

    동시 요청은 ACTIVE 부분 유일 인덱스·season_number 유일 제약으로 1개만 성공 — 진 쪽은 세이브포인트만 되돌리고
    다시 읽는다. 바깥 트랜잭션을 rollback 하지 않으므로 같은 세션에서 이미 읽은 객체(요청 사용자 등)가 만료되지 않는다.
    """
    season = await _active_season(db)
    if season is not None:
        return season
    today = today or now_kst().date()
    try:
        async with db.begin_nested():
            season = await _insert_season(
                db, title=DEFAULT_TITLE, theme_category=DEFAULT_THEME, hide_name=False,
                start_price=engine.START_PRICE, today=today,
            )
    except IntegrityError:
        season = await _active_season(db)
        if season is None:
            raise
        return season
    season_id, season_no = season.id, season.season_number
    await db.commit()
    log.info("교육 시즌 자동 생성 id=%s no=%s", season_id, season_no)
    return season


async def start_new_season(
    db: AsyncSession, *, title: str, theme_category: str, hide_name: bool, start_price: int,
    today: date | None = None,
) -> EduGameSeason:
    """관리자 — 기존 ACTIVE 교육 시즌을 CLOSED 로 바꾸고 새 시즌(+120봉) 생성."""
    today = today or now_kst().date()
    current = await _active_season(db, lock="update")
    if current is not None:
        current.status = "CLOSED"
        current.end_date = today
        await db.flush()
    try:
        season = await _insert_season(
            db, title=title, theme_category=theme_category, hide_name=hide_name, start_price=start_price, today=today,
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise EduGameError("SEASON_CONFLICT", "다른 요청이 먼저 시즌을 바꿨어요. 새로 고친 뒤 다시 시도해 주세요.")
    log.info("교육 시즌 새로 생성 id=%s no=%s (이전=%s)", season.id, season.season_number,
             current.id if current else None)
    return season


async def set_regime_override(db: AsyncSession, regime: str | None) -> EduGameSeason:
    season = await _active_season(db, lock="update")
    if season is None:
        raise EduGameError("NO_ACTIVE_SEASON", "진행 중인 교육 시즌이 없어요.", 404)
    if regime is not None and regime not in engine.REGIMES:
        raise EduGameError("INVALID_REGIME", "알 수 없는 시장 국면입니다.", 400)
    season.next_regime_override = regime
    await db.commit()
    return season


async def count_participants(db: AsyncSession, season_id: int) -> int:
    return (await db.execute(
        select(func.count()).select_from(EduGameAccount).where(EduGameAccount.season_id == season_id)
    )).scalar() or 0


# ---------------------------------------------------------------- DTO 변환(dict)
def season_dict(s: EduGameSeason) -> dict:
    return {
        "id": s.id, "season_number": s.season_number, "synthetic_code": s.synthetic_code,
        "display_name": f"블라인드 교육 차트 #{s.season_number}" if s.hide_name else s.title,
        "title": None if s.hide_name else s.title,
        "theme_category": None if s.hide_name else s.theme_category,
        "hide_name": bool(s.hide_name), "current_day_index": s.current_day_index, "status": s.status,
        "start_date": s.start_date, "initial_cash": float(s.initial_cash),
    }


def candle_public(c: EduGameCandle) -> dict:
    """공개 캔들 — 국면(regime)은 정답 힌트가 되므로 내보내지 않는다."""
    return {
        "day_index": c.day_index, "date": c.display_date, "open": int(c.open), "high": int(c.high),
        "low": int(c.low), "close": int(c.close), "volume": int(c.volume), "change_pct": float(c.change_pct),
        "pattern_tag": c.pattern_tag,
    }


def action_dict(a: EduGameDailyAction) -> dict:
    return {
        "day_index": a.day_index, "action_date": a.action_date, "action_type": a.action_type, "side": a.side,
        "ratio": None if a.ratio is None else float(a.ratio), "leverage": a.leverage,
        "stop_loss_price": _int(a.stop_loss_price), "take_profit_price": _int(a.take_profit_price),
        "execution_price": int(a.execution_price),
        "realized_pnl": None if a.realized_pnl is None else float(a.realized_pnl),
        "settlement_note": a.settlement_note,
    }


def account_dict(acc: EduGameAccount, mark: Decimal | None) -> dict:
    position = None
    if acc.pos_side and acc.pos_size_amount is not None:
        size = Decimal(acc.pos_size_amount)
        pnl = position_pnl(acc.pos_side, acc.pos_entry_price, mark, size, acc.pos_leverage) if mark else Decimal(0)
        position = {
            "side": acc.pos_side, "entry_price": int(acc.pos_entry_price), "size_amount": float(size),
            "leverage": acc.pos_leverage, "stop_loss_price": _int(acc.pos_stop_loss),
            "take_profit_price": _int(acc.pos_take_profit), "opened_day_index": acc.pos_opened_day_index,
            "unrealized_pnl": float(pnl), "roi_pct": float((pnl / size * 100).quantize(Decimal("0.01"))) if size else 0.0,
        }
    return {
        "cash_balance": float(acc.cash_balance), "bonus_cash": float(acc.bonus_cash),
        "total_asset": float(acc.total_asset), "current_roi": float(acc.current_roi), "max_roi": float(acc.max_roi),
        "total_trades": acc.total_trades, "win_trades": acc.win_trades,
        "participation_days": acc.participation_days, "last_action_day_index": acc.last_action_day_index,
        "position": position,
    }


# ---------------------------------------------------------------- 조회
async def _last_candles(db: AsyncSession, season_id: int, n: int) -> list[EduGameCandle]:
    rows = (await db.execute(
        select(EduGameCandle).where(EduGameCandle.season_id == season_id)
        .order_by(EduGameCandle.day_index.desc()).limit(n)
    )).scalars().all()
    return list(reversed(rows))


async def _account(db: AsyncSession, user_id: int, season_id: int, *, lock: bool = False) -> EduGameAccount | None:
    stmt = select(EduGameAccount).where(EduGameAccount.user_id == user_id, EduGameAccount.season_id == season_id)
    if lock:
        stmt = stmt.with_for_update()
    stmt = stmt.execution_options(populate_existing=True)
    return (await db.execute(stmt)).scalar_one_or_none()


async def crowd(db: AsyncSession, season_id: int, day_index: int) -> dict:
    rows = (await db.execute(
        select(EduGameDailyAction.side, func.count()).where(
            EduGameDailyAction.season_id == season_id, EduGameDailyAction.day_index == day_index,
        ).group_by(EduGameDailyAction.side)
    )).all()
    counts = {side: n for side, n in rows}
    long_n, short_n = counts.get(LONG, 0), counts.get(SHORT, 0)
    watch_n = counts.get(None, 0)
    total = long_n + short_n + watch_n

    def pct(n: int) -> float:
        return round(n / total * 100, 1) if total else 0.0

    return {"total": total, "long": long_n, "short": short_n, "watch": watch_n,
            "long_pct": pct(long_n), "short_pct": pct(short_n), "watch_pct": pct(watch_n)}


async def _leverage_options(db: AsyncSession, user_id: int | None) -> tuple[list[int], bool]:
    unlocked = bool(user_id) and await academy_service.is_unlocked(db, user_id)
    return [*BASE_LEVERAGES, academy_service.ACADEMY_LEVERAGE], unlocked


async def get_edu_state(db: AsyncSession, user: User | None, *, now: datetime | None = None) -> dict:
    now = now or now_kst()
    user_id = user.id if user is not None else None  # 이후 commit·세이브포인트와 무관하게 지역 변수만 쓴다
    season = await get_or_create_active_season(db, now.astimezone(KST).date())
    bars = await _last_candles(db, season.id, STATE_BARS)
    last = bars[-1]
    mark = Decimal(last.close)
    leverages, unlocked = await _leverage_options(db, user_id)
    state = {
        "enabled": True,
        "season": season_dict(season),
        "candles": [candle_public(c) for c in bars],
        "today": {
            "day_index": last.day_index, "date": last.display_date, "close": int(last.close),
            "change_pct": float(last.change_pct), "pattern_tag": last.pattern_tag, "coach_comment": last.coach_comment,
            "support_price": _int(last.support_price), "resistance_price": _int(last.resistance_price),
            "poc_price": _int(last.poc_price),
        },
        "crowd": await crowd(db, season.id, season.current_day_index),
        "next_settlement_at": next_settlement_at(now, season.last_advanced_date),
        "logged_in": user_id is not None,
        "today_submitted": False,
        "today_action": None,
        "account": None,
        "options": {
            "ratios": [float(r) for r in RATIOS], "leverages": leverages,
            "stop_loss_pcts": list(STOP_LOSS_PCTS), "take_profit_pcts": list(TAKE_PROFIT_PCTS),
            "leverage_5x_unlocked": unlocked, "hold_watch_bonus": int(HOLD_WATCH_BONUS),
        },
        "disclaimer": DISCLAIMER,
    }
    if user_id is not None:
        acc = await _account(db, user_id, season.id)
        if acc is not None:
            state["account"] = account_dict(acc, mark)
            state["today_submitted"] = acc.last_action_day_index == season.current_day_index
            if state["today_submitted"]:
                row = (await db.execute(select(EduGameDailyAction).where(
                    EduGameDailyAction.account_id == acc.id,
                    EduGameDailyAction.day_index == season.current_day_index,
                ))).scalar_one_or_none()
                state["today_action"] = action_dict(row) if row else None
    return state


async def get_history(db: AsyncSession, user: User, *, limit: int = 200) -> dict:
    user_id = user.id
    season = await get_or_create_active_season(db)
    acc = await _account(db, user_id, season.id)
    actions: list = []
    if acc is not None:
        actions = (await db.execute(
            select(EduGameDailyAction).where(EduGameDailyAction.account_id == acc.id)
            .order_by(EduGameDailyAction.day_index.desc()).limit(limit)
        )).scalars().all()
    return {"season_id": season.id, "actions": [action_dict(a) for a in actions]}


async def get_leaderboard(db: AsyncSession, user: User | None, *, limit: int = LEADERBOARD_LIMIT) -> dict:
    user_id, nickname_me = (user.id, user.nickname) if user is not None else (None, None)
    season = await get_or_create_active_season(db)
    order = (EduGameAccount.current_roi.desc(), EduGameAccount.total_asset.desc(), EduGameAccount.created_at.asc())
    rows = (await db.execute(
        select(EduGameAccount, User.nickname).join(User, User.id == EduGameAccount.user_id)
        .where(EduGameAccount.season_id == season.id).order_by(*order).limit(limit)
    )).all()

    def row(acc: EduGameAccount, nickname: str | None, rank: int) -> dict:
        return {"rank": rank, "nickname": nickname, "current_roi": float(acc.current_roi),
                "total_asset": float(acc.total_asset), "participation_days": acc.participation_days,
                "win_trades": acc.win_trades, "total_trades": acc.total_trades}

    top, prev_roi, rank = [], None, 0
    for i, (acc, nickname) in enumerate(rows):
        if acc.current_roi != prev_roi:  # 같은 수익률은 같은 순위(공동 순위)
            rank, prev_roi = i + 1, acc.current_roi
        top.append(row(acc, nickname, rank))

    mine = None
    if user_id is not None:
        acc = await _account(db, user_id, season.id)
        if acc is not None:
            higher = (await db.execute(
                select(func.count()).select_from(EduGameAccount).where(
                    EduGameAccount.season_id == season.id, EduGameAccount.current_roi > acc.current_roi,
                )
            )).scalar() or 0
            mine = row(acc, nickname_me, higher + 1)
    return {"season_id": season.id, "top": top, "my_rank": mine}


# ---------------------------------------------------------------- 하루 1회 제출
async def _ensure_account(db: AsyncSession, user_id: int, season: EduGameSeason) -> None:
    if await _account(db, user_id, season.id) is not None:
        return
    try:
        async with db.begin_nested():  # 세이브포인트 — 충돌해도 바깥 트랜잭션(읽어 둔 객체)은 그대로
            db.add(EduGameAccount(
                user_id=user_id, season_id=season.id, cash_balance=season.initial_cash,
                total_asset=season.initial_cash, bonus_cash=Decimal(0),
            ))
    except IntegrityError:  # 같은 유저 동시 첫 제출 — 이미 생겼으면 그대로 사용
        return
    await db.commit()


async def submit_daily_action(
    db: AsyncSession, redis, user: User, payload: dict, *, now: datetime | None = None,
) -> dict:
    """하루(봉) 1회 의사결정. 오늘 종가(current_day_index 봉의 close)로 즉시 체결/기록한다."""
    now = (now or now_kst()).astimezone(KST)
    today = now.date()
    action = payload["action"]
    user_id = user.id  # 세션 객체 만료와 무관하게 지역 변수만 쓴다

    season = await get_or_create_active_season(db, today)
    if action in ENTER_ACTIONS and payload.get("leverage", 1) == academy_service.ACADEMY_LEVERAGE \
            and not await academy_service.is_unlocked(db, user_id):
        raise EduGameError(
            "LEVERAGE_LOCKED", "5배 레버리지는 아카데미 리스크 관리 퀴즈를 통과해야 사용할 수 있습니다.", 403,
        )
    await _ensure_account(db, user_id, season)

    # 잠금: 시즌(공유) → 계좌(배타). 정산이 진행 중이면 끝난 뒤의 day_index 로 판정된다.
    season = await _active_season(db, lock="share")
    if season is None:
        raise EduGameError("NO_ACTIVE_SEASON", "진행 중인 교육 시즌이 없어요.", 409)
    acc = await _account(db, user_id, season.id, lock=True)
    if acc is None:
        raise EduGameError("NO_ACTIVE_SEASON", "진행 중인 교육 시즌이 없어요.", 409)
    day = season.current_day_index
    expected_day = payload.get("day_index")
    if expected_day is not None and expected_day != day:  # 사용자가 본 봉과 지금 봉이 다르면 체결하지 않는다
        raise EduGameError("STALE_DAY", MSG_STALE_DAY, 409)
    if acc.last_action_day_index == day:
        raise already_participated()

    candle = (await db.execute(select(EduGameCandle).where(
        EduGameCandle.season_id == season.id, EduGameCandle.day_index == day,
    ))).scalar_one()
    price = Decimal(candle.close)
    holding = acc.pos_side is not None
    if (holding and action not in HOLDING_ACTIONS) or (not holding and action not in FLAT_ACTIONS):
        msg = ("이미 보유 중인 포지션이 있어요. 유지·50% 청산·전량 청산 중에서 골라 주세요." if holding
               else "보유 중인 포지션이 없어요. 상승 진입·하락 진입·관망 중에서 골라 주세요.")
        raise EduGameError("ACTION_NOT_ALLOWED", msg, 409)

    row = EduGameDailyAction(
        account_id=acc.id, season_id=season.id, user_id=user_id, day_index=day, action_date=today,
        action_type=action, execution_price=price, leverage=1,
    )
    bonus = Decimal(0)
    message = ""

    if action in ENTER_ACTIONS:
        side = ENTER_ACTIONS[action]
        ratio, sl_pct, tp_pct = payload.get("ratio"), payload.get("stop_loss_pct"), payload.get("take_profit_pct")
        if ratio is None or sl_pct is None or tp_pct is None:
            raise EduGameError("INVALID_ORDER", "비중·손절폭·익절폭을 모두 골라 주세요.", 400)
        ratio = Decimal(str(ratio))
        leverage = int(payload.get("leverage", 1))
        amount = (Decimal(acc.cash_balance) * ratio).quantize(CENT, rounding=ROUND_DOWN)
        if amount < MIN_ENTRY_AMOUNT:
            raise EduGameError("INSUFFICIENT_CASH", "진입할 수 있는 현금이 부족해요.", 409)
        sl, tp = stop_take_prices(side, int(price), int(sl_pct), int(tp_pct))
        acc.cash_balance = Decimal(acc.cash_balance) - amount
        acc.pos_side, acc.pos_entry_price, acc.pos_size_amount = side, price, amount
        acc.pos_leverage, acc.pos_stop_loss, acc.pos_take_profit = leverage, Decimal(sl), Decimal(tp)
        acc.pos_opened_day_index = day
        row.ratio, row.leverage = ratio, leverage
        row.stop_loss_price, row.take_profit_price = Decimal(sl), Decimal(tp)
        message = f"{'상승' if side == LONG else '하락'} 진입을 예약했어요. 다음 종가 캔들에서 손익이 정산됩니다."
    elif action == "HOLD_WATCH":
        bonus = HOLD_WATCH_BONUS
        refresh_totals(acc, season, price)  # 관망은 무포지션 — 지급 직전 ROI 를 현재 값으로
        acc.bonus_cash = Decimal(acc.bonus_cash) + reward_service.principal_increment(bonus, acc.current_roi)
        acc.cash_balance = Decimal(acc.cash_balance) + bonus
        message = "쉬어 가는 것도 중요한 투자 기술이에요! 관망 학습 보너스를 받았어요."
    elif action == "KEEP_POS":
        sl_pct, tp_pct = payload.get("stop_loss_pct"), payload.get("take_profit_pct")
        if sl_pct is not None or tp_pct is not None:
            entry = int(acc.pos_entry_price)
            new_sl = Decimal(stop_take_prices(acc.pos_side, entry, int(sl_pct), 5)[0]) if sl_pct is not None \
                else acc.pos_stop_loss
            new_tp = Decimal(stop_take_prices(acc.pos_side, entry, 3, int(tp_pct))[1]) if tp_pct is not None \
                else acc.pos_take_profit
            ok = (new_sl < price < new_tp) if acc.pos_side == LONG else (new_tp < price < new_sl)
            if not ok:
                raise EduGameError(
                    "INVALID_LEVELS", "지금 종가 기준으로 바로 체결되는 손절·익절가예요. 다른 폭을 골라 주세요.", 400,
                )
            acc.pos_stop_loss, acc.pos_take_profit = new_sl, new_tp
        row.leverage = acc.pos_leverage
        row.stop_loss_price, row.take_profit_price = acc.pos_stop_loss, acc.pos_take_profit
        message = "포지션을 유지해요. 다음 종가 캔들에서 다시 평가됩니다."
    elif action == "PARTIAL_CLOSE":
        size = Decimal(acc.pos_size_amount)
        half = (size / 2).quantize(CENT, rounding=ROUND_DOWN)
        pnl = position_pnl(acc.pos_side, acc.pos_entry_price, price, half, acc.pos_leverage)
        acc.cash_balance = Decimal(acc.cash_balance) + half + pnl
        acc.pos_size_amount = size - half
        row.leverage, row.realized_pnl = acc.pos_leverage, pnl
        row.stop_loss_price, row.take_profit_price = acc.pos_stop_loss, acc.pos_take_profit
        message = "절반을 오늘 종가로 확정했어요. 나머지 50%는 계속 보유합니다."
    else:  # FULL_CLOSE
        size = Decimal(acc.pos_size_amount)
        pnl = position_pnl(acc.pos_side, acc.pos_entry_price, price, size, acc.pos_leverage)
        acc.cash_balance = Decimal(acc.cash_balance) + size + pnl
        acc.total_trades += 1
        if pnl > 0:
            acc.win_trades += 1
        row.leverage, row.realized_pnl = acc.pos_leverage, pnl
        _clear_position(acc)
        message = "포지션을 오늘 종가로 모두 청산했어요."

    row.side = acc.pos_side
    acc.last_action_day_index = day
    acc.last_action_date = today
    acc.participation_days += 1
    refresh_totals(acc, season, price)
    db.add(row)
    try:
        await db.flush()
        result = {"action": action_dict(row), "account": account_dict(acc, price)}
        await db.commit()
    except IntegrityError:  # (account_id, day_index) 유일 — 동시 제출의 두 번째 방어선
        await db.rollback()
        raise already_participated()

    streak_value = None
    try:  # STREAK 플래그·기존 동작 그대로(꺼져 있으면 None). 실패해도 제출은 유지
        streak = await streak_service.touch(db, redis, user_id, today=today)
        streak_value = streak.current_streak if streak else None
    except Exception:  # noqa: BLE001
        log.warning("교육 게임 연속 출석 갱신 실패 user=%s", user_id, exc_info=True)
        await db.rollback()
    result.update(bonus_cash_awarded=float(bonus), streak=streak_value, message=message)
    return result


# ---------------------------------------------------------------- 일일 정산
async def advance_day_and_settle(db: AsyncSession, *, force: bool = False, now: datetime | None = None) -> dict:
    """새 일봉 1개 생성 + 전 계좌 손절·익절·종가 평가. 한 트랜잭션.

    force=False(자동 배치): 오늘(KST) 이미 정산했으면 건너뛴다. force=True(관리자): 제한 없이 즉시 1봉.
    """
    today = (now or now_kst()).astimezone(KST).date()
    season = await _active_season(db, lock="update")
    if season is None:
        return {"status": "no_season"}
    season_id = season.id  # commit 실패(rollback) 뒤에도 만료된 객체를 읽지 않게
    if not force and season.last_advanced_date == today:
        return {"status": "skipped", "season_id": season.id, "day_index": season.current_day_index}

    history = [_candle_dict(c) for c in await _last_candles(db, season.id, HISTORY_WINDOW)]
    bar, regime, days_left = engine.generate_next_candle(
        season.seed_key, season.id, history, season.current_regime, season.regime_days_left,
        season.next_regime_override,
    )
    db.add(_candle_row(season.id, bar))
    day = bar["day_index"]
    try:
        await db.flush()  # 봉 유일 제약을 여기서 확인 — 이후 조회의 autoflush 에서 예외가 새지 않게
    except IntegrityError:  # 같은 봉을 동시에 만든 경우(uq_edu_season_day) — 먼저 끝난 쪽만 유효
        await db.rollback()
        return {"status": "skipped", "season_id": season_id, "day_index": day - 1}
    season.current_day_index = day
    season.current_regime, season.regime_days_left = regime, days_left
    season.next_regime_override = None
    season.last_advanced_date = today

    o, h, lo, c = (Decimal(bar[k]) for k in ("open", "high", "low", "close"))
    accounts = (await db.execute(
        select(EduGameAccount).where(EduGameAccount.season_id == season.id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalars().all()

    results: dict = {}
    for acc in accounts:
        if not acc.pos_side or acc.pos_size_amount is None or (acc.pos_opened_day_index or 0) >= day:
            refresh_totals(acc, season, c)
            continue
        size = Decimal(acc.pos_size_amount)
        st = settle_on_candle(acc.pos_side, Decimal(acc.pos_entry_price), size, acc.pos_leverage,
                              acc.pos_stop_loss, acc.pos_take_profit, o, h, lo, c)
        if st.closed:
            acc.cash_balance = Decimal(acc.cash_balance) + size + st.pnl
            acc.total_trades += 1
            if st.pnl > 0:
                acc.win_trades += 1
            _clear_position(acc)
        refresh_totals(acc, season, c)
        results[acc.id] = st

    if results:
        await _annotate_actions(db, season.id, day, results)
    try:
        await db.commit()
    except IntegrityError:  # 같은 봉을 동시에 만든 경우(uq_edu_season_day) — 먼저 끝난 쪽만 유효
        await db.rollback()
        return {"status": "skipped", "season_id": season_id, "day_index": day - 1}
    closed = sum(1 for s in results.values() if s.closed)
    log.info("교육 게임 정산 season=%s day=%s close=%s settled=%s closed=%s",
             season_id, day, bar["close"], len(results), closed)
    return {"status": "advanced", "season_id": season_id, "day_index": day, "close": bar["close"],
            "regime": regime, "settled": len(results), "closed": closed}


async def _annotate_actions(db: AsyncSession, season_id: int, day: int, results: dict) -> None:
    """정산 결과를 각 계좌의 가장 최근 참가 기록에 남긴다(청산이면 realized_pnl 누적).

    보유만 하고 며칠 참가하지 않으면 같은 행에 매일 정산이 쌓인다 — 덮어쓰지 않고 최신 결과를 앞에 붙이며
    컬럼 길이(200자)를 넘는 오래된 부분은 잘린다. 조회는 시즌 단위 2번(전날 참가 행 + 그 밖 계좌의 최근 행)으로 끝낸다.
    """
    acc_ids = list(results)
    recent = (await db.execute(select(EduGameDailyAction).where(
        EduGameDailyAction.season_id == season_id, EduGameDailyAction.day_index == day - 1,
        EduGameDailyAction.account_id.in_(acc_ids),
    ))).scalars().all()
    by_acc = {a.account_id: a for a in recent}
    missing = [a for a in acc_ids if a not in by_acc]
    if missing:
        latest = (
            select(EduGameDailyAction.account_id, func.max(EduGameDailyAction.day_index).label("d"))
            .where(EduGameDailyAction.season_id == season_id, EduGameDailyAction.account_id.in_(missing))
            .group_by(EduGameDailyAction.account_id).subquery()
        )
        rows = (await db.execute(select(EduGameDailyAction).join(
            latest, (EduGameDailyAction.account_id == latest.c.account_id) & (EduGameDailyAction.day_index == latest.c.d),
        ))).scalars().all()
        by_acc.update({a.account_id: a for a in rows})
    for acc_id, st in results.items():
        row = by_acc.get(acc_id)
        if row is None:
            continue
        note = f"Day {day}: {st.note}"
        row.settlement_note = (f"{note} / {row.settlement_note}" if row.settlement_note else note)[:200]
        if st.closed:
            row.realized_pnl = Decimal(row.realized_pnl or 0) + st.pnl
