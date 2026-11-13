"""닉네임 금칙어 — 욕설·비하·성적 표현·운영자 사칭 차단(R2).

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §3
- 판정: NFKC 정규화(전각 → 반각) → 소문자 → 공백·특수문자·숫자 제거 → 금칙어 부분 일치.
  숫자도 지운다 — "시1발"·"관2리자" 처럼 숫자를 끼워 피하는 경우를 막는다.
- 걸리면 가입 경로에서 기본값(유저####)으로 바꾼다. 관리자 강제 변경(PATCH /admin/users/{id}/nickname)은 검사하지 않는다.
- 부분 일치라 "badminton" 처럼 금칙어를 품은 정상 단어도 걸린다 — 닉네임은 기본값으로 바뀔 뿐이라 보수적으로 둔다.
"""
from __future__ import annotations

import re
import secrets
import unicodedata

# 운영자 사칭
_IMPERSONATION = (
    "관리자", "운영자", "운영진", "운영팀", "관리팀", "고객센터", "공식계정",
    "admin", "administrator", "operator", "moderator", "official", "staff",
    "funnote", "펀노트", "퍼니노트",
)
# 욕설·비하
_PROFANITY = (
    "씨발", "시발", "씨팔", "시팔", "씹", "ㅅㅂ", "ㅆㅂ", "ㅂㅅ", "병신", "븅신", "빙신", "좆", "존나", "졸라",
    "개새끼", "개새기", "개색기", "개색끼", "개쌔끼", "새끼", "미친놈", "미친년", "미친새", "또라이", "닥쳐",
    "니애미", "니미", "느금", "엠창", "애미", "애비", "지랄", "염병", "엿먹", "꺼져",
    "장애인새", "틀딱", "한남충", "김치녀", "된장녀", "맘충", "급식충", "짱깨", "쪽바리", "흑형",
    "fuck", "shit", "bitch", "asshole", "bastard", "nigger", "nigga", "retard",
)
# 성적 표현
_SEXUAL = (
    "섹스", "쎅스", "섹시녀", "보지", "자지", "꼬추", "젖꼭지", "야동", "자위", "오르가즘", "강간", "몸캠", "조건만남",
    "sex", "porn", "pussy", "dick", "penis", "vagina", "boobs",
)

BLOCKED_WORDS: tuple[str, ...] = _IMPERSONATION + _PROFANITY + _SEXUAL

# 남길 문자: 영문 소문자·한글 음절·한글 자모. 그 밖(공백·특수문자·숫자·이모지)은 지운다.
# NFKC 는 호환 자모(ㅅ U+3145)를 첫가끝 자모(ᄉ U+1109)로 바꾸므로 U+1100–U+11FF 도 남긴다
_STRIP_RE = re.compile(r"[^a-z가-힣ㄱ-ㅎㅏ-ㅣ\u1100-\u11ff]")


def _normalize(text: str) -> str:
    return _STRIP_RE.sub("", unicodedata.normalize("NFKC", text).lower())


_NORMALIZED_WORDS = tuple(w for w in (_normalize(x) for x in BLOCKED_WORDS) if w)


def is_blocked_nickname(name: str | None) -> bool:
    """금칙어를 (정규화 후) 부분 문자열로 품고 있으면 True. 빈 값은 False(빈 값 처리는 호출자 몫)."""
    norm = _normalize(name or "")
    if not norm:
        return False
    return any(w in norm for w in _NORMALIZED_WORDS)


def default_nickname() -> str:
    """기존 기본값 규칙 — '유저' + 4자리 난수."""
    return f"유저{secrets.randbelow(10000):04d}"


def safe_nickname(raw: str | None, *, max_len: int = 100) -> str:
    """앞뒤 공백 제거·최대 길이 자름. 비었거나 금칙어면 기본값(유저####)."""
    nickname = (raw or "").strip()[:max_len]
    if not nickname or is_blocked_nickname(nickname):
        return default_nickname()
    return nickname
