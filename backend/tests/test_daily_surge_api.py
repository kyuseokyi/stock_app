"""급등락·테마 분석 관리자 API — 목록·거르기·정렬·묶음·상세·메모·재집계·권한·네이버 뉴스 바로 보기 (sqlite)."""
from __future__ import annotations

from datetime import date

import httpx
import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.daily_surge_models import DailySurgeNote, DailySurgeStock, DailySurgeThemeGroup
from shared.database import get_db
from shared.models import Base, User, UserRole
from apps.stock_api.main import app
from apps.stock_api.routers import daily_surge_admin as router_mod
from apps.stock_api.services import daily_surge_news as news
from apps.stock_api.services import daily_surge_query as q

T = date(2026, 11, 26)
P = date(2026, 11, 25)


class _Redis:
    def __init__(self):
        self.d: dict = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ex=None, nx=False):
        if nx and k in self.d:
            return False
        self.d[k] = v
        return True

    def exists(self, k):
        return int(k in self.d)


@pytest.fixture
def redis(monkeypatch):
    r = _Redis()
    monkeypatch.setattr(news, "get_sync_redis", lambda: r)
    monkeypatch.setattr(router_mod, "get_sync_redis", lambda: r)
    return r


@pytest.fixture
def sent(monkeypatch):
    calls: list = []
    monkeypatch.setattr(router_mod.celery_app, "send_task",
                        lambda name, **kw: calls.append((name, kw)) or type("R", (), {"id": "task-1"})())
    return calls


@pytest.fixture
def board(monkeypatch):
    """성적표 입출력(PG 테마 구성·CH 일봉) 가로채기 — 화장품 테마 = A·B·E(E 는 +3% 미급등)."""
    def _load(trade_date, theme_id):
        members = {1: ["A", "B", "E"], 2: ["C", "D"]}.get(theme_id, [])
        prices = {"A": (120.0, 100.0, 100), "B": (115.0, 100.0, 100), "E": (103.0, 100.0, 50),
                  "C": (80.0, 100.0, 10), "D": (88.0, 100.0, 5)}
        return members, {t: prices[t] for t in members if t in prices}, {t: f"이름{t}" for t in members}
    monkeypatch.setattr(q, "_load_board", _load)


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def api(maker):
    state: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


def _stock(ticker, rate, value, *, surge=False, plunge=False, top=False, theme=None, theme_name=None,
           leader=False, dart=None, d=T):
    return DailySurgeStock(
        trade_date=d, ticker=ticker, name=f"이름{ticker}", market="KOSDAQ", close=100 + rate, prev_close=100.0,
        change_price=rate, change_rate=rate, volume=1000, volume_ratio=300.0, trading_value=value,
        is_surge=surge, is_plunge=plunge, is_top_value=top, primary_theme_id=theme, primary_theme_name=theme_name,
        is_theme_leader=leader, dart_items=dart or [], dart_keywords=["#유상증자"] if dart else [],
    )


