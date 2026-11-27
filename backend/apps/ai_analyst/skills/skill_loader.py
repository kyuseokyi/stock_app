"""스킬 카탈로그 로더 — catalog/<id>/SKILL.md 를 읽어 메타·본문을 돌려준다.

- frontmatter 는 표준 라이브러리로 읽는다(PyYAML 은 직접 의존성이 아님). 지원 범위:
  `---` 로 감싼 구간, `key: value`, 따옴표 문자열, `[a, b]` 인라인 목록, `- a` 블록 목록.
- 필수 키(id·name·description·source_repo·license·uses_facts)가 빠졌거나 frontmatter 가 없으면 건너뛰고 경고.
- 같은 id 가 둘 이상이면 폴더 이름 정렬 순서상 먼저 읽힌 것만 남기고 경고.
- 캐시: 폴더 경로별로, 파일별 (경로, mtime_ns, 크기) 묶음이 같으면 다시 읽지 않는다.
"""
from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)

CATALOG_DIR = Path(__file__).resolve().parent / "catalog"
REQUIRED_KEYS = ("id", "name", "description", "source_repo", "license", "uses_facts")
META_KEYS = REQUIRED_KEYS

_cache: dict[str, tuple[tuple, list[dict]]] = {}


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return v


def _parse_value(v: str):
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        return [_unquote(x) for x in inner.split(",") if x.strip()] if inner else []
    return _unquote(v)


def parse_frontmatter(text: str) -> tuple[dict, str] | None:
    """(메타, 본문) — frontmatter 가 없으면 None."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        return None
    meta: dict = {}
    current: str | None = None
    for raw in lines[1:end]:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        stripped = raw.strip()
        if stripped.startswith("- ") and current is not None:
            if not isinstance(meta.get(current), list):
                meta[current] = []
            meta[current].append(_unquote(stripped[2:]))
            continue
        if ":" not in raw:
            continue
        key, _, val = raw.partition(":")
        key = key.strip()
        current = key
        meta[key] = _parse_value(val) if val.strip() else []
    body = "\n".join(lines[end + 1:]).strip("\n")
    return meta, body


def _signature(files: list[Path]) -> tuple:
    sig = []
    for p in files:
        try:
            st = p.stat()
            sig.append((str(p), st.st_mtime_ns, st.st_size))
        except OSError:
            continue
    return tuple(sig)


def _load(catalog_dir: Path | None) -> list[dict]:
    root = Path(catalog_dir) if catalog_dir is not None else CATALOG_DIR
    files = sorted(root.glob("*/SKILL.md"))
    key = str(root.resolve())
    sig = _signature(files)
    hit = _cache.get(key)
    if hit and hit[0] == sig:
        return hit[1]
    skills: list[dict] = []
    seen: set[str] = set()
    for p in files:
        try:
            parsed = parse_frontmatter(p.read_text(encoding="utf-8"))
        except OSError as e:
            log.warning("스킬 파일 읽기 실패 %s (%s)", p, type(e).__name__)
            continue
        if parsed is None:
            log.warning("스킬 frontmatter 없음 — 건너뜀: %s", p)
            continue
        meta, body = parsed
        missing = [k for k in REQUIRED_KEYS if not meta.get(k)]
        if missing:
            log.warning("스킬 frontmatter 필수 키 누락 %s — 건너뜀: %s", missing, p)
            continue
        sid = str(meta["id"])
        if sid in seen:
            log.warning("스킬 id 중복 '%s' — 건너뜀: %s", sid, p)
            continue
        seen.add(sid)
        facts = meta["uses_facts"]
        skills.append({
            "id": sid, "name": str(meta["name"]), "description": str(meta["description"]),
            "source_repo": str(meta["source_repo"]), "license": str(meta["license"]),
            "uses_facts": list(facts) if isinstance(facts, list) else [str(facts)],
            "body": body,
        })
    _cache[key] = (sig, skills)
    return skills


def list_installed_skills(catalog_dir: Path | None = None) -> list[dict]:
    """설치된 스킬 메타 목록(본문 제외)."""
    return [{k: s[k] for k in META_KEYS} for s in _load(catalog_dir)]


def get_skill(skill_id: str, catalog_dir: Path | None = None) -> dict | None:
    """메타 + 본문(body). 없으면 None."""
    for s in _load(catalog_dir):
        if s["id"] == skill_id:
            return dict(s)
    return None


def build_combined_skill_prompt(ids: list[str] | None = None, catalog_dir: Path | None = None) -> str:
    """선택한 스킬 본문을 한 프롬프트로 — ids=None 이면 전부, 모르는 id 는 경고 후 건너뜀."""
    skills = _load(catalog_dir)
    if ids is None:
        chosen = skills
    else:
        by_id = {s["id"]: s for s in skills}
        chosen = []
        for sid in ids:
            if sid in by_id:
                chosen.append(by_id[sid])
            else:
                log.warning("알 수 없는 스킬 id '%s' — 건너뜀", sid)
    parts = [f"## [스킬: {s['name']} ({s['id']})]\n\n{s['body'].strip()}" for s in chosen]
    return "\n\n---\n\n".join(parts)
