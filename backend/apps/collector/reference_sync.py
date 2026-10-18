"""참조 데이터 동기화 — .mst 원문(이미 받은 것) + idxcode·theme_code → stock_profile·sectors·themes."""
from __future__ import annotations

import logging

from apps.collector.kis import reference_master as rm
from apps.collector.kis.master import download_reference_lines
from shared import market_repo as repo
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)


def sync_reference(master_lines: dict[str, list[str]]) -> dict:
    profiles = rm.parse_profiles(master_lines.get("KOSPI", []), "KOSPI") + rm.parse_profiles(
        master_lines.get("KOSDAQ", []), "KOSDAQ"
    )
    ref = download_reference_lines()
    sectors = rm.parse_sectors(ref["idxcode"])
    themes = rm.parse_themes(ref["theme"])
    with SyncSessionLocal() as db:
        n_profiles = repo.sync_profiles(db, profiles)
        n_sectors = repo.sync_sectors(db, sectors)
        theme_res = repo.sync_kis_themes(db, themes)
    out = {"profiles": n_profiles, "sectors": n_sectors, **{f"theme_{k}": v for k, v in theme_res.items()}}
    log.info("참조 데이터 동기화: %s", out)
    return out
