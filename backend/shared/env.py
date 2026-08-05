"""환경변수(.env) 로딩 — `shared` 패키지 import 시 최초 1회 실행.

우선순위: `.env.{APP_ENV}`(기본 development) → `.env`
이미 셸에서 export된 실제 환경변수는 덮어쓰지 않는다(override=False).
파일은 backend/ 루트(=shared/의 부모) 기준으로 탐색한다.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_loaded = False


def load_env() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True

    root = Path(__file__).resolve().parent.parent  # backend/
    app_env = os.getenv("APP_ENV", "development")
    for name in (f".env.{app_env}", ".env"):
        path = root / name
        if path.exists():
            load_dotenv(path, override=False)
