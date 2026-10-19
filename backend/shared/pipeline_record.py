"""일일 시장 파이프라인 최근 실행 기록(Redis) — collector 가 쓰고 관리자 데이터 현황이 읽는다.

Celery 결과로는 찾을 수 없다(beat 실행의 task_id 를 모르고 결과는 1일 뒤 만료) → 고정 키 하나에 덮어쓴다.
저장·읽기 실패는 경고만 남기고 삼킨다 — 기록 때문에 파이프라인이나 관리자 화면이 실패하면 안 된다.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

log = logging.getLogger(__name__)

KEY = "collector:pipeline:last"
TTL_SECONDS = 8 * 24 * 3600
SUMMARY_MAX = 200


def summarize(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)[:SUMMARY_MAX]


def save(client, started_at: datetime, finished_at: datetime, steps: list[dict]) -> None:
    payload = {"started_at": started_at.isoformat(), "finished_at": finished_at.isoformat(), "steps": steps}
    try:
        client.set(KEY, json.dumps(payload, ensure_ascii=False), ex=TTL_SECONDS)
    except Exception as exc:  # noqa: BLE001
        log.warning("파이프라인 기록 저장 실패: %s", exc)


def load(client) -> dict | None:
    try:
        raw = client.get(KEY)
    except Exception as exc:  # noqa: BLE001
        log.warning("파이프라인 기록 읽기 실패: %s", exc)
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None
