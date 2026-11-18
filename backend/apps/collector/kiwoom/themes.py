"""키움 테마 스냅숏 수집 — ka90001 테마그룹별요청(전체 테마) + ka90002 테마구성종목요청(테마별 종목) (키움 연동 ④-2).

- 가져오는 것은 테마 목록(코드·이름)과 구성 종목뿐. 키움 등락률·기간수익률은 쓰지 않는다(순위·등락은 우리 일봉).
- 모두 받은 뒤 검증을 통과해야만 store 로 한 번에 교체한다 — 실패하면 DB 를 건드리지 않아 **지난 스냅숏이 그대로** 남는다.
  · 키 미설정·8010(등록 IP 밖) → `skipped`(호출 중단, 쓰기 없음).
  · ka90001 실패, 테마 수 < min_themes → `error`(쓰기 없음).
  · 첫 테마 ka90002 에서 키움 논리 오류(rt — 시간 제한 등) → 나머지 호출 중단, `error`(헛호출 방지, 쓰기 없음).
  · 그 뒤 테마의 오류는 그 테마만 실패로 세고 계속. 실패 비율 > MAX_FAIL_RATIO 면 `error`(쓰기 없음),
    이하면 쓰되 실패 테마는 기존 연결을 유지(keep_codes).
- 호출량: 테마 수(수백) + ka90001 연속조회 쪽수. 초당 상한은 KiwoomClient RateLimiter(KIWOOM_RATE_PER_SEC, 기본 4).
설계: docs/superpowers/specs/2026-11-17-kiwoom-themes-design.md
"""

from __future__ import annotations

import logging
import time
from typing import Callable

from apps.collector.kis.reference_master import ThemeRow
from apps.collector.kiwoom.client import KiwoomApiError, KiwoomCircuitOpen, KiwoomError, KiwoomIpError, KiwoomNotConfigured
from apps.collector.kiwoom.normalize import theme_group, theme_member_ticker
from shared.market_repo import KIWOOM_THEME_MIN

logger = logging.getLogger(__name__)

MAX_FAIL_RATIO = 0.05  # 구성 종목 조회 실패가 이 비율을 넘으면 이번 스냅숏을 버린다
_FAILED_SAMPLE = 20
NOT_CONFIGURED = "키움 키 없음"


def normalize_groups(raw_rows: list[dict]) -> list[dict]:
    """ka90001 원시 행 → 정규화(빈 값·너무 긴 코드 제외, 코드 중복은 처음 것)."""
    out: dict[str, dict] = {}
    for raw in raw_rows:
        g = theme_group(raw)
        if g is not None:
            out.setdefault(g["code"], g)
    return list(out.values())


def member_tickers(raw_rows: list[dict]) -> tuple[str, ...]:
    """ka90002 원시 행 → 6자리 종목코드(중복 제거, 순서 유지)."""
    return tuple(dict.fromkeys(t for t in (theme_member_ticker(r) for r in raw_rows) if t))


def run_themes(*, client_factory: Callable[[], object], store: Callable[[list[ThemeRow], set[str]], dict],
               min_themes: int = KIWOOM_THEME_MIN) -> dict:
    """키움 테마 스냅숏을 받아 검증 후 store(rows, keep_codes) 로 교체. 결과 dict(파이프라인 기록용)."""
    try:
        client = client_factory()
    except KiwoomNotConfigured as e:
        logger.warning("[키움 테마] %s — 건너뜀", e)
        return {"skipped": NOT_CONFIGURED}

    started = time.monotonic()
    try:
        try:
            groups = normalize_groups(client.list_themes())
        except (KiwoomCircuitOpen, KiwoomIpError, KiwoomNotConfigured) as e:
            logger.warning("[키움 테마] %s — 이번 실행을 건너뜁니다", e)
            return {"skipped": f"키움 호출 불가: {e}"}
        except KiwoomError as e:
            return {"error": f"테마 목록(ka90001) 실패 — 지난 스냅숏 유지: {e}"[:300]}
        if len(groups) < int(min_themes):
            return {"error": f"테마 수 {len(groups)}개 < {int(min_themes)} — 지난 스냅숏 유지", "themes": len(groups)}

        rows: list[ThemeRow] = []
        failed: list[dict] = []
        for i, g in enumerate(groups):
            try:
                tickers = member_tickers(client.theme_members(g["raw_code"]))
            except (KiwoomCircuitOpen, KiwoomIpError, KiwoomNotConfigured) as e:
                logger.warning("[키움 테마] %s — 이번 실행을 멈춥니다(쓰기 없음)", e)
                return {"skipped": f"키움 호출 불가: {e}"}
            except KiwoomApiError as e:
                if i == 0:
                    logger.warning("[키움 테마] 첫 테마 %s 키움 오류 — 나머지 호출 중단: %s", g["raw_code"], e)
                    return {"error": f"첫 테마 키움 오류 code={e.code} msg={e.msg} — 나머지 호출 중단, 지난 스냅숏 유지"}
                failed.append({"code": g["code"], "error": f"code={e.code} {e.msg}"[:160]})
                tickers = ()
            except Exception as e:  # noqa: BLE001 — 그 테마만 실패, 나머지 계속
                failed.append({"code": g["code"], "error": repr(e)[:160]})
                tickers = ()
            rows.append(ThemeRow(code=g["code"], name=g["name"], tickers=tickers))
    finally:
        close = getattr(client, "close", None)
        if close is not None:
            close()

    elapsed = round(time.monotonic() - started, 1)
    if failed and len(failed) / len(groups) > MAX_FAIL_RATIO:
        logger.warning("[키움 테마] 구성 종목 실패 %d/%d — 지난 스냅숏 유지", len(failed), len(groups))
        return {"error": f"구성 종목 조회 실패 {len(failed)}/{len(groups)} > {MAX_FAIL_RATIO:.0%} — 지난 스냅숏 유지",
                "failed": failed[:_FAILED_SAMPLE], "elapsed_sec": elapsed}
    keep = {f["code"] for f in failed}
    res = store(rows, keep)
    out = {"themes": len(rows), "with_members": sum(1 for r in rows if r.tickers),
           "links": sum(len(r.tickers) for r in rows), "failed_count": len(failed),
           "failed": failed[:_FAILED_SAMPLE], "elapsed_sec": elapsed,
           **{k: v for k, v in (res or {}).items() if k in ("added", "removed", "kept")}}
    logger.info("[키움 테마] 테마 %d개(종목 있는 %d), 연결 %d, 실패 %d, %.0f초", out["themes"], out["with_members"],
                out["links"], len(failed), elapsed)
    return out
