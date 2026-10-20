"""장중 지수 30초 갱신 — 실행 창(거래일·09:00/15:35 경계), 오늘 값 추출, Redis 병합·TTL, 일부/전부 실패(가짜 KIS·fakeredis)."""
import json
from datetime import date, datetime, timezone

import fakeredis
import pytest

from apps.collector import intraday_indices as ii

NOW = datetime(2026, 10, 20, 14, 32, 5, tzinfo=ii.KST)  # 화요일 장중
TODAY = NOW.date()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    # 로컬 .env 의 TRADING_DAYS=ALL 같은 값이 거래일 판정을 바꾸지 않게
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED", raising=False)


_PRICES = {"0001": "2601.5", "1001": "808.9", "2001": "350.1"}


class _Client:
    """KIS 가짜 — 국내 지수(업종 일별)·환율(해외 일별). day 는 응답 봉의 날짜."""

    def __init__(self, fail=(), day="20261020"):
        self.fail, self.day, self.calls = set(fail), day, []

    def get_domestic_index_daily(self, code, s, e):
        self.calls.append(("U", code, s, e))
        if code in self.fail:
            raise RuntimeError("KIS rt_cd=1")
        return [{"stck_bsop_date": self.day, "bstp_nmix_prpr": _PRICES[code]}]

    def get_overseas_daily(self, mrkt, symbol, s, e):
        self.calls.append((mrkt, symbol, s, e))
        if symbol in self.fail:
            raise RuntimeError("KIS rt_cd=1")
        return [{"stck_bsop_date": self.day, "ovrs_nmix_prpr": "1385.2"}]


def test_enabled_default_true_and_off_values(monkeypatch):
    assert ii.enabled() is True
    for off in ("false", "FALSE", "0", "no", "off", " false "):
        monkeypatch.setenv("INTRADAY_INDICES_ENABLED", off)
        assert ii.enabled() is False
    monkeypatch.setenv("INTRADAY_INDICES_ENABLED", "true")
    assert ii.enabled() is True


@pytest.mark.parametrize("y, m, d, hh, mm, expected", [
    (2026, 10, 20, 8, 59, False),   # 장 시작 전
    (2026, 10, 20, 9, 0, True),     # 09:00 포함
    (2026, 10, 20, 15, 34, True),
    (2026, 10, 20, 15, 35, False),  # 15:35 제외
    (2026, 10, 17, 10, 0, False),   # 토요일
    (2026, 10, 5, 10, 0, False),    # 개천절 대체공휴일
])
def test_in_intraday_window(y, m, d, hh, mm, expected):
    assert ii.in_intraday_window(datetime(y, m, d, hh, mm, tzinfo=ii.KST)) is expected


def test_intraday_specs_are_three_kr_indices_and_usdkrw():
    specs = ii.intraday_specs()
    assert [s.code for s in specs] == list(ii.INTRADAY_CODES)
    fx = next(s for s in specs if s.code == "FX:USDKRW")
    assert (fx.mrkt, fx.symbol) == ("X", "FX@KRW")  # 환율은 region=US 라 index_specs("KR") 에 없다 — 코드로 고른다


def test_today_value_picks_today_bar_only():
    rows = [{"date": date(2026, 10, 19), "close": 1.0}, {"date": TODAY, "close": 2.5}]
    assert ii.today_value(rows, TODAY) == 2.5
    assert ii.today_value(rows[:1], TODAY) is None
    assert ii.today_value([], TODAY) is None


def test_merge_keeps_previous_and_drops_stale():
    ts = NOW.timestamp()
    prev = {"KR:1001": {"value": 800.0, "date": "2026-10-20", "ts": ts - 60},
            "KR:2001": {"value": 340.0, "date": "2026-10-20", "ts": ts - ii.INTRADAY_TTL - 1},
            "bad": "x"}
    fresh = {"KR:0001": {"value": 2601.5, "date": "2026-10-20", "ts": int(ts)}}
    assert ii.merge_intraday(prev, fresh, ts) == {"KR:1001": prev["KR:1001"], "KR:0001": fresh["KR:0001"]}


def test_load_intraday_tolerates_missing_and_broken():
    r = fakeredis.FakeRedis(decode_responses=True)
    assert ii.load_intraday(r) == {}
    r.set(ii.INTRADAY_KEY, "not json")
    assert ii.load_intraday(r) == {}
    r.set(ii.INTRADAY_KEY, "[1, 2]")
    assert ii.load_intraday(r) == {}


def test_poll_writes_all_four_with_ttl():
    r = fakeredis.FakeRedis(decode_responses=True)
    c = _Client()
    out = ii.poll(c, r, NOW)
    assert out == {"ok": sorted(ii.INTRADAY_CODES), "failed": []}
    saved = json.loads(r.get(ii.INTRADAY_KEY))
    assert saved["KR:0001"] == {"value": 2601.5, "date": "2026-10-20", "ts": int(NOW.timestamp())}
    assert saved["FX:USDKRW"]["value"] == 1385.2
    assert 0 < r.ttl(ii.INTRADAY_KEY) <= ii.INTRADAY_TTL
    # 오늘 하루 범위로만 조회(지수 시장 코드 U, 환율 X)
    assert ("U", "0001", "20261020", "20261020") in c.calls and ("X", "FX@KRW", "20261020", "20261020") in c.calls


