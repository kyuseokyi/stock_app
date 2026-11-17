"""키움 테마(ka90001·ka90002) — 클라이언트 body·연속조회, 정규화, 수집 루프(스냅숏 유지 규칙), 스냅숏 교체·출처 선택.
HTTP·Redis 는 가짜, PG 는 sqlite(실제 키움 호출 없음)."""

from __future__ import annotations

from datetime import datetime, timezone

import fakeredis
import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from apps.collector.kis.reference_master import ThemeRow
from apps.collector.kiwoom import themes as kt
from apps.collector.kiwoom.client import KiwoomApiError, KiwoomClient, KiwoomIpError, KiwoomNotConfigured
from apps.collector.kiwoom.normalize import theme_group, theme_member_ticker
from shared import market_repo as repo
from shared.kiwoom_config import KiwoomConfig
from shared.market_models import Theme, ThemeStock
from shared.models import Base

CFG = KiwoomConfig(app_key="FAKEAPPKEY1234567890", app_secret="FAKESECRET-abcdef", rate_per_sec=4)


# ------------------------------------------------------------------ 가짜 HTTP
class _Resp:
    def __init__(self, body, headers=None):
        self.status_code = 200
        self._body = body
        self.headers = headers or {}

    def json(self):
        return self._body


def _ok(body, headers=None):
    return _Resp({"return_code": 0, "return_msg": "정상적으로 처리되었습니다", **body}, headers)


class _Session:
    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": dict(headers or {})})
        return self.script.pop(0)

    def close(self):
        pass


class _Limiter:
    def acquire(self):
        pass


def _client(script):
    token = _ok({"token": "T", "expires_dt": "20991231235959"})
    return KiwoomClient(CFG, limiter=_Limiter(), session=_Session([token, *script]),
                        redis_client=fakeredis.FakeRedis(decode_responses=True))


def _grp(cd, nm, n="5"):
    # 명세 response_example 모양(등락 필드는 쓰지 않지만 함께 온다)
    return {"thema_grp_cd": cd, "thema_nm": nm, "stk_num": n, "flu_sig": "2", "flu_rt": "+0.02",
            "rising_stk_num": "1", "fall_stk_num": "0", "dt_prft_rt": "+157.80", "main_stk": "삼성전자"}


def _stk(cd):
    return {"stk_cd": cd, "stk_nm": "x", "cur_prc": "57800", "flu_sig": "3", "pred_pre": "0", "flu_rt": "0.00"}


# ------------------------------------------------------------------ 클라이언트
def test_list_themes_body_path_and_pagination():
    p1 = _ok({"thema_grp": [_grp("319", "건강식품"), _grp("452", "SNS")]}, headers={"cont-yn": "Y", "next-key": "NK"})
    p2 = _ok({"thema_grp": [_grp("553", "반도체_후공정장비")]}, headers={"cont-yn": "N"})
    c = _client([p1, p2])
    rows = c.list_themes()
    assert [r["thema_grp_cd"] for r in rows] == ["319", "452", "553"]
    first, second = c._session.calls[1], c._session.calls[2]
    assert first["url"] == "https://api.kiwoom.com/api/dostk/thme"
    assert first["headers"]["api-id"] == "ka90001"
    # 명세 request.body — 전체검색(qry_tp=0), 통합(stex_tp=3)
    assert first["json"] == {"qry_tp": "0", "stk_cd": "", "date_tp": "1", "thema_nm": "", "flu_pl_amt_tp": "1",
                             "stex_tp": "3"}
    assert second["headers"]["cont-yn"] == "Y" and second["headers"]["next-key"] == "NK"


def test_theme_members_body_and_list_key():
    c = _client([_ok({"flu_rt": "0.00", "dt_prft_rt": "0.00", "thema_comp_stk": [_stk("005930"), _stk("000660")]})])
    rows = c.theme_members("100")
    assert [r["stk_cd"] for r in rows] == ["005930", "000660"]
    call = c._session.calls[1]
    assert call["url"] == "https://api.kiwoom.com/api/dostk/thme"
    assert call["headers"]["api-id"] == "ka90002"
    assert call["json"] == {"date_tp": "1", "thema_grp_cd": "100", "stex_tp": "3"}


