"""서비스 공통 CORS 허용 오리진 구성.

auth/blog/stock_api 세 서비스가 동일 로직을 중복하던 것을 한 곳으로 모은다.
프론트(admin_web/web_client)는 auth·blog·stock 세 API를 모두 호출하므로,
세 서비스 모두 같은 오리진 정책을 써야 한다.

정책(환경 3단계):
- local  : Vite/Expo 로컬 dev 오리진(localhost:5173/3000/8081/8082) — 항상 허용.
- develop: 미니PC(Cloudflare 터널) 배포 프론트 도메인 — 공개 도메인이라 코드에 둔다.
           서버 .env 의 CORS_ORIGINS 를 깜빡해도 CORS 가 동작하도록 기본 포함
           ('green-but-broken' 방지).
- product: 실서버 도메인이 생기면 CORS_ORIGINS(쉼표구분) 환경변수로 확장.
"""

from __future__ import annotations

import os

# 로컬 개발 오리진(Vite 5173 / CRA·serve 3000 / Expo 웹 8081·8082)
_LOCAL_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:8082",
    "http://127.0.0.1:8082",
]

# develop 배포(미니PC, Cloudflare 터널) 프론트 오리진 — 공개 도메인
_DEPLOY_ORIGINS = [
    "https://admin.haezean.com",  # 관리자 웹(admin_web)
    "https://app.haezean.com",    # 클라이언트 웹(web_client)
]


def build_allowed_origins() -> list[str]:
    """local + develop 오리진 + CORS_ORIGINS(env, 쉼표구분 product 등)을 합쳐 반환(중복 제거)."""
    extra = os.getenv("CORS_ORIGINS", "")
    origins = _LOCAL_ORIGINS + _DEPLOY_ORIGINS
    origins += [o.strip() for o in extra.split(",") if o.strip()]
    deduped: list[str] = []
    for o in origins:
        if o not in deduped:
            deduped.append(o)
    return deduped