def test_poll_partial_failure_keeps_previous_value():
    r = fakeredis.FakeRedis(decode_responses=True)
    old = {"value": 800.0, "date": "2026-10-20", "ts": int(NOW.timestamp()) - 30}
    r.set(ii.INTRADAY_KEY, json.dumps({"KR:1001": old}))
    out = ii.poll(_Client(fail={"1001"}), r, NOW)
    assert out["failed"] == ["KR:1001"]
    saved = json.loads(r.get(ii.INTRADAY_KEY))
    assert saved["KR:1001"] == old and saved["KR:0001"]["value"] == 2601.5


def test_poll_counts_missing_today_bar_as_failure():
    # 장중에 오늘 봉을 주지 않는 TR(어제 봉만 옴) — 실패로 세고 아무것도 쓰지 않는다
    r = fakeredis.FakeRedis(decode_responses=True)
    out = ii.poll(_Client(day="20261019"), r, NOW)
    assert out == {"ok": [], "failed": list(ii.INTRADAY_CODES)}
    assert r.get(ii.INTRADAY_KEY) is None


def test_poll_all_fail_does_not_touch_redis():
    r = fakeredis.FakeRedis(decode_responses=True)
    r.set(ii.INTRADAY_KEY, json.dumps({"KR:0001": {"value": 1.0, "date": "2026-10-20", "ts": 1}}), ex=100)
    out = ii.poll(_Client(fail={"0001", "1001", "2001", "FX@KRW"}), r, NOW)
    assert out["ok"] == [] and len(out["failed"]) == 4
    assert r.ttl(ii.INTRADAY_KEY) <= 100  # TTL 을 늘리지 않음 → 그대로 사라져 확정 종가로 돌아간다


def test_poll_uses_injected_fetch():
    # Task 4 분기(현재지수 TR)에서 조회 함수만 바꿔 끼울 수 있어야 한다
    r = fakeredis.FakeRedis(decode_responses=True)
    out = ii.poll(object(), r, NOW, fetch=lambda spec, client, today: 1.0 if spec.code == "KR:0001" else None)
    assert out["ok"] == ["KR:0001"] and len(out["failed"]) == 3


@pytest.mark.parametrize("bad", [0.0, float("nan"), float("inf"), -1.0, "abc", "nan"])
def test_poll_rejects_non_positive_or_non_finite_values(bad):
    r = fakeredis.FakeRedis(decode_responses=True)
    old = {"value": 2600.0, "date": "2026-10-20", "ts": int(NOW.timestamp()) - 30}
    r.set(ii.INTRADAY_KEY, json.dumps({"KR:0001": old}))
    out = ii.poll(object(), r, NOW, fetch=lambda spec, c, t: bad if spec.code == "KR:0001" else 1.0)
    assert "KR:0001" in out["failed"] and "KR:0001" not in out["ok"]
    assert json.loads(r.get(ii.INTRADAY_KEY))["KR:0001"] == old  # 이전 값 유지


def test_load_intraday_drops_items_older_than_ttl_on_read():
    r = fakeredis.FakeRedis(decode_responses=True)
    ts = NOW.timestamp()
    fresh = {"value": 1.0, "date": "2026-10-20", "ts": ts - 60}
    stale = {"value": 2.0, "date": "2026-10-20", "ts": ts - 660}
    r.set(ii.INTRADAY_KEY, json.dumps({"KR:0001": fresh, "KR:1001": stale}))
    assert ii.load_intraday(r, now_ts=ts) == {"KR:0001": fresh}


def test_window_converts_aware_utc_to_kst_and_rejects_naive():
    assert ii.in_intraday_window(datetime(2026, 10, 20, 0, 30, tzinfo=timezone.utc)) is True  # KST 09:30
    assert ii.in_intraday_window(datetime(2026, 10, 20, 0, 0, tzinfo=timezone.utc)) is True   # KST 09:00
    assert ii.in_intraday_window(datetime(2026, 10, 20, 6, 35, tzinfo=timezone.utc)) is False  # KST 15:35
    with pytest.raises(ValueError):
        ii.in_intraday_window(datetime(2026, 10, 20, 10, 0))
    with pytest.raises(ValueError):
        ii.poll(_Client(), fakeredis.FakeRedis(decode_responses=True), datetime(2026, 10, 20, 10, 0))


def test_poll_uses_kst_date_for_utc_now():
    # UTC 15:30(전날) = KST 00:30 다음 날 → 오늘은 KST 날짜
    r = fakeredis.FakeRedis(decode_responses=True)
    c = _Client(day="20261020")
    ii.poll(c, r, datetime(2026, 10, 19, 15, 30, tzinfo=timezone.utc))
    assert ("U", "0001", "20261020", "20261020") in c.calls


def test_merge_drops_future_ts_after_clock_rewind():
    ts = NOW.timestamp()
    prev = {"KR:0001": {"value": 1.0, "date": "2026-10-20", "ts": ts + 120}}
    assert ii.merge_intraday(prev, {}, ts) == {}


def test_window_closed_on_krx_year_end_holiday():
    assert ii.in_intraday_window(datetime(2026, 12, 31, 10, 0, tzinfo=ii.KST)) is False  # 평일이지만 KRX 연말 휴장
