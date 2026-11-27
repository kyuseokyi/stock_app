"""AI Lab 스킬 카탈로그 로더 — 실제 카탈로그 7개, frontmatter 누락·중복 id 건너뜀, 선택 스킬만 프롬프트에."""
from __future__ import annotations

import logging
import os

from apps.ai_analyst.skills import skill_loader as L

EXPECTED = {"sepa_strategy", "ev_and_catalysts", "financial_checks", "setup_backtest",
            "exposure_sizing", "k_dart", "logic_chain"}
META_KEYS = {"id", "name", "description", "source_repo", "license", "uses_facts"}


def _write(root, folder, text):
    d = root / folder
    d.mkdir(parents=True, exist_ok=True)
    (d / "SKILL.md").write_text(text, encoding="utf-8")
    return d / "SKILL.md"


def _md(sid, name="이름", facts="[sepa]"):
    return (f"---\nid: {sid}\nname: {name}\ndescription: \"설명: {sid}\"\nsource_repo: a/b\nlicense: MIT\n"
            f"uses_facts: {facts}\n---\n\n# {sid} 본문\n판정 기준\n")


def test_real_catalog_has_seven_skills():
    skills = L.list_installed_skills()
    assert {s["id"] for s in skills} == EXPECTED
    for s in skills:
        assert META_KEYS <= set(s)
        assert "body" not in s  # 목록은 메타만
        assert s["license"] in {"MIT", "Apache-2.0"}
        assert isinstance(s["uses_facts"], list) and s["uses_facts"]


def test_real_catalog_bodies_korean_and_no_naver_news_input():
    for sid in EXPECTED:
        sk = L.get_skill(sid)
        assert sk and sk["body"].strip()
        assert "다시 씀" in sk["body"]  # 원문 복사 아님 표기
        assert "네이버" not in sk["body"] or "쓰지 않" in sk["body"]


def test_get_skill_unknown_returns_none():
    assert L.get_skill("nope") is None


def test_frontmatter_parse_quotes_and_lists(tmp_path):
    _write(tmp_path, "a", _md("aa", facts="[sepa, backtest, \"dart\"]"))
    sk = L.get_skill("aa", catalog_dir=tmp_path)
    assert sk["description"] == "설명: aa"
    assert sk["uses_facts"] == ["sepa", "backtest", "dart"]
    assert sk["body"].startswith("# aa 본문")


def test_block_list_supported(tmp_path):
    _write(tmp_path, "a", "---\nid: aa\nname: n\ndescription: d\nsource_repo: r\nlicense: MIT\n"
                          "uses_facts:\n  - sepa\n  - dart\n---\n본문\n")
    assert L.get_skill("aa", catalog_dir=tmp_path)["uses_facts"] == ["sepa", "dart"]


def test_missing_frontmatter_and_duplicate_id_skipped(tmp_path, caplog):
    _write(tmp_path, "a_first", _md("dup", name="먼저"))
    _write(tmp_path, "b_second", _md("dup", name="나중"))
    _write(tmp_path, "c_nofm", "# frontmatter 없음\n")
    _write(tmp_path, "d_noid", "---\nname: x\n---\n본문\n")
    _write(tmp_path, "e_ok", _md("ok"))
    with caplog.at_level(logging.WARNING, logger=L.log.name):
        skills = L.list_installed_skills(catalog_dir=tmp_path)
    assert [s["id"] for s in skills] == ["dup", "ok"]
    assert skills[0]["name"] == "먼저"  # 정렬 순서상 먼저 읽힌 것을 남김
    text = caplog.text
    assert "중복" in text and "frontmatter" in text


def test_cache_refreshes_when_file_changes(tmp_path):
    p = _write(tmp_path, "a", _md("aa", name="처음"))
    assert L.get_skill("aa", catalog_dir=tmp_path)["name"] == "처음"
    p.write_text(_md("aa", name="바뀜") + "추가\n", encoding="utf-8")
    st = p.stat()
    os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert L.get_skill("aa", catalog_dir=tmp_path)["name"] == "바뀜"


def test_combined_prompt_only_selected(tmp_path, caplog):
    _write(tmp_path, "a", _md("aa"))
    _write(tmp_path, "b", _md("bb"))
    _write(tmp_path, "c", _md("cc"))
    with caplog.at_level(logging.WARNING, logger=L.log.name):
        out = L.build_combined_skill_prompt(["bb", "zz"], catalog_dir=tmp_path)
    assert "bb 본문" in out and "aa 본문" not in out and "cc 본문" not in out
    assert "zz" in caplog.text
    full = L.build_combined_skill_prompt(None, catalog_dir=tmp_path)
    assert all(f"{x} 본문" in full for x in ("aa", "bb", "cc"))
    assert L.build_combined_skill_prompt([], catalog_dir=tmp_path) == ""
