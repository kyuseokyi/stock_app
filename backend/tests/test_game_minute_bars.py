"""게임 1분봉 — CH 스키마·틱 집계기·저장기 테스트."""
from __future__ import annotations

from shared import clickhouse_schema


def test_minute_bars_ddl_shape():
    ddl = clickhouse_schema.game_minute_bars_ddl("smoke_db")
    assert "CREATE TABLE IF NOT EXISTS smoke_db.game_minute_bars" in ddl
    assert "ts           DateTime('Asia/Seoul')" in ddl
    assert "source       LowCardinality(String)" in ddl
    assert "ReplacingMergeTree(ingested_at)" in ddl
    assert "ORDER BY (ticker, ts)" in ddl
    assert "PARTITION BY toYYYYMM(ts)" in ddl


def test_ensure_minute_bars_runs_ddl():
    sent = []

    class C:
        def command(self, sql):
            sent.append(sql)

    clickhouse_schema.ensure_game_minute_bars(C(), "x")
    assert len(sent) == 1 and "x.game_minute_bars" in sent[0]
