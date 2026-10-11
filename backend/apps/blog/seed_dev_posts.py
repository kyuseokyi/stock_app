"""개발용 샘플 게시글 시드 스크립트 (블로그 서버).

로컬에서 web_client/모바일의 목록·상세·추천·댓글 화면을 채워 육안 확인하기 위한
더미 데이터를 멱등하게 생성한다. 제목이 이미 있으면 건너뛰므로 재실행해도 안전하다.

실행:
    cd backend
    uv run python -m apps.blog.seed_dev_posts

주의: 운영 DB에는 절대 실행하지 말 것. 로컬(stock_db)에서만 사용한다.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.models import Board, BlogComment, BlogPost, User

# 게시판 이름 -> 샘플 글 목록. (title, content_html, featured)
POSTS: dict[str, list[tuple[str, str, bool]]] = {
    "시황분석": [
        (
            "코스피, 외국인 순매수 전환… 반도체가 끌었다",
            "<h2>오늘의 시황</h2>"
            "<p>코스피가 외국인 <strong>순매수 전환</strong>에 힘입어 상승 마감했습니다. "
            "반도체 대형주가 지수를 견인했고, 2차전지는 혼조세를 보였습니다.</p>"
            "<ul><li>삼성전자 +2.1%</li><li>SK하이닉스 +3.4%</li><li>LG에너지솔루션 -0.8%</li></ul>"
            "<p>단기적으로는 환율과 미국 금리 흐름을 함께 봐야 합니다.</p>",
            True,
        ),
        (
            "원/달러 환율 다시 1,350원대… 수출주 영향은",
            "<p>환율이 재차 1,350원대로 올라섰습니다. 수출 비중이 높은 업종엔 "
            "<strong>단기 우호적</strong>이지만, 원자재 수입 비중이 큰 기업엔 부담입니다.</p>"
            "<p>업종별로 민감도가 다르니 포지션을 나눠 접근하는 편이 안전합니다.</p>",
            False,
        ),
    ],
    "교차검증판": [
        (
            "넥스트레이드(NXT) 통합 시세, MTS와 왜 다르게 보일까",
            "<h2>UN 통합 시세 이야기</h2>"
            "<p>2025년 넥스트레이드 출범 이후 한투 MTS 차트는 <strong>KRX+NXT 통합(UN)</strong> "
            "시세를 보여줍니다. KRX 단독(J)으로만 보면 거래량·종가가 MTS와 달라질 수 있어요.</p>"
            "<p>예: 삼성전자 특정일 기준 J 종가와 UN 종가가 수천 원 차이 나기도 합니다. "
            "데이터를 교차검증할 땐 어느 시장코드로 조회했는지부터 확인하세요.</p>",
            True,
        ),
        (
            "배당 반영 수정주가, KIS가 안 주는 이유",
            "<p>KIS 수정주가는 액면분할/병합만 반영하고 <strong>배당은 미반영</strong>입니다. "
            "장기 성과를 볼 땐 배당 재투자 가정의 총수익(Total Return)을 따로 계산해야 합니다.</p>",
            False,
        ),
    ],
    "공지사항": [
        (
            "커뮤니티 이용 안내 및 운영 원칙",
            "<p>안녕하세요. 건강한 토론 문화를 위해 몇 가지 원칙을 안내드립니다.</p>"
            "<ul><li>종목 추천을 가장한 광고 금지</li>"
            "<li>근거 없는 허위 정보 공유 자제</li>"
            "<li>상호 존중하는 댓글 문화</li></ul>"
            "<p>투자 판단과 책임은 본인에게 있습니다.</p>",
            False,
        ),
    ],
    "공지(댓글off)": [
        (
            "[점검] 정기 데이터 수집 일정 변경 안내",
            "<p>데이터 파이프라인 안정화를 위해 야간 수집 배치 시간이 조정됩니다. "
            "서비스 조회에는 영향이 없습니다.</p>"
            "<p>문의는 공지사항 게시판 댓글로 남겨 주세요.</p>",
            False,
        ),
    ],
}

# 댓글은 '댓글 허용' 게시판 글에만 단다. (글 제목 -> 댓글 내용 목록)
COMMENTS: dict[str, list[str]] = {
    "넥스트레이드(NXT) 통합 시세, MTS와 왜 다르게 보일까": [
        "오 이거 때문에 한참 헤맸는데 정리 감사합니다 👍",
        "UN 미상장 종목은 J로 폴백해야 하는 것도 주의해야겠네요.",
    ],
    "코스피, 외국인 순매수 전환… 반도체가 끌었다": [
        "반도체 비중 다시 늘려야 하나 고민되네요.",
    ],
}


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        # 작성자/댓글용 기본 사용자(관리자) 확보. 없으면 author_id 는 비워 둔다.
        admin = (
            await db.execute(select(User).order_by(User.id).limit(1))
        ).scalar_one_or_none()
        author_id = admin.id if admin else None

        # 활성 게시판 로드 (이름 -> Board)
        boards = (await db.execute(select(Board))).scalars().all()
        by_name = {b.name: b for b in boards}

        now = datetime.now(timezone.utc)
        featured_rank = 0
        created_posts = 0
        title_to_post: dict[str, BlogPost] = {}

        for board_name, entries in POSTS.items():
            board = by_name.get(board_name)
            if board is None:
                print(f"[seed] skip (게시판 없음): {board_name}")
                continue
            for title, content, featured in entries:
                exists = (
                    await db.execute(select(BlogPost).where(BlogPost.title == title))
                ).scalar_one_or_none()
                if exists is not None:
                    title_to_post[title] = exists
                    continue
                post = BlogPost(
                    board_id=board.id,
                    author_id=author_id,
                    title=title,
                    content=content,
                    view_count=0,
                )
                if featured:
                    # 최근 추천 순 노출을 위해 rank 만큼 과거로 어긋나게 설정
                    post.featured_at = now - timedelta(minutes=featured_rank)
                    featured_rank += 1
                db.add(post)
                title_to_post[title] = post
                created_posts += 1

        await db.flush()  # post.id 확보

        created_comments = 0
        if author_id is not None:
            for title, texts in COMMENTS.items():
                post = title_to_post.get(title)
                if post is None or post.id is None:
                    continue
                for text in texts:
                    dup = (
                        await db.execute(
                            select(BlogComment).where(
                                BlogComment.post_id == post.id,
                                BlogComment.content == text,
                            )
                        )
                    ).scalar_one_or_none()
                    if dup is not None:
                        continue
                    db.add(
                        BlogComment(post_id=post.id, author_id=author_id, content=text)
                    )
                    created_comments += 1

        await db.commit()
        print(
            f"[seed_dev_posts] posts +{created_posts}, comments +{created_comments} "
            f"(author_id={author_id})"
        )


if __name__ == "__main__":
    asyncio.run(seed())
