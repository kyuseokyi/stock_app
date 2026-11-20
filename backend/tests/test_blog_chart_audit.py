"""차트 포함 글 점검(관리자 조회) — 판정 함수(img 태그 단위)와 GET /api/v1/admin/blog/chart-posts.

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 3-6절, 6절 P1 7번
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.terms import TERMS_VERSION
from apps.blog.main import app as blog_app
from apps.blog.services.chart_audit import count_inline_images
from shared.database import get_db
from shared.models import Base, BlogPost, Board, User, UserRole
from shared.security import create_access_token

URL = "/api/v1/admin/blog/chart-posts"
PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
CHART_IMG = f'<img class="rounded-lg" src="{PNG}" alt="차트 스냅샷">'  # TipTap getHTML() 모양


# ── 판정 함수 ─────────────────────────────────────────


def test_tiptap_chart_image_counted():
    assert count_inline_images(f"<p>글</p>{CHART_IMG}<p>끝</p>") == (1, 0)


def test_attribute_order_and_quotes_do_not_matter():
    html = (
        f"<img alt='차트 스냅샷' src='{PNG}'>"
        f'<IMG ALT="차트 스냅샷" SRC="{PNG}" />'
        f'<img\n  src="{PNG}"\n  alt=" 차트 스냅샷 "\n>'
    )
    assert count_inline_images(html) == (3, 0)


def test_other_inline_data_image_counted_separately():
    html = f'<img src="{PNG}" alt="내 사진"><img src="DATA:IMAGE/JPEG;base64,AAAA"><img src="{PNG}">'
    assert count_inline_images(html) == (0, 3)


def test_plain_url_images_and_text_are_ignored():
    html = (
        '<p>차트 스냅샷 이라는 글자만 있다</p>'
        '<img src="https://cdn.example.com/a.png" alt="사진">'
        '<p>data:image/png;base64,AAAA 는 글자일 뿐</p>'
    )
    assert count_inline_images(html) == (0, 0)


def test_chart_alt_with_url_src_still_counts_as_chart():
    # alt 가 차트 표식이면 src 종류와 무관하게 차트로 센다(한 이미지를 두 번 세지 않는다)
    assert count_inline_images('<img src="https://x/y.png" alt="차트 스냅샷">') == (1, 0)
    assert count_inline_images(None) == (0, 0)
    assert count_inline_images("") == (0, 0)


# ── 라우터 ────────────────────────────────────────────


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def client(maker):
    async def _db():
        async with maker() as s:
            yield s

    blog_app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=blog_app), base_url="http://test") as c:
        yield c
    blog_app.dependency_overrides.clear()


async def _user(maker, name: str, *, role=UserRole.FREE) -> User:
    async with maker() as db:
        u = User(email=f"{name}@test.local", nickname=name, role=role, is_active=True, terms_version=TERMS_VERSION)
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


def _auth(u: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(subject=u.id, role=u.role.value)}"}


@pytest.fixture
async def posts(maker):
    """차트 글(오래됨·추천), 일반 글, 내장 사진 글(최신), 글자만 있는 글, 차트+사진 글(중간)."""
    base = datetime(2026, 11, 1, tzinfo=timezone.utc)
    async with maker() as db:
        board = Board(name="시황", order_index=0)
        db.add(board)
        await db.commit()
        rows = {
            "chart": BlogPost(board_id=board.id, title="차트 글", content=f"<p>a</p>{CHART_IMG}{CHART_IMG}",
                              created_at=base, featured_at=base),
            "plain": BlogPost(board_id=board.id, title="일반 글", content="<p>그냥 글</p>",
                              created_at=base + timedelta(days=1)),
            "photo": BlogPost(board_id=board.id, title="사진 글", content=f'<img src="{PNG}" alt="사진">',
                              created_at=base + timedelta(days=3)),
            "text": BlogPost(board_id=board.id, title="글자만", content="<p>차트 스냅샷 기능 소개</p>",
                             created_at=base + timedelta(days=4)),
            "mixed": BlogPost(board_id=board.id, title="섞인 글",
                              content=f'{CHART_IMG}<img src="{PNG}"><img src="https://x/y.png">',
                              created_at=base + timedelta(days=2)),
        }
        db.add_all(rows.values())
        await db.commit()
        return {k: v.id for k, v in rows.items()} | {"board_id": board.id}


async def test_admin_lists_chart_posts_newest_first(client, maker, posts):
    admin = await _user(maker, "관리", role=UserRole.ADMIN)
    r = await client.get(URL, headers=_auth(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["id"] for x in body] == [posts["photo"], posts["mixed"], posts["chart"]]
    photo, mixed, chart = body
    assert chart["title"] == "차트 글" and chart["board_id"] == posts["board_id"] and chart["board_name"] == "시황"
    assert chart["chart_count"] == 2 and chart["other_inline_images"] == 0 and chart["featured"] is True
    assert chart["created_at"] and chart["updated_at"]
    assert mixed["chart_count"] == 1 and mixed["other_inline_images"] == 1 and mixed["featured"] is False
    assert photo["chart_count"] == 0 and photo["other_inline_images"] == 1
    assert "content" not in chart  # 본문은 내려보내지 않는다


async def test_limit_applies_after_filtering(client, maker, posts):
    admin = await _user(maker, "관리", role=UserRole.ADMIN)
    r = await client.get(URL, params={"limit": 2}, headers=_auth(admin))
    assert r.status_code == 200
    # 최신 후보 '글자만' 은 0건이라 빠지고, 그다음 해당 글 2건이 나온다
    assert [x["id"] for x in r.json()] == [posts["photo"], posts["mixed"]]


async def test_empty_when_no_chart_posts(client, maker):
    admin = await _user(maker, "관리", role=UserRole.ADMIN)
    r = await client.get(URL, headers=_auth(admin))
    assert r.status_code == 200 and r.json() == []


async def test_forbidden_for_non_admin(client, maker, posts):
    user = await _user(maker, "회원")
    assert (await client.get(URL, headers=_auth(user))).status_code == 403
    assert (await client.get(URL)).status_code == 401
