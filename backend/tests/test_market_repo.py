"""시장 참조 데이터 저장소 — 프로필·업종·테마 동기화·분석 대상·일정 (sqlite)."""
from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from apps.collector.kis.reference_master import StockProfileRow, ThemeRow
from shared import market_repo as repo
from shared.market_models import Sector, StockEvent, StockProfile, Theme, ThemeStock
from shared.models import Base, MarketType, StockMeta


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as s:
        yield s


def _p(ticker, market="KOSPI", **kw):
    base = dict(ticker=ticker, market=market, mcap_size="1", sector_l="0027", sector_m="0013", sector_s="0000",
                is_etp=False, is_spac=False, is_preferred=False, is_halted=False, is_managed=False,
                warning_code="00", listed_date=date(2000, 1, 1), listed_shares_k=100, market_cap_100m=1000,
                settle_month=12)
    base.update(kw)
    return StockProfileRow(**base)


def _meta(db, *rows):
    for t, n, m in rows:
        db.add(StockMeta(ticker=t, name=n, market=MarketType(m), is_active=True))
    db.commit()


def test_tables_exist(db):
    db.add(Sector(code="0027", name="제조"))
    db.add(Theme(kis_code="004", name="반도체", source="kis"))
    db.commit()
    assert db.scalar(select(Sector.name)) == "제조"
    assert db.scalar(select(Theme.is_hidden)) is False


def test_sync_profiles_upserts(db):
    assert repo.sync_profiles(db, [_p("005930"), _p("069500", is_etp=True)]) == 2
    assert repo.sync_profiles(db, [_p("005930", market_cap_100m=2000)]) == 1
    db.expire_all()
    assert db.get(StockProfile, "005930").market_cap_100m == 2000
    assert db.get(StockProfile, "069500").is_etp is True  # 이번 원천에 없어도 지우지 않음


def test_sync_sectors(db):
    repo.sync_sectors(db, {"0027": "제조", "0013": "전기·전자"})
    repo.sync_sectors(db, {"0027": "제조업"})
    db.expire_all()
    assert db.get(Sector, "0027").name == "제조업" and db.get(Sector, "0013").name == "전기·전자"


def test_analysis_universe_excludes_etp_spac_preferred(db):
    _meta(db, ("005930", "삼성전자", "KOSPI"), ("069500", "KODEX 200", "KOSPI"),
          ("005935", "삼성전자우", "KOSPI"), ("123456", "프로필없음", "KOSDAQ"))
    repo.sync_profiles(db, [_p("005930"), _p("069500", is_etp=True), _p("005935", is_preferred=True)])
    assert repo.analysis_universe(db) == [("005930", "삼성전자", "KOSPI")]


def test_analysis_universe_falls_back_when_no_profiles(db):
    _meta(db, ("005930", "삼성전자", "KOSPI"))
    assert repo.analysis_universe(db) == [("005930", "삼성전자", "KOSPI")]


def test_kis_theme_sync_keeps_admin_corrections(db):
    repo.sync_kis_themes(db, [ThemeRow("004", "반도체", ("005930", "000660")), ThemeRow("385", "제약", ("068270",))])
    semi = db.scalar(select(Theme).where(Theme.kis_code == "004"))
    # 관리자 보정: 숨김 / 종목 제외 / 관리자 종목 추가 / 관리자 테마
    db.scalar(select(Theme).where(Theme.kis_code == "385")).is_hidden = True
    db.get(ThemeStock, (semi.id, "000660")).is_excluded = True
    db.add(ThemeStock(theme_id=semi.id, ticker="042700", source="admin"))
    admin_theme = Theme(name="HBM", source="admin")
    db.add(admin_theme)
    db.commit()

    # 다음 날 KIS 마스터: 004 에서 005930 빠지고 403870 추가, 385 사라짐
    out = repo.sync_kis_themes(db, [ThemeRow("004", "반도체/장비", ("000660", "403870"))])
    assert out == {"themes": 1, "added": 1, "removed": 2}
    rows = {(r.ticker, r.source, r.is_excluded)
            for r in db.scalars(select(ThemeStock).where(ThemeStock.theme_id == semi.id))}
    assert rows == {("000660", "kis", True), ("403870", "kis", False), ("042700", "admin", False)}
    assert db.get(Theme, semi.id).name == "반도체/장비"
    gone = db.scalar(select(Theme).where(Theme.kis_code == "385"))
    assert gone is not None and gone.is_hidden is True  # 테마는 남기고 KIS 연결만 정리
    assert db.scalars(select(ThemeStock).where(ThemeStock.theme_id == gone.id)).all() == []
    assert db.get(Theme, admin_theme.id) is not None


def test_upsert_events_idempotent(db):
    ev = dict(event_date=date(2026, 11, 12), title="미국 CPI 발표", category="경제지표", ticker=None,
              source="fred", source_key="fred:10:2026-11-12", payload={"release_id": 10})
    assert repo.upsert_events(db, [ev]) == 1
    assert repo.upsert_events(db, [{**ev, "title": "미국 CPI 발표(수정)"}]) == 1
    db.expire_all()
    rows = db.scalars(select(StockEvent)).all()
    assert len(rows) == 1 and rows[0].title == "미국 CPI 발표(수정)" and rows[0].payload == {"release_id": 10}


def test_profile_map(db):
    repo.sync_profiles(db, [_p("005930"), _p("247540", market="KOSDAQ", sector_m="1028", settle_month=None)])
    assert repo.profile_map(db) == {"005930": ("0013", 12), "247540": ("1028", None)}


def test_names_for(db):
    _meta(db, ("005930", "삼성전자", "KOSPI"))
    assert repo.names_for(db, ["005930", "999999"]) == {"005930": "삼성전자"}
    assert repo.names_for(db, []) == {}
