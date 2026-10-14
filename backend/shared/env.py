"""환경변수(.env) 로딩 — `shared` 패키지 import 시 최초 1회 실행.

우선순위: `.env.{APP_ENV}`(기본 development) → `.env`
이미 셸에서 export된 실제 환경변수는 덮어쓰지 않는다(override=False).
파일은 backend/ 루트(=shared/의 부모) 기준으로 탐색한다.

`*_FILE` 지원(Docker Swarm/K8s secrets): `FOO_FILE=/run/secrets/foo` 가 있고 `FOO` 가 비어 있으면
파일 내용(앞뒤 공백 제거)을 `FOO` 로 넣는다. `FOO` 가 이미 있으면 그대로(기존 env 우선).
파일을 읽을 수 없으면 기동 실패(조용히 빈 값으로 뜨는 것보다 안전).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import MutableMapping

from dotenv import load_dotenv

_loaded = False
_FILE_SUFFIX = "_FILE"


def apply_file_env(environ: MutableMapping[str, str] | None = None) -> list[str]:
    """`FOO_FILE` → `FOO`(FOO 미설정/빈 값일 때만). 채운 변수 이름 목록을 반환."""
    env = os.environ if environ is None else environ
    filled: list[str] = []
    for key, path in list(env.items()):
        if not key.endswith(_FILE_SUFFIX) or len(key) == len(_FILE_SUFFIX) or not path:
            continue
        target = key[: -len(_FILE_SUFFIX)]
        if env.get(target):
            continue
        try:
            value = Path(path).read_text(encoding="utf-8").strip()
        except OSError as e:
            raise RuntimeError(f"{key} 파일을 읽을 수 없습니다: {path}") from e
        env[target] = value
        filled.append(target)
    return filled


def load_env() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True

    # 셸/오케스트레이터가 준 FOO_FILE 은 실제 env 와 같은 우선순위 → .env 파일보다 먼저 적용
    apply_file_env()
    root = Path(__file__).resolve().parent.parent  # backend/
    app_env = os.getenv("APP_ENV", "development")
    for name in (f".env.{app_env}", ".env"):
        path = root / name
        if path.exists():
            load_dotenv(path, override=False)
    apply_file_env()  # .env 파일 안에 적힌 FOO_FILE 도 반영
