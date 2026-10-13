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