# ------------------------------------------------------------------ 정규화
def test_theme_group_prefix_and_blanks():
    assert theme_group(_grp("319", " 건강식품 ")) == {"raw_code": "319", "code": "KW319", "name": "건강식품"}
    assert theme_group(_grp("", "이름")) is None
    assert theme_group(_grp("319", "  ")) is None
    assert theme_group(_grp("123456789", "너무 긴 코드")) is None  # kis_code String(10) 넘침 방지


@pytest.mark.parametrize("raw,want", [("005930", "005930"), ("005930_AL", "005930"), ("005930_NX", "005930"),
                                      ("A005930", "005930"), (" 0001A0 ", "0001A0"), ("", None), ("12345", None),
                                      (None, None)])
def test_theme_member_ticker(raw, want):
    assert theme_member_ticker({"stk_cd": raw}) == want


def test_member_tickers_dedupes():
    # 명세 예시처럼 같은 종목이 여러 번 와도 한 번만
    assert kt.member_tickers([_stk("005930"), _stk("005930_AL"), _stk(""), _stk("000660")]) == ("005930", "000660")


def test_normalize_groups_dedupes_and_drops_blank():
    out = kt.normalize_groups([_grp("1", "가"), _grp("1", "가2"), _grp("", "x"), _grp("2", "나")])
    assert [g["code"] for g in out] == ["KW1", "KW2"] and out[0]["name"] == "가"


# ------------------------------------------------------------------ 수집 루프
class _FakeThemeClient:
    def __init__(self, groups, members=None, errors=None, list_error=None):
        self.groups = groups
        self.members = members or {}
        self.errors = errors or {}
        self.list_error = list_error
        self.calls: list[str] = []
        self.closed = False

    def list_themes(self):
        if self.list_error:
            raise self.list_error
        return self.groups

    def theme_members(self, code):
        self.calls.append(code)
        if code in self.errors:
            raise self.errors[code]
        return [_stk(t) for t in self.members.get(code, [])]

    def close(self):
        self.closed = True


def _groups(n):
    return [_grp(str(100 + i), f"테마{i}") for i in range(n)]


def _store(saved):
    def store(rows, keep):
        saved["rows"], saved["keep"] = rows, keep
        return {"added": sum(len(r.tickers) for r in rows), "removed": 0, "kept": len(keep)}
    return store


def test_run_themes_collects_and_stores():
    c = _FakeThemeClient(_groups(3), {"100": ["005930", "000660"], "101": ["035420"]})
    saved: dict = {}
    out = kt.run_themes(client_factory=lambda: c, store=_store(saved), min_themes=3)
    assert c.calls == ["100", "101", "102"] and c.closed
    assert [(r.code, r.tickers) for r in saved["rows"]] == [("KW100", ("005930", "000660")), ("KW101", ("035420",)),
                                                            ("KW102", ())]
    assert saved["keep"] == set()
    assert out["themes"] == 3 and out["with_members"] == 2 and out["links"] == 3 and out["failed_count"] == 0


def test_run_themes_not_configured_is_skipped():
    def factory():
        raise KiwoomNotConfigured("없음")
    assert kt.run_themes(client_factory=factory, store=lambda *a: pytest.fail("쓰기 금지")) == {"skipped": "키움 키 없음"}


def test_run_themes_too_few_themes_does_not_write():
    c = _FakeThemeClient(_groups(5))
    out = kt.run_themes(client_factory=lambda: c, store=lambda *a: pytest.fail("쓰기 금지"), min_themes=100)
    assert "error" in out and "5개" in out["error"]
    assert c.calls == [] and c.closed


def test_run_themes_list_error_does_not_write():
    c = _FakeThemeClient([], list_error=KiwoomApiError(1999, "x"))
    out = kt.run_themes(client_factory=lambda: c, store=lambda *a: pytest.fail("쓰기 금지"), min_themes=1)
    assert "error" in out and c.closed


def test_run_themes_ip_error_is_skipped_without_write():
    c = _FakeThemeClient(_groups(3), errors={"101": KiwoomIpError(8010, "IP")})
    out = kt.run_themes(client_factory=lambda: c, store=lambda *a: pytest.fail("쓰기 금지"), min_themes=1)
    assert "skipped" in out and c.calls == ["100", "101"]


def test_run_themes_first_theme_api_error_stops():
    c = _FakeThemeClient(_groups(3), errors={"100": KiwoomApiError(1999, "시간 제한")})
    out = kt.run_themes(client_factory=lambda: c, store=lambda *a: pytest.fail("쓰기 금지"), min_themes=1)
    assert "error" in out and "1999" in out["error"]
    assert c.calls == ["100"] and c.closed


