"""퀴즈·아카데미 문항 관리자 편집(백로그 ⑤-2) 테스트 — sqlite + 목(실 CH·DB 미사용)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, User, UserRole
from shared.game_models import AcademyQuestion, ChartQuiz, UserQuizAttempt
from apps.trading_game.main import app


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def session(maker):
    async with maker() as s:
        yield s


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
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, (lambda u: state.__setitem__("user", u))
    app.dependency_overrides.clear()


async def _seed_user(db, role: UserRole = UserRole.FREE, nickname: str = "플레이어") -> User:
    u = User(nickname=nickname, role=role, is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


# ---------------------------------------------------------------- models
async def test_academy_question_roundtrip_defaults(session):
    q = AcademyQuestion(question="질문?", choices=["가", "나"], answer=1, explanation="해설", sort_order=2)
    session.add(q)
    await session.commit()
    await session.refresh(q)
    assert q.id is not None and q.choices == ["가", "나"] and q.is_active is True
    assert q.created_at is not None and q.updated_at is not None


async def test_chart_quiz_is_active_default_true(session):
    q = ChartQuiz(
        ticker="005930", base_date=date(2026, 1, 1), pattern_type="정배열", chart_snapshot=[],
        answer="UP", actual_change=Decimal("1.50"), explanation="-",
    )
    session.add(q)
    await session.commit()
    await session.refresh(q)
    assert q.is_active is True


# ---------------------------------------------------------------- academy (DB 전환)
from apps.trading_game.services import academy_service
from shared.game_models import UserAcademy


async def _seed_questions(db, specs: list[tuple[int, bool]]) -> list[AcademyQuestion]:
    """specs: (sort_order, is_active). 정답은 항상 1(선택지 3개)."""
    rows = [
        AcademyQuestion(
            question=f"Q{i}", choices=["a", "b", "c"], answer=1, explanation=f"E{i}",
            sort_order=order, is_active=active,
        )
        for i, (order, active) in enumerate(specs)
    ]
    db.add_all(rows)
    await db.commit()
    return rows


async def test_active_questions_sorted_and_filtered(session):
    rows = await _seed_questions(session, [(3, True), (1, True), (2, False)])
    active = await academy_service.list_active(session)
    assert [q.id for q in active] == [rows[1].id, rows[0].id]


async def test_submit_requires_all_active_correct_ignores_inactive(session):
    user = await _seed_user(session)
    rows = await _seed_questions(session, [(1, True), (2, True), (3, False)])
    results, unlocked = await academy_service.submit(session, user.id, {rows[0].id: 1, rows[1].id: 0})
    assert unlocked is False and [r["correct"] for r in results] == [True, False]
    results, unlocked = await academy_service.submit(session, user.id, {rows[0].id: 1, rows[1].id: 1})
    assert unlocked is True and [r["id"] for r in results] == [rows[0].id, rows[1].id]  # 비활성 미포함


async def test_submit_no_active_questions_409_without_attempt(session):
    user = await _seed_user(session)
    await _seed_questions(session, [(1, False)])
    with pytest.raises(academy_service.AcademyError) as ei:
        await academy_service.submit(session, user.id, {})
    assert ei.value.code == "NO_QUESTIONS"
    assert await session.get(UserAcademy, user.id) is None  # attempts 미증가·해금 없음


async def test_unlocked_user_keeps_unlock_after_question_added(session):
    user = await _seed_user(session)
    rows = await _seed_questions(session, [(1, True)])
    _, unlocked = await academy_service.submit(session, user.id, {rows[0].id: 1})
    assert unlocked is True
    await _seed_questions(session, [(2, True)])
    _, unlocked = await academy_service.submit(session, user.id, {rows[0].id: 1})
    assert unlocked is True and await academy_service.is_unlocked(session, user.id)


async def test_router_user_academy_active_only_and_no_questions(api, maker):
    client, set_user = api
    async with maker() as db:
        set_user(await _seed_user(db))
    r = await client.get("/api/game/academy/quiz")
    assert r.status_code == 200 and r.json() == {"unlocked": False, "questions": []}
    r = await client.post("/api/game/academy/submit", json={"answers": {}})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NO_QUESTIONS"

    async with maker() as db:
        rows = await _seed_questions(db, [(2, True), (1, True), (0, False)])
    r = await client.get("/api/game/academy/quiz")
    qs = r.json()["questions"]
    assert [q["id"] for q in qs] == [rows[1].id, rows[0].id]
    assert all(set(q) == {"id", "question", "choices"} for q in qs)


def _q_body(**over) -> dict:
    b = {"question": "질문?", "choices": ["가", "나", "다"], "answer": 2, "explanation": "해설",
         "sort_order": 5, "is_active": True}
    b.update(over)
    return b


async def test_router_admin_academy_crud(api, maker):
    client, set_user = api
    async with maker() as db:
        set_user(await _seed_user(db, UserRole.ADMIN, "관리자"))
        await _seed_questions(db, [(1, False)])
    r = await client.get("/api/game/admin/academy/questions")
    assert r.status_code == 200 and len(r.json()) == 1 and r.json()[0]["is_active"] is False  # 비활성 포함

    r = await client.post("/api/game/admin/academy/questions", json=_q_body(question="  새 질문  "))
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["question"] == "새 질문" and created["answer"] == 2 and created["choices"] == ["가", "나", "다"]
    assert {"id", "sort_order", "is_active", "explanation", "created_at", "updated_at"} <= set(created)

    r = await client.put(f"/api/game/admin/academy/questions/{created['id']}",
                         json=_q_body(choices=["O", "X"], answer=0, is_active=False))
    assert r.status_code == 200 and r.json()["choices"] == ["O", "X"] and r.json()["is_active"] is False

    r = await client.get("/api/game/admin/academy/questions")
    assert [q["sort_order"] for q in r.json()] == [1, 5]

    assert (await client.delete(f"/api/game/admin/academy/questions/{created['id']}")).status_code == 204
    assert len((await client.get("/api/game/admin/academy/questions")).json()) == 1
    assert (await client.delete(f"/api/game/admin/academy/questions/{created['id']}")).status_code == 404
    r = await client.put("/api/game/admin/academy/questions/9999", json=_q_body())
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize("over", [
    {"choices": ["하나"]},
    {"choices": ["1", "2", "3", "4", "5", "6", "7"]},
    {"choices": ["가", "x" * 201]},
    {"choices": ["가", "   "]},
    {"answer": 3},
    {"answer": -1},
    {"question": ""},
    {"question": "q" * 501},
    {"explanation": ""},
    {"explanation": "e" * 1001},
])
async def test_router_admin_academy_validation(api, maker, over):
    client, set_user = api
    async with maker() as db:
        set_user(await _seed_user(db, UserRole.ADMIN, "관리자"))
    r = await client.post("/api/game/admin/academy/questions", json=_q_body(**over))
    assert r.status_code == 422, r.text


async def test_router_admin_academy_boundaries_ok(api, maker):
    client, set_user = api
    async with maker() as db:
        set_user(await _seed_user(db, UserRole.ADMIN, "관리자"))
    body = _q_body(choices=["1", "2", "3", "4", "5", "c" * 200], answer=5,
                   question="q" * 500, explanation="e" * 1000)
    assert (await client.post("/api/game/admin/academy/questions", json=body)).status_code == 201


async def test_router_admin_academy_forbidden_for_player(api, maker):
    client, set_user = api
    async with maker() as db:
        set_user(await _seed_user(db))
    assert (await client.get("/api/game/admin/academy/questions")).status_code == 403
    assert (await client.post("/api/game/admin/academy/questions", json=_q_body())).status_code == 403
    assert (await client.put("/api/game/admin/academy/questions/1", json=_q_body())).status_code == 403
    assert (await client.delete("/api/game/admin/academy/questions/1")).status_code == 403


# ---------------------------------------------------------------- quiz: 활성 필터
from datetime import timedelta

from apps.collector.tasks import quiz as quiz_task
from apps.trading_game.services import quiz_service
from scripts import generate_chart_quiz as gen

T0 = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)


async def _seed_quizzes(db, n: int, *, active: bool = True, start: date = date(2026, 1, 1)) -> list[ChartQuiz]:
    rows = [
        ChartQuiz(
            ticker="005930", base_date=start + timedelta(days=i), pattern_type="정배열",
            chart_snapshot=[{"date": "2026-01-01", "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1}],
            answer="UP", actual_change=Decimal("2.50"), explanation=f"해설{i}", is_active=active,
        )
        for i in range(n)
    ]
    db.add_all(rows)
    await db.commit()
    return rows


async def test_serve_random_skips_inactive(session):
    user = await _seed_user(session)
    await _seed_quizzes(session, 2, active=False)
    active = await _seed_quizzes(session, 1, start=date(2026, 6, 1))
    q = await quiz_service.serve_random(session, user.id, now=T0)
    assert q.id == active[0].id
    with pytest.raises(quiz_service.QuizError):
        await quiz_service.serve_random(session, user.id, now=T0)


async def test_inactive_after_serve_still_submittable(session):
    user = await _seed_user(session)
    rows = await _seed_quizzes(session, 1)
    await quiz_service.serve_random(session, user.id, now=T0)
    rows[0].is_active = False
    await session.commit()
    res = await quiz_service.submit(session, user.id, rows[0].id, "UP", redis=None, now=T0)
    assert res.correct is True


async def test_count_unseen_excludes_inactive(session):
    await _seed_quizzes(session, 2, active=False)
    await _seed_quizzes(session, 3, start=date(2026, 6, 1))
    assert await quiz_task.count_unseen(session) == 3


# ---------------------------------------------------------------- quiz: 관리자 API
async def _admin_client(api, maker):
    client, set_user = api
    async with maker() as db:
        set_user(await _seed_user(db, UserRole.ADMIN, "관리자"))
    return client


async def test_router_admin_quiz_list_paging_filter_attempts(api, maker):
    client = await _admin_client(api, maker)
    async with maker() as db:
        rows = await _seed_quizzes(db, 3)
        await _seed_quizzes(db, 2, active=False, start=date(2026, 6, 1))
        player = await _seed_user(db, nickname="p")
        db.add(UserQuizAttempt(user_id=player.id, quiz_id=rows[0].id, served_at=T0))
        await db.commit()
    r = await client.get("/api/game/admin/quizzes", params={"page": 1, "size": 2})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["total"] == 5 and data["page"] == 1 and data["size"] == 2 and len(data["items"]) == 2
    assert [i["id"] for i in data["items"]] == [5, 4]  # 최신순
    assert set(data["items"][0]) >= {"id", "ticker", "base_date", "pattern_type", "answer", "actual_change",
                                     "is_active", "attempt_count"}
    assert "chart_snapshot" not in data["items"][0]
    r = await client.get("/api/game/admin/quizzes", params={"page": 3, "size": 2})
    assert [i["id"] for i in r.json()["items"]] == [rows[0].id] and r.json()["items"][0]["attempt_count"] == 1
    r = await client.get("/api/game/admin/quizzes", params={"active": "false"})
    assert r.json()["total"] == 2 and all(not i["is_active"] for i in r.json()["items"])
    r = await client.get("/api/game/admin/quizzes", params={"active": "true"})
    assert r.json()["total"] == 3
    assert (await client.get("/api/game/admin/quizzes", params={"size": 101})).status_code == 422
    assert (await client.get("/api/game/admin/quizzes", params={"page": 0})).status_code == 422


async def test_router_admin_quiz_detail(api, maker):
    client = await _admin_client(api, maker)
    async with maker() as db:
        rows = await _seed_quizzes(db, 1)
    r = await client.get(f"/api/game/admin/quizzes/{rows[0].id}")
    assert r.status_code == 200
    d = r.json()
    assert d["chart_snapshot"][0]["date"] == "2026-01-01" and d["answer"] == "UP"
    assert d["explanation"] == "해설0" and d["ticker"] == "005930" and d["base_date"] == "2026-01-01"
    assert d["attempt_count"] == 0 and d["is_active"] is True
    r = await client.get("/api/game/admin/quizzes/999")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NOT_FOUND"


async def test_router_admin_quiz_update_allowed_fields_only(api, maker):
    client = await _admin_client(api, maker)
    async with maker() as db:
        rows = await _seed_quizzes(db, 1)
    qid = rows[0].id
    r = await client.put(f"/api/game/admin/quizzes/{qid}",
                         json={"pattern_type": " 골든크로스 ", "explanation": "새 해설", "is_active": False})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["pattern_type"] == "골든크로스" and d["explanation"] == "새 해설" and d["is_active"] is False
    r = await client.put(f"/api/game/admin/quizzes/{qid}", json={"is_active": True})
    assert r.json()["is_active"] is True and r.json()["explanation"] == "새 해설"  # 부분 수정
    for bad in ({"answer": "DOWN"}, {"chart_snapshot": []}, {"actual_change": "9.99"},
                {"pattern_type": ""}, {"pattern_type": "p" * 51}, {"explanation": "e" * 1001}):
        assert (await client.put(f"/api/game/admin/quizzes/{qid}", json=bad)).status_code == 422, bad
    async with maker() as db:
        q = await db.get(ChartQuiz, qid)
        assert q.answer == "UP" and q.actual_change == Decimal("2.50")
    assert (await client.put("/api/game/admin/quizzes/999", json={"is_active": False})).status_code == 404


async def test_router_admin_quiz_delete(api, maker):
    client = await _admin_client(api, maker)
    async with maker() as db:
        rows = await _seed_quizzes(db, 2)
        player = await _seed_user(db, nickname="p")
        db.add(UserQuizAttempt(user_id=player.id, quiz_id=rows[0].id, served_at=T0))
        await db.commit()
    r = await client.delete(f"/api/game/admin/quizzes/{rows[0].id}")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "HAS_ATTEMPTS"
    async with maker() as db:
        assert await db.get(UserQuizAttempt, (player.id, rows[0].id)) is not None  # CASCADE 로 지워지지 않음
    assert (await client.delete(f"/api/game/admin/quizzes/{rows[1].id}")).status_code == 204
    assert (await client.delete(f"/api/game/admin/quizzes/{rows[1].id}")).status_code == 404


def _candles(closes: list[float], start=date(2026, 1, 1)) -> list[dict]:
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "open": c, "high": c, "low": c, "close": c, "volume": 100}
        for i, c in enumerate(closes)
    ]


async def test_router_admin_quiz_generate(api, maker, monkeypatch):
    client = await _admin_client(api, maker)
    candles = _candles([100.0 + (i % 7) * 3 for i in range(120)])
    monkeypatch.setattr(gen, "_fetch_tickers", lambda: ["005930"])
    monkeypatch.setattr(gen, "_fetch_candles", lambda t, start=None, end=None: candles)
    r = await client.post("/api/game/admin/quizzes/generate", json={"count": 3})
    assert r.status_code == 200, r.text
    assert r.json() == {"created": 3, "skipped": 0}
    r = await client.get("/api/game/admin/quizzes")
    assert r.json()["total"] == 3
    for bad in (0, 201):
        assert (await client.post("/api/game/admin/quizzes/generate", json={"count": bad})).status_code == 422


def test_collect_quizzes_matches_generate_rules():
    candles = _candles([100.0 + (i % 7) * 3 for i in range(66)])  # 유효 base_idx 59, 60
    import random
    quizzes = gen.collect_quizzes(5, rng=random.Random(0), fetch_tickers=lambda: ["005930"],
                                  fetch_candles=lambda t: candles)
    assert len({q["base_date"] for q in quizzes}) == len(quizzes) == 2


async def test_router_admin_quiz_forbidden_for_player(api, maker):
    client, set_user = api
    async with maker() as db:
        set_user(await _seed_user(db))
    assert (await client.get("/api/game/admin/quizzes")).status_code == 403
    assert (await client.get("/api/game/admin/quizzes/1")).status_code == 403
    assert (await client.put("/api/game/admin/quizzes/1", json={"is_active": False})).status_code == 403
    assert (await client.delete("/api/game/admin/quizzes/1")).status_code == 403
    assert (await client.post("/api/game/admin/quizzes/generate", json={"count": 1})).status_code == 403


# ---------------------------------------------------------------- 직접 출제
@pytest.mark.parametrize("closes, idx, reason", [
    ([100.0] * 64 + [103.0], 58, "INSUFFICIENT_DATA"),   # 60봉 미만
    ([100.0] * 64 + [103.0], 60, "INSUFFICIENT_DATA"),   # 이후 5봉 부족
    ([100.0] * 64 + [100.5], 59, "TOO_FLAT"),            # |+0.5%| < 1%
    ([100.0] * 30 + [140.0] * 34 + [150.0], 59, "INVALID_SERIES"),  # 하루 +40%
    ([100.0] * 30 + [0.0] + [100.0] * 33 + [103.0], 59, "INVALID_SERIES"),  # 종가 0
])
def test_evaluate_quiz_reason_codes(closes, idx, reason):
    candles = _candles(closes)
    assert gen.evaluate_quiz("005930", candles, idx) == reason
    assert gen.make_quiz("005930", candles, idx) is None  # 기존 계약 유지


def test_evaluate_quiz_success_same_as_make_quiz():
    candles = _candles([100.0] * 64 + [103.0])
    q = gen.evaluate_quiz("005930", candles, 59)
    assert isinstance(q, dict) and q == gen.make_quiz("005930", candles, 59)
    assert q["answer"] == "UP" and q["actual_change"] == Decimal("3.00")


@pytest.fixture
def ch_candles(monkeypatch):
    """gen._fetch_candles 목 — state["candles"] 반환, 호출 인자 기록."""
    state: dict = {"candles": [], "calls": []}

    def fake(ticker, start=None, end=None):
        state["calls"].append((ticker, start, end))
        return state["candles"]

    monkeypatch.setattr(gen, "_fetch_candles", fake)
    return state


async def test_router_admin_quiz_direct_create_success_then_edit(api, maker, ch_candles):
    client = await _admin_client(api, maker)
    ch_candles["candles"] = _candles([100.0] * 64 + [97.0] + [99.0] * 5)  # 기준 idx59 → 5봉 뒤 97 → -3%
    base = ch_candles["candles"][59]["date"]
    r = await client.post("/api/game/admin/quizzes", json={"ticker": " 005930 ", "base_date": base})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["ticker"] == "005930" and d["base_date"] == base and d["answer"] == "DOWN"
    assert Decimal(d["actual_change"]) == Decimal("-3.00") and len(d["chart_snapshot"]) == 60
    assert d["chart_snapshot"][-1]["date"] == base and d["is_active"] is True and d["explanation"]
    ticker, start, end = ch_candles["calls"][0]
    assert ticker == "005930" and start < date.fromisoformat(base) < end

    r = await client.put(f"/api/game/admin/quizzes/{d['id']}", json={"explanation": "직접 쓴 해설"})
    assert r.status_code == 200 and r.json()["explanation"] == "직접 쓴 해설"

    r = await client.post("/api/game/admin/quizzes", json={"ticker": "005930", "base_date": base})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "DUPLICATE"
    assert len(ch_candles["calls"]) == 1  # 중복은 CH 조회 전에 차단


@pytest.mark.parametrize("closes, base_offset, reason", [
    ([], 0, "INSUFFICIENT_DATA"),                                     # CH 데이터 없음(장애·미수집)
    ([100.0] * 64 + [103.0], 100, "INSUFFICIENT_DATA"),              # 기준일이 거래일 아님/범위 밖
    ([100.0] * 63, 59, "INSUFFICIENT_DATA"),                          # 이후 5거래일 부족
    ([100.0] * 64 + [100.5], 59, "TOO_FLAT"),
    ([100.0] * 30 + [140.0] * 34 + [150.0], 59, "INVALID_SERIES"),
])
async def test_router_admin_quiz_direct_create_reasons(api, maker, ch_candles, closes, base_offset, reason):
    client = await _admin_client(api, maker)
    ch_candles["candles"] = _candles(closes)
    base = (date(2026, 1, 1) + timedelta(days=base_offset)).isoformat()
    r = await client.post("/api/game/admin/quizzes", json={"ticker": "005930", "base_date": base})
    assert r.status_code == 422 and r.json()["detail"]["code"] == reason, r.text
    assert (await client.get("/api/game/admin/quizzes")).json()["total"] == 0


async def test_router_admin_quiz_direct_create_validation_and_forbidden(api, maker, ch_candles):
    client, set_user = api
    async with maker() as db:
        admin = await _seed_user(db, UserRole.ADMIN, "관리자")
        player = await _seed_user(db, nickname="p")
    set_user(admin)
    for bad in ({"ticker": "", "base_date": "2026-01-01"}, {"ticker": "x" * 21, "base_date": "2026-01-01"},
                {"ticker": "005930", "base_date": "nope"}, {"ticker": "005930"}):
        assert (await client.post("/api/game/admin/quizzes", json=bad)).status_code == 422, bad
    set_user(player)
    r = await client.post("/api/game/admin/quizzes", json={"ticker": "005930", "base_date": "2026-01-01"})
    assert r.status_code == 403
    assert ch_candles["calls"] == []
