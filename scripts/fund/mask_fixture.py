"""fund.ivyro.net 펀드 현황 원본 HTML → 테스트 픽스처(개인 값 가림).

사용법:
    conda run -n base python scripts/fund/mask_fixture.py <원본.html> <출력.html> [--replace 원문=대체 ...]

- 태그 밖 텍스트의 숫자를 무작위 숫자로 바꾼다(자릿수·쉼표·%·부호·0 위치 유지, 되돌릴 수 없음).
  <style> 안(CSS 색·클래스)과 태그 속성(colspan 등)은 건드리지 않는다. 엔티티(&#160;)도 보존.
- --replace 로 받은 문자열(이름·회사명 등)을 통째로 바꾼다. 숫자 가리기보다 먼저 적용.
- 모든 href 를 https://example.com/link/N 으로 바꾼다.
- 브라우저 저장 흔적('saved from url' 주석, 확장 프로그램이 넣은 div)을 지운다.
"""

from __future__ import annotations

import argparse
import random
import re
from pathlib import Path

_rng = random.SystemRandom()


def _mask_digit(d: str) -> str:
    return "0" if d == "0" else str(_rng.randint(1, 9))


def _mask_text(text: str) -> str:
    # 엔티티는 그대로 두고 숫자만 바꾼다
    return re.sub(r"&#?\w+;|\d", lambda m: m.group(0) if m.group(0).startswith("&") else _mask_digit(m.group(0)), text)


def mask(html: str, replaces: list[tuple[str, str]]) -> str:
    html = re.sub(r"<!-- saved from url=[^>]*-->\s*", "", html)
    html = re.sub(r'<div id="in-page-channel-node-id"[^>]*></div>', "", html)
    for old, new in replaces:
        html = html.replace(old, new)
    counter = iter(range(1, 10_000))
    html = re.sub(r'href="[^"]*"', lambda _m: f'href="https://example.com/link/{next(counter)}"', html)
    parts = re.split(r"(<style\b.*?</style>|<[^>]+>)", html, flags=re.S | re.I)
    return "".join(p if p.startswith("<") else _mask_text(p) for p in parts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    ap.add_argument("--replace", action="append", default=[], metavar="원문=대체")
    args = ap.parse_args()
    pairs = [tuple(p.split("=", 1)) for p in args.replace]
    args.dst.parent.mkdir(parents=True, exist_ok=True)
    args.dst.write_text(mask(args.src.read_text(encoding="utf-8"), pairs), encoding="utf-8")
    print(f"masked → {args.dst}")


if __name__ == "__main__":
    main()
