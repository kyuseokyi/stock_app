"""PKCE 방식 verifier 검증 — 로그인 CSRF·교환 코드 가로채기 방지.

클라이언트는 시작 전에 무작위 verifier(32바이트 base64url)를 만들고, 그 SHA-256 을
base64url 로 인코딩한 challenge(cc, 43자)를 /start 에 보낸다. 서버는 cc 를 서명 state 에
넣어 두었다가 교환 코드와 함께 저장하고, /exchange 에서 verifier 로 다시 계산해 비교한다.
교환 코드를 가로챈(또는 피해자에게 심은) 쪽은 verifier 를 모르므로 토큰을 받을 수 없다.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re

CHALLENGE_PATTERN = r"^[A-Za-z0-9_-]{43}$"
_CHALLENGE_RE = re.compile(CHALLENGE_PATTERN)


def challenge_for(verifier: str) -> str:
    """base64url(sha256(verifier)) — 패딩 없음(RFC 7636 S256)."""
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def is_valid_challenge(cc: object) -> bool:
    return isinstance(cc, str) and _CHALLENGE_RE.fullmatch(cc) is not None


def verifier_matches(verifier: str | None, cc: str) -> bool:
    """상수 시간 비교(bytes 로 비교해 비ASCII 입력에서도 예외 없음)."""
    if not verifier:
        return False
    return hmac.compare_digest(challenge_for(verifier).encode("ascii"), cc.encode("utf-8"))