def test_run_themes_few_later_failures_keep_old_links():
    groups = _groups(40)
    c = _FakeThemeClient(groups, {g["thema_grp_cd"]: ["005930"] for g in groups},
                         errors={"105": KiwoomApiError(1999, "x"), "120": RuntimeError("boom")})
    saved: dict = {}
    out = kt.run_themes(client_factory=lambda: c, store=_store(saved), min_themes=1)  # 2/40 = 5% → 쓴다
    assert "error" not in out and out["failed_count"] == 2
    assert saved["keep"] == {"KW105", "KW120"}


def test_run_themes_many_failures_do_not_write():
    groups = _groups(10)
    c = _FakeThemeClient(groups, errors={"101": KiwoomApiError(1, "x"), "102": KiwoomApiError(1, "x")})
    out = kt.run_themes(client_factory=lambda: c, store=lambda *a: pytest.fail("쓰기 금지"), min_themes=1)
    assert "error" in out and "2/10" in out["error"]


# ------------------------------------------------------------------ 스냅숏 교체·출처 선택 (sqlite)
@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as s:
        yield s


def _kw_rows(n, tickers=("005930",)):
    return [ThemeRow(f"KW{100 + i}", f"키움테마{i}", tuple(tickers)) for i in range(n)]


T1 = datetime(2026, 11, 17, 11, 40, tzinfo=timezone.utc)  # KST 20:40


def test_sync_kiwoom_themes_idempotent_and_keeps_corrections(db):
    repo.sync_kiwoom_themes(db, [ThemeRow("KW1", "반도체", ("005930", "000660")), ThemeRow("KW2", "제약", ("068270",))],
                            now=T1)
    semi = db.scalar(select(Theme).where(Theme.kis_code == "KW1"))
    assert semi.source == "kiwoom"
    db.get(ThemeStock, (semi.id, "000660")).is_excluded = True
    db.scalar(select(Theme).where(Theme.kis_code == "KW2")).is_hidden = True
    db.add(ThemeStock(theme_id=semi.id, ticker="042700", source="admin"))
    db.commit()

    out = repo.sync_kiwoom_themes(db, [ThemeRow("KW1", "반도체/장비", ("000660", "403870"))], now=T1)
    assert out == {"themes": 1, "added": 1, "removed": 2, "kept": 0}
    rows = {(r.ticker, r.source, r.is_excluded)
            for r in db.scalars(select(ThemeStock).where(ThemeStock.theme_id == semi.id))}
    assert rows == {("000660", "kiwoom", True), ("403870", "kiwoom", False), ("042700", "admin", False)}
    gone = db.scalar(select(Theme).where(Theme.kis_code == "KW2"))
    assert gone is not None and gone.is_hidden  # 행은 남기고(보정 보존) 키움 연결만 정리
    assert db.scalars(select(ThemeStock).where(ThemeStock.theme_id == gone.id)).all() == []
    # 같은 스냅숏을 다시 넣어도 변화 없음(멱등)
    assert repo.sync_kiwoom_themes(db, [ThemeRow("KW1", "반도체/장비", ("000660", "403870"))], now=T1) == \
        {"themes": 1, "added": 0, "removed": 0, "kept": 0}


def test_sync_kiwoom_keep_codes_preserves_links(db):
    repo.sync_kiwoom_themes(db, [ThemeRow("KW1", "반도체", ("005930",))], now=T1)
    out = repo.sync_kiwoom_themes(db, [ThemeRow("KW1", "반도체", ())], keep_codes={"KW1"}, now=T1)
    assert out["removed"] == 0 and out["kept"] == 1
    assert [s.ticker for s in db.scalars(select(ThemeStock))] == ["005930"]


def test_kis_and_kiwoom_syncs_do_not_touch_each_other(db):
    repo.sync_kis_themes(db, [ThemeRow("004", "KIS반도체", ("005930",))])
    repo.sync_kiwoom_themes(db, [ThemeRow("KW004", "키움반도체", ("000660",))], now=T1)
    repo.sync_kis_themes(db, [ThemeRow("004", "KIS반도체", ("005930",))])
    repo.sync_kiwoom_themes(db, [ThemeRow("KW004", "키움반도체", ("000660",))], now=T1)
    got = {(t.kis_code, t.source, s.ticker, s.source) for t, s in db.execute(
        select(Theme, ThemeStock).join(ThemeStock, ThemeStock.theme_id == Theme.id)).all()}
    assert got == {("004", "kis", "005930", "kis"), ("KW004", "kiwoom", "000660", "kiwoom")}


