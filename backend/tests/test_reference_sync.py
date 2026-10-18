"""마스터 동기화 → 참조 데이터(프로필·업종·테마) 동기화. 실패해도 종목 마스터 동기화는 계속."""
from apps.collector import reference_sync, stock_master
from apps.collector.kis.master import MasterStock


class _Session:
    def __enter__(self):
        return object()

    def __exit__(self, *a):
        return False


def test_sync_reference_calls_repo(monkeypatch):
    calls = {}
    monkeypatch.setattr(reference_sync, "download_reference_lines", lambda: {"idxcode": ["I"], "theme": ["T"]})
    monkeypatch.setattr(reference_sync.rm, "parse_profiles", lambda lines, market: [f"{market}:{len(lines)}"])
    monkeypatch.setattr(reference_sync.rm, "parse_sectors", lambda lines: {"0027": "제조"})
    monkeypatch.setattr(reference_sync.rm, "parse_themes", lambda lines: ["theme"])

    def _profiles(db, p):
        calls["profiles"] = p
        return len(p)

    def _sectors(db, s):
        calls["sectors"] = s
        return 1

    def _themes(db, t):
        calls["themes"] = t
        return {"themes": 1, "added": 0, "removed": 0}

    monkeypatch.setattr(reference_sync.repo, "sync_profiles", _profiles)
    monkeypatch.setattr(reference_sync.repo, "sync_sectors", _sectors)
    monkeypatch.setattr(reference_sync.repo, "sync_kis_themes", _themes)
    monkeypatch.setattr(reference_sync, "SyncSessionLocal", _Session)

    out = reference_sync.sync_reference({"KOSPI": ["a", "b"], "KOSDAQ": ["c"]})
    assert calls["profiles"] == ["KOSPI:2", "KOSDAQ:1"]
    assert calls["sectors"] == {"0027": "제조"} and calls["themes"] == ["theme"]
    assert out == {"profiles": 2, "sectors": 1, "theme_themes": 1, "theme_added": 0, "theme_removed": 0}


def _patch_master(monkeypatch, lines):
    monkeypatch.setattr(stock_master, "_download_lines", lambda: lines)
    monkeypatch.setattr(stock_master, "parse_master_lines", lambda l: [MasterStock("005930", "삼성전자", "KOSPI")])
    monkeypatch.setattr(stock_master.repo, "sync_master", lambda db, rows: {"active_total": 1, "inactive_total": 0})
    monkeypatch.setattr(stock_master.repo, "list_active", lambda db: [("005930", "삼성전자", "KOSPI")])
    monkeypatch.setattr(stock_master, "SyncSessionLocal", _Session)


def test_master_passes_same_lines_to_reference(monkeypatch):
    lines = {"KOSPI": ["x"], "KOSDAQ": []}
    _patch_master(monkeypatch, lines)
    seen = []
    monkeypatch.setattr(stock_master, "sync_reference", lambda l: seen.append(l))
    assert [s.ticker for s in stock_master.load_domestic_tickers("mst")] == ["005930"]
    assert seen == [lines]  # 다운로드를 다시 하지 않고 같은 원문을 넘긴다


def test_reference_failure_does_not_break_master(monkeypatch):
    _patch_master(monkeypatch, {"KOSPI": ["x"], "KOSDAQ": []})

    def boom(_lines):
        raise RuntimeError("theme download failed")

    monkeypatch.setattr(stock_master, "sync_reference", boom)
    assert [s.ticker for s in stock_master.load_domestic_tickers("mst")] == ["005930"]


def test_fallback_source_skips_reference(monkeypatch):
    _patch_master(monkeypatch, {"KOSPI": [], "KOSDAQ": []})
    monkeypatch.setattr(stock_master, "sync_reference", lambda l: (_ for _ in ()).throw(AssertionError("호출 금지")))
    assert stock_master.load_domestic_tickers("fallback")
