"""관리자 계산 수동 실행 — 서버가 정한 작업(JOBS)만, 같은 작업 중복 실행 방지, 최근 실행 기록(Redis).

중복 방지는 여기(관리자 실행)에서만 한다. 작업 본문에는 잠금을 걸지 않는다 — 테마 보정마다 보내는
compute_market_groups 가 '실행 중이라 건너뜀'이 되면 마지막 보정이 다음 날까지 반영되지 않는다(계산은 멱등).
잠금 값에 task_id 를 넣고 Celery 상태로 실제 실행 여부를 확인한다. 배포로 워커가 바뀌어 STARTED 에 멈춘
잠금은 TTL 이 지나면 풀린다. KIS 를 호출하는 수집 작업은 2단계(파이프라인 잠금과 함께)에서 추가한다.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import redis

from apps.collector.celery_app import celery_app
from shared.sync_redis import get_sync_redis

log = logging.getLogger("stock_api.admin_jobs")


@dataclass(frozen=True)
class Job:
    key: str
    label: str
    description: str
    task: str
    eta: str
    lock_ttl: int  # 초
    kwargs: dict = field(default_factory=dict)


JOBS: dict[str, Job] = {j.key: j for j in (
    Job("canslim", "CANSLIM 계산", "최신 거래일 CANSLIM 점수와 시장 상태를 다시 계산해요",
        "collector.compute_canslim", "수 초", 600),
    Job("market_groups", "시장 그룹 계산", "최신 거래일 테마·업종 순위를 다시 계산해요",
        "collector.compute_market_groups", "수 초", 600),
    Job("backfill_canslim", "CANSLIM 60일 백필", "최근 60거래일 CANSLIM 을 다시 계산해요",
        "collector.backfill_canslim", "수 분", 3600, {"days": 60}),
    Job("backfill_market_groups", "시장 그룹 60일 백필", "최근 60거래일 테마·업종 순위를 다시 계산해요",
        "collector.backfill_market_groups", "수 분", 3600, {"days": 60}),
)}
LOCK_KEY = "admin:job:{}"
HISTORY_KEY = "admin:job:history"
HISTORY_MAX = 30
SUMMARY_MAX = 200
_ACTIVE = frozenset({"PENDING", "RECEIVED", "STARTED", "RETRY"})


class UnknownJob(Exception):
    pass


class QueueUnavailable(Exception):
    pass


class JobRunning(Exception):
    def __init__(self, info: dict):
        super().__init__(info.get("task_id"))
        self.info = info


def _task_state(task_id: str) -> tuple[str, object]:
    """(Celery 상태, 끝났으면 결과). 모르는 id 는 Celery 가 PENDING 으로 답한다."""
    # 결과 백엔드 장애는 UNKNOWN(비활성)으로 본다. Redis 자체가 죽었다면 잠금 읽기가 먼저 RedisError 로
    # 실패해 QueueUnavailable 이 되므로, 여기서 UNKNOWN 을 '교체 가능'으로 취급해도 안전하다.
    try:
        r = celery_app.AsyncResult(task_id)
        state = r.state
        return state, (r.result if state in ("SUCCESS", "FAILURE") else None)
    except Exception as exc:  # noqa: BLE001
        log.warning("admin job state lookup failed task=%s: %s", task_id, exc)
        return "UNKNOWN", None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _held(r, job: Job) -> dict | None:
    """실제로 대기·실행 중인 잠금이면 {..., state}, 아니면 None."""
    raw = r.get(LOCK_KEY.format(job.key))
    if not raw:
        return None
    info = json.loads(raw)
    state, _ = _task_state(info["task_id"])
    return {**info, "state": state} if state in _ACTIVE else None


def _replace_if_same(r, key: str, old: str | None, new: str, ttl: int) -> bool:
    """읽은 값 그대로일 때만 교체 — 동시에 누른 다른 관리자의 새 잠금을 덮지 않게."""
    with r.pipeline() as p:
        try:
            p.watch(key)
            if p.get(key) != old:
                return False
            p.multi()
            p.set(key, new, ex=ttl)
            p.execute()
            return True
        except redis.WatchError:
            return False


def run(job_key: str, actor: str) -> dict:
    job = JOBS.get(job_key)
    if job is None:
        raise UnknownJob(job_key)
    r = get_sync_redis()
    key = LOCK_KEY.format(job.key)
    info = {"task_id": uuid.uuid4().hex, "job": job.key, "actor": actor, "requested_at": _now()}
    payload = json.dumps(info, ensure_ascii=False)
    try:
        if not r.set(key, payload, nx=True, ex=job.lock_ttl):
            old = r.get(key)
            held = json.loads(old) if old else None
            if held and _task_state(held["task_id"])[0] in _ACTIVE:
                raise JobRunning(held)
            if not _replace_if_same(r, key, old, payload, job.lock_ttl):
                raise JobRunning(json.loads(r.get(key) or payload))
    except redis.RedisError as exc:
        raise QueueUnavailable(str(exc)) from exc
    try:
        celery_app.send_task(job.task, kwargs=job.kwargs, task_id=info["task_id"])
    except Exception as exc:  # noqa: BLE001
        r.delete(key)
        raise QueueUnavailable(str(exc)) from exc
    try:
        with r.pipeline() as p:
            p.lpush(HISTORY_KEY, payload)
            p.ltrim(HISTORY_KEY, 0, HISTORY_MAX - 1)
            p.execute()
    except Exception as exc:  # noqa: BLE001 — 작업은 이미 큐에 들어갔다
        log.warning("admin job history write failed task=%s: %s", info["task_id"], exc)
    log.info("admin job run job=%s task=%s actor=%r", job.key, info["task_id"], actor)
    return {"task_id": info["task_id"], "requested_at": info["requested_at"]}


def _summary(state: str, result) -> str | None:
    if result is None:
        return None
    if state == "SUCCESS":
        return json.dumps(result, ensure_ascii=False, default=str)[:SUMMARY_MAX]
    return repr(result)[:SUMMARY_MAX]


def overview() -> dict:
    try:
        return _overview()
    except redis.RedisError as exc:
        raise QueueUnavailable(str(exc)) from exc


def _overview() -> dict:
    r = get_sync_redis()
    jobs, active_ids = [], set()
    for job in JOBS.values():
        held = _held(r, job)
        status = "idle"
        if held:
            status = "queued" if held["state"] == "PENDING" else "running"
            active_ids.add(held["task_id"])
        jobs.append({"key": job.key, "label": job.label, "description": job.description, "eta": job.eta,
                     "status": status, "task_id": held["task_id"] if held else None,
                     "requested_at": held["requested_at"] if held else None})
    history = []
    for raw in r.lrange(HISTORY_KEY, 0, HISTORY_MAX - 1):
        h = json.loads(raw)
        state, result = _task_state(h["task_id"])
        if state == "PENDING" and h["task_id"] not in active_ids:
            state = "UNKNOWN"  # Celery 결과 만료(1일) — 기록만 남음
        job = JOBS.get(h["job"])
        history.append({"job": h["job"], "label": job.label if job else h["job"], "task_id": h["task_id"],
                        "actor": h.get("actor"), "requested_at": h.get("requested_at"), "state": state,
                        "result_summary": _summary(state, result)})
    return {"jobs": jobs, "history": history}