async def _seed(maker, *, tier=None):
    async with maker() as s:
        admin = User(nickname="관리자", role=UserRole.ADMIN, is_active=True, admin_tier=tier)
        s.add(admin)
        s.add_all([
            _stock("A", 20.0, 1200.0, surge=True, top=True, theme=1, theme_name="화장품", leader=True),
            _stock("B", 15.0, 1150.0, surge=True, theme=1, theme_name="화장품"),
            _stock("F", 29.9, 300.0, surge=True),
            _stock("C", -20.0, 800.0, plunge=True, top=True, theme=2, theme_name="바이오", leader=True,
                   dart=[{"rcept_no": "R1", "rcept_dt": "20261125", "title": "유상증자 결정", "when": "prev",
                          "url": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=R1"}]),
            _stock("D", -12.0, 700.0, plunge=True, theme=2, theme_name="바이오"),
            _stock("V", 1.0, 90000.0, top=True),
            _stock("A", 11.0, 10.0, surge=True, d=P),
        ])
        s.add_all([
            DailySurgeThemeGroup(trade_date=T, theme_id=1, direction="up", theme_name="화장품", stock_count=2,
                                 avg_change_rate=17.5, value_sum=2350.0, leader_ticker="A", leader_name="이름A",
                                 members=["A", "B"], theme_source="kiwoom"),
            DailySurgeThemeGroup(trade_date=T, theme_id=2, direction="down", theme_name="바이오", stock_count=2,
                                 avg_change_rate=-16.0, value_sum=1500.0, leader_ticker="C", leader_name="이름C",
                                 members=["C", "D"], theme_source="kiwoom"),
            DailySurgeNote(trade_date=T, scope="theme", target="1", note="한한령 해제 기대"),
            DailySurgeNote(trade_date=T, scope="stock", target="B", note="B 단독 공급계약"),
        ])
        await s.commit()
        return admin


BASE = "/api/v1/admin/market/daily-surge"


async def test_dates(api, maker):
    client, state = api
    state["user"] = await _seed(maker)
    r = await client.get(f"{BASE}/dates")
    assert r.status_code == 200
    body = r.json()
    assert body[0] == {"date": "2026-11-26", "surge_count": 3, "plunge_count": 2, "value_count": 3, "group_count": 2}
    assert body[1]["date"] == "2026-11-25"


async def test_list_modes_defaults_and_notes(api, maker):
    client, state = api
    state["user"] = await _seed(maker)
    body = (await client.get(BASE, params={"date": "2026-11-26", "mode": "surge"})).json()
    assert body["theme_source"] == "kiwoom"
    assert [i["ticker"] for i in body["items"]] == ["F", "A", "B"]  # 등락률 내림차순
    by = {i["ticker"]: i for i in body["items"]}
    assert by["A"]["note"] == {"text": "한한령 해제 기대", "scope": "theme", "theme_name": "화장품"}
    assert by["B"]["note"] == {"text": "B 단독 공급계약", "scope": "stock", "theme_name": None}
    assert by["F"]["note"] is None
    plunge = (await client.get(BASE, params={"date": "2026-11-26", "mode": "plunge"})).json()["items"]
    assert [i["ticker"] for i in plunge] == ["C", "D"]  # 하락폭 큰 순
    value = (await client.get(BASE, params={"date": "2026-11-26", "mode": "value"})).json()["items"]
    assert [i["ticker"] for i in value] == ["V", "A", "C"]
    both = (await client.get(BASE, params={"date": "2026-11-26", "mode": "surge_value"})).json()["items"]
    assert [i["ticker"] for i in both] == ["A"]


async def test_list_band_dart_market_sort(api, maker):
    client, state = api
    state["user"] = await _seed(maker)
    band = (await client.get(BASE, params={"date": "2026-11-26", "mode": "surge", "band": "25_30"})).json()["items"]
    assert [i["ticker"] for i in band] == ["F"]
    band2 = (await client.get(BASE, params={"date": "2026-11-26", "mode": "plunge", "band": "10_15"})).json()["items"]
    assert [i["ticker"] for i in band2] == ["D"]
    dart = (await client.get(BASE, params={"date": "2026-11-26", "mode": "plunge", "dart_only": "true"})).json()
    assert [i["ticker"] for i in dart["items"]] == ["C"]
    assert dart["items"][0]["dart_items"][0]["when"] == "prev"
    srt = (await client.get(BASE, params={"date": "2026-11-26", "mode": "surge", "sort": "trading_value",
                                          "order": "asc"})).json()["items"]
    assert [i["ticker"] for i in srt] == ["F", "B", "A"]
    kospi = (await client.get(BASE, params={"date": "2026-11-26", "mode": "surge", "market": "KOSPI"})).json()
    assert kospi["items"] == []
    empty = (await client.get(BASE, params={"date": "2026-01-02", "mode": "surge"})).json()
    assert empty == {"date": "2026-01-02", "theme_source": None, "items": []}
    assert (await client.get(BASE, params={"date": "2026-11-26", "mode": "nope"})).status_code == 422


async def test_groups(api, maker):
    client, state = api
    state["user"] = await _seed(maker)
    up = (await client.get(f"{BASE}/groups", params={"date": "2026-11-26", "direction": "up"})).json()
    assert [g["theme_id"] for g in up] == [1]
    assert up[0]["note"] == "한한령 해제 기대" and up[0]["members"] == ["A", "B"]
    allg = (await client.get(f"{BASE}/groups", params={"date": "2026-11-26"})).json()
    assert [g["direction"] for g in allg] == ["up", "down"]


async def test_stock_detail_with_board(api, maker, board):
    client, state = api
    state["user"] = await _seed(maker)
    r = await client.get(f"{BASE}/2026-11-26/stocks/B")
    assert r.status_code == 200
    body = r.json()
    assert body["stock"]["ticker"] == "B"
    assert body["notes"] == {"stock": "B 단독 공급계약", "theme": "한한령 해제 기대"}
    rows = body["board"]
    assert [x["ticker"] for x in rows] == ["A", "B", "E"]  # 거래대금 내림차순
    assert rows[0]["is_leader"] is True and rows[0]["in_group"] is True
    assert rows[2]["in_group"] is False and rows[2]["change_rate"] == 3.0
    assert (await client.get(f"{BASE}/2026-11-26/stocks/ZZZ")).status_code == 404


async def test_theme_detail(api, maker, board):
    client, state = api
    state["user"] = await _seed(maker)
    body = (await client.get(f"{BASE}/2026-11-26/themes/2", params={"direction": "down"})).json()
    assert body["group"]["leader_ticker"] == "C" and body["note"] is None
    assert [x["ticker"] for x in body["board"]] == ["C", "D"]
    assert (await client.get(f"{BASE}/2026-11-26/themes/9", params={"direction": "up"})).status_code == 404


async def test_notes_put_delete(api, maker):
    client, state = api
    state["user"] = await _seed(maker)
    payload = {"date": "2026-11-26", "scope": "theme", "target": "2", "note": "  임상 실패 우려  "}
    assert (await client.put(f"{BASE}/notes", json=payload)).status_code == 200
    payload["note"] = "임상 결과 지연"
    assert (await client.put(f"{BASE}/notes", json=payload)).json()["note"] == "임상 결과 지연"
    async with maker() as s:
        n = await s.scalar(select(func.count()).select_from(DailySurgeNote).where(DailySurgeNote.target == "2"))
        assert n == 1
    assert (await client.put(f"{BASE}/notes", json={**payload, "note": "   "})).status_code == 422
    assert (await client.put(f"{BASE}/notes", json={**payload, "scope": "x"})).status_code == 422
    r = await client.delete(f"{BASE}/notes", params={"date": "2026-11-26", "scope": "theme", "target": "2"})
    assert r.status_code == 204
    up = (await client.get(f"{BASE}/groups", params={"date": "2026-11-26", "direction": "down"})).json()
    assert up[0]["note"] is None


async def test_rebuild(api, maker, redis, sent):
    client, state = api
    state["user"] = await _seed(maker)
    r = await client.post(f"{BASE}/rebuild", params={"date": "2026-11-26"})
    assert r.status_code == 202 and r.json() == {"task_id": "task-1", "date": "2026-11-26"}
    assert sent == [("collector.analyze_daily_surge", {"kwargs": {"date": "2026-11-26"}})]
    redis.d["lock:daily_surge:2026-11-26"] = "x"
    r = await client.post(f"{BASE}/rebuild", params={"date": "2026-11-26"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ALREADY_RUNNING"


@pytest.mark.parametrize("tier,view,rebuild", [("EDITOR", 403, 403), ("ANALYST", 200, 403), ("OPERATOR", 200, 202)])
async def test_permissions(api, maker, redis, sent, tier, view, rebuild):
    client, state = api
    state["user"] = await _seed(maker, tier=tier)
    assert (await client.get(BASE, params={"date": "2026-11-26", "mode": "surge"})).status_code == view
    note = {"date": "2026-11-26", "scope": "stock", "target": "A", "note": "메모"}
    assert (await client.put(f"{BASE}/notes", json=note)).status_code == view
    assert (await client.post(f"{BASE}/rebuild", params={"date": "2026-11-26"})).status_code == rebuild


async def test_non_admin_forbidden(api, maker):
    client, state = api
    await _seed(maker)
    state["user"] = User(id=999, nickname="일반", role=UserRole.FREE, is_active=True)
    assert (await client.get(f"{BASE}/dates")).status_code == 403


# ------------------------------------------------------------------ 네이버 뉴스 바로 보기
class _News:
    def __init__(self, items):
        self.items = items
        self.calls: list = []

    def search(self, query, *, display=5, sort="date"):
        self.calls.append((query, display, sort))
        return self.items


def _item(title, pub, link="https://n.news.naver.com/x", orig="https://press.example/a"):
    return news.NewsItem(title=title, description="", originallink=orig, link=link, pub_date=pub)


async def test_news_keeps_order_adds_slot_and_caches(api, maker, redis, monkeypatch):
    client, state = api
    state["user"] = await _seed(maker)
    fake = _News([
        _item("장후 기사", "Thu, 26 Nov 2026 16:05:00 +0900"),
        _item("장전 기사", "Thu, 26 Nov 2026 08:12:00 +0900", orig=""),
        _item("다른 날", "Mon, 23 Nov 2026 10:00:00 +0900"),
    ])
    monkeypatch.setattr(news, "get_naver_news_client", lambda: fake)
    params = {"kind": "stock", "date": "2026-11-26", "target": "A", "q": "아무 검색어"}
    body = (await client.get(f"{BASE}/news", params=params)).json()
    assert body["source"] == "naver_news_search" and body["query"] == "이름A 특징주"
    assert body["unavailable"] is False
    assert [(i["title"], i["time_slot"]) for i in body["items"]] == [
        ("장후 기사", "post"), ("장전 기사", "pre"), ("다른 날", "other")]
    assert body["items"][1]["url"] == "https://n.news.naver.com/x"  # 원문 링크 없으면 네이버 링크
    assert fake.calls == [("이름A 특징주", 10, "date")]
    await client.get(f"{BASE}/news", params=params)
    assert len(fake.calls) == 1  # 5분 캐시
    theme = (await client.get(f"{BASE}/news", params={"kind": "theme", "date": "2026-11-26", "target": "1"})).json()
    assert theme["query"] == "화장품 관련주"
    async with maker() as s:  # 뉴스는 어디에도 저장하지 않는다
        assert await s.scalar(select(func.count()).select_from(DailySurgeNote)) == 2


async def test_news_unavailable(api, maker, redis, monkeypatch):
    client, state = api
    state["user"] = await _seed(maker)
    monkeypatch.setattr(news, "get_naver_news_client", lambda: None)
    body = (await client.get(f"{BASE}/news", params={"kind": "stock", "date": "2026-11-26", "target": "A"})).json()
    assert body["items"] == [] and body["unavailable"] is True
    monkeypatch.setattr(news, "get_naver_news_client", lambda: _News([]))
    body = (await client.get(f"{BASE}/news", params={"kind": "stock", "date": "2026-11-26", "target": "B"})).json()
    assert body["items"] == [] and body["unavailable"] is False  # 기사 0건 ≠ 키 없음
    assert (await client.get(f"{BASE}/news", params={"kind": "stock", "date": "2026-11-26",
                                                       "target": "ZZZ"})).status_code == 404


async def test_rebuild_rejects_non_trading_or_future_day(api, maker, redis, sent):
    client, state = api
    state["user"] = await _seed(maker)
    for d in ("2026-11-28", "2099-01-05"):  # 토요일, 미래
        r = await client.post(f"{BASE}/rebuild", params={"date": d})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "NOT_TRADING_DAY"
    assert sent == []


async def test_theme_note_target_must_be_number(api, maker):
    client, state = api
    state["user"] = await _seed(maker)
    bad = {"date": "2026-11-26", "scope": "theme", "target": "화장품", "note": "메모"}
    assert (await client.put(f"{BASE}/notes", json=bad)).status_code == 422
    ok = {**bad, "scope": "stock", "target": "A"}
    assert (await client.put(f"{BASE}/notes", json=ok)).status_code == 200
