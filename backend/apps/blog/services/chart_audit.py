"""차트 포함 글 점검(관리자 조회 전용) — 시세 재배포 계약 없이 공개하면 안 되는 차트 이미지를 품은 글을 찾는다.

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 3-6절, 6절 P1 7번
- 관리자 편집기의 '차트 삽입'은 `<img src="data:image/png;base64,..." alt="차트 스냅샷">` 를 본문 HTML 에 직접 박는다
  (admin_web/src/components/RichTextEditor.tsx). 파일 업로드·URL 변환 경로는 없다.
- 판정은 `<img>` 태그 단위(HTMLParser) — 속성 순서·따옴표 종류·대소문자·엔티티와 무관하다.
  · alt 가 '차트 스냅샷' 이면 chart_count
  · 그 외 src 가 data:image/ 로 시작하면 other_inline_images(alt 가 지워진 차트일 수도 있어 함께 보여준다)
  · 일반 URL 이미지·본문 글자 '차트 스냅샷' 은 세지 않는다
- 조회만 한다. 이미지 제거·글 삭제는 관리자가 기존 편집 화면에서 직접 한다(자동 수정 없음).
"""
from __future__ import annotations

from html.parser import HTMLParser

from sqlalchemy.ext.asyncio import AsyncSession

from .. import moderation_schemas as ms
from ..repositories import chart_audit_repo as repo

CHART_ALT = repo.CHART_ALT
CHART_POSTS_LIMIT_MAX = 1000


class _ImgCounter(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.chart = 0
        self.other_inline = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "img":  # HTMLParser 가 태그·속성 이름을 소문자로 바꿔 준다
            return
        a = {k: (v or "") for k, v in attrs}
        if a.get("alt", "").strip() == CHART_ALT:
            self.chart += 1
        elif a.get("src", "").strip().lower().startswith("data:image/"):
            self.other_inline += 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)  # <img ... /> 형태


def count_inline_images(html: str | None) -> tuple[int, int]:
    """(차트 스냅샷 이미지 수, 그 외 data:image 내장 이미지 수)."""
    if not html:
        return 0, 0
    p = _ImgCounter()
    p.feed(html)
    p.close()
    return p.chart, p.other_inline


async def list_chart_posts(db: AsyncSession, limit: int) -> list[ms.ChartPostOut]:
    """차트·내장 이미지가 하나라도 있는 글, 최신순. 본문은 내려보내지 않는다."""
    limit = max(1, min(limit, CHART_POSTS_LIMIT_MAX))
    out: list[ms.ChartPostOut] = []
    for r in await repo.candidate_rows(db):
        chart, other = count_inline_images(r.content)
        if chart == 0 and other == 0:
            continue
        out.append(ms.ChartPostOut(
            id=r.id, title=r.title, board_id=r.board_id, board_name=r.board_name,
            created_at=r.created_at, updated_at=r.updated_at, featured=r.featured_at is not None,
            chart_count=chart, other_inline_images=other,
        ))
        if len(out) >= limit:
            break
    return out