def _seed_kis_and_admin(db):
    repo.sync_kis_themes(db, [ThemeRow("004", "KIS반도체", ("005930",)), ThemeRow("385", "KIS제약", ("068270",))])
    admin = Theme(name="HBM", source="admin")
    db.add(admin)
    db.flush()
    db.add(ThemeStock(theme_id=admin.id, ticker="000660", source="admin"))
    db.commit()
    return admin


def test_theme_groups_unchanged_without_kiwoom_rows(db):
    """개발 서버(키움 행 없음) 회귀 — 출처 선택이 들어가도 KIS + 관리자 테마 그대로."""
    admin = _seed_kis_and_admin(db)
    kis = {t.kis_code: t.id for t in db.scalars(select(Theme).where(Theme.source == "kis"))}
    assert repo.theme_groups(db) == {str(kis["004"]): ("KIS반도체", ["005930"]),
                                     str(kis["385"]): ("KIS제약", ["068270"]),
                                     str(admin.id): ("HBM", ["000660"])}
    assert repo.active_theme_source(db) == {"source": "kis", "snapshot_date": None, "kiwoom_themes": 0}


def test_theme_source_kiwoom_when_snapshot_big_enough(db):
    _seed_kis_and_admin(db)
    repo.sync_kiwoom_themes(db, _kw_rows(3), now=T1)
    src = repo.active_theme_source(db, min_themes=3)
    assert src["source"] == "kiwoom" and src["kiwoom_themes"] == 3
    assert src["snapshot_date"].isoformat() == "2026-11-17"


def test_theme_groups_switch_to_kiwoom_and_keep_admin(db, monkeypatch):
    admin = _seed_kis_and_admin(db)
    repo.sync_kiwoom_themes(db, _kw_rows(2, ("035420",)), now=T1)
    monkeypatch.setattr(repo, "KIWOOM_THEME_MIN", 2)
    groups = repo.theme_groups(db)
    names = sorted(n for n, _ in groups.values())
    assert names == ["HBM", "키움테마0", "키움테마1"]  # KIS 테마는 빠지고 관리자 테마는 남음
    assert groups[str(admin.id)] == ("HBM", ["000660"])


def test_theme_source_falls_back_to_kis_when_too_few(db):
    _seed_kis_and_admin(db)
    repo.sync_kiwoom_themes(db, _kw_rows(5), now=T1)
    assert repo.active_theme_source(db)["source"] == "kis"  # 기본 100개 미만 → KIS
    names = sorted(n for n, _ in repo.theme_groups(db).values())
    assert names == ["HBM", "KIS반도체", "KIS제약"]


def test_theme_source_ignores_kiwoom_themes_without_members(db):
    repo.sync_kiwoom_themes(db, _kw_rows(3, ()), now=T1)
    assert repo.active_theme_source(db, min_themes=1)["kiwoom_themes"] == 0


# ------------------------------------------------------------------ 태스크
def test_task_skipped_without_kiwoom_keys(monkeypatch):
    from apps.collector.tasks import market_data as md
    monkeypatch.setattr(md, "get_kiwoom_config", lambda: KiwoomConfig("", "", 4))
    monkeypatch.setattr(md.kiwoom_themes, "run_themes", lambda **k: pytest.fail("키 없으면 키움·PG 를 건드리지 않음"))
    assert md.collect_themes_kiwoom() == {"skipped": "키움 키 없음"}


def test_task_runs_with_client_factory_and_store(monkeypatch):
    from apps.collector.tasks import market_data as md
    seen: dict = {}
    monkeypatch.setattr(md, "get_kiwoom_config", lambda: CFG)
    monkeypatch.setattr(md.kiwoom_themes, "run_themes",
                        lambda **k: seen.update(k) or {"themes": 300})
    assert md.collect_themes_kiwoom() == {"themes": 300}
    assert seen["client_factory"] is md._kiwoom_client and seen["store"] is md._store_kiwoom_themes


def test_task_is_registered():
    from apps.collector.tasks import market_data as md
    assert md.collect_themes_kiwoom.name == "collector.collect_themes_kiwoom"
