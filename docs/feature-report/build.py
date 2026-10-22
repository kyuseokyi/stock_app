"""feature-report 의 md 4개를 하나의 index.html 로 합친다.

사용: python docs/feature-report/build.py   (python-markdown 필요)
- md 원본은 그대로 두고 HTML 로 미리 변환해 넣으므로 file:// 로 열어도 동작한다.
- 이미지는 images/ 상대 경로 그대로 참조한다(폴더째 열기).
"""
import html
import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent
DOCS = [  # (파일, 사이드바 제목, 섹션 id 접두어)
    ("README.md", "개요", "overview"),
    ("admin.md", "관리자 웹", "admin"),
    ("app.md", "모바일 앱", "app"),
    ("web.md", "사용자 웹", "web"),
]


def render(md_text: str, prefix: str) -> tuple[str, list[tuple[str, str]]]:
    """md → html, 그리고 h2 목차 [(id, text)] 를 돌려준다. id 는 문서별 접두어로 충돌 방지."""
    # python-markdown 은 문단 바로 아래 목록을 목록으로 보지 않는다(GitHub 은 인식) → 빈 줄을 끼워 맞춘다
    md_text = re.sub(r"^(?![ \t]*(?:[-*]|\d+\.)\s|[ \t]*$|[ \t]*\|)(.+)\n(?=[-*] |\d+\. )", r"\1\n\n", md_text, flags=re.M)
    body = markdown.markdown(md_text, extensions=["tables", "fenced_code", "sane_lists"])
    toc: list[tuple[str, str]] = []
    count = 0

    def add_id(m: re.Match) -> str:
        nonlocal count
        level, inner = int(m.group(1)), m.group(2)
        count += 1
        hid = f"{prefix}-{count}"
        if level == 2:
            toc.append((hid, re.sub(r"<[^>]+>", "", inner)))
        return f'<h{level} id="{hid}">{inner}</h{level}>'

    body = re.sub(r"<h([1-3])>(.*?)</h\1>", add_id, body)
    # md 간 링크(admin.md 등)는 같은 페이지의 섹션으로 바꾼다
    for f, _, p in DOCS:
        body = body.replace(f'href="{f}"', f'href="#{p}"')
    body = body.replace("<img ", '<img loading="lazy" ')
    return body, toc


def main() -> None:
    sections, nav = [], []
    for fname, title, prefix in DOCS:
        body, toc = render((ROOT / fname).read_text(encoding="utf-8"), prefix)
        sections.append(f'<section class="doc" id="{prefix}">{body}</section>')
        items = "".join(
            f'<li><a href="#{hid}">{html.escape(html.unescape(text))}</a></li>' for hid, text in toc
        )
        nav.append(f'<div class="nav-group"><a class="nav-title" href="#{prefix}">{title}</a><ul>{items}</ul></div>')
    out = TEMPLATE.replace("{{NAV}}", "".join(nav)).replace("{{BODY}}", "".join(sections))
    (ROOT / "index.html").write_text(out, encoding="utf-8")
    print(f"index.html 생성: {len(out) // 1024}KB")


TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StockApp 기능 보고서</title>
<style>
:root{--bg:#f7f6fc;--card:#fff;--text:#1f1d2b;--muted:#6b6880;--line:#e6e3f1;--accent:#5b4ee6;--code:#f0eefa;--side:#fbfaff}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#15141c;--card:#1e1c28;--text:#ecebf3;--muted:#a19eb5;--line:#2e2b3d;--accent:#9c93ff;--code:#272436;--side:#1a1923}}
:root[data-theme=dark]{--bg:#15141c;--card:#1e1c28;--text:#ecebf3;--muted:#a19eb5;--line:#2e2b3d;--accent:#9c93ff;--code:#272436;--side:#1a1923}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
aside{position:fixed;inset:0 auto 0 0;width:270px;overflow-y:auto;background:var(--side);border-right:1px solid var(--line);padding:20px 16px}
aside h1{font-size:17px;margin:0 0 4px}
aside .sub{color:var(--muted);font-size:12px;margin-bottom:14px}
.nav-group{margin-bottom:14px}
.nav-title{display:block;font-weight:700;color:var(--text);text-decoration:none;margin-bottom:4px}
.nav-group ul{list-style:none;margin:0;padding:0 0 0 8px;border-left:2px solid var(--line)}
.nav-group li a{display:block;color:var(--muted);text-decoration:none;font-size:13px;padding:2px 6px;border-radius:6px}
.nav-group li a:hover,.nav-group li a.on{color:var(--accent);background:var(--code)}
main{margin-left:270px;padding:28px 40px 80px;max-width:1180px}
.doc{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 34px;margin-bottom:32px}
h1{font-size:26px;margin-top:0}
h2{font-size:20px;margin-top:40px;padding-top:12px;border-top:1px solid var(--line)}
h3{font-size:16px;margin-top:26px}
blockquote{margin:0 0 16px;padding:8px 14px;border-left:4px solid var(--accent);background:var(--code);border-radius:6px;color:var(--muted)}
code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:13px}
pre{background:var(--code);padding:14px;border-radius:10px;overflow-x:auto;line-height:1.4}
pre code{padding:0}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{background:var(--code)}
img{max-width:100%;max-height:640px;border:1px solid var(--line);border-radius:10px;cursor:zoom-in;display:block;margin:10px 0}
td img{max-height:520px}
a{color:var(--accent)}
#lightbox{position:fixed;inset:0;background:rgba(10,8,20,.88);display:none;align-items:center;justify-content:center;z-index:10;cursor:zoom-out;padding:20px}
#lightbox img{max-width:96vw;max-height:94vh;cursor:zoom-out;border:none;margin:0}
#theme{position:fixed;top:12px;right:14px;z-index:5;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:4px 12px;cursor:pointer}
#menu{display:none}
@media (max-width:860px){
  aside{transform:translateX(-100%);transition:transform .2s;z-index:6;width:80vw}
  aside.open{transform:none}
  main{margin-left:0;padding:56px 16px 60px}
  .doc{padding:18px 16px}
  #menu{display:block;position:fixed;top:12px;left:14px;z-index:7;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:4px 12px}
}
</style>
</head>
<body>
<button id="menu" aria-label="목차">☰ 목차</button>
<button id="theme" aria-label="테마 전환">🌓</button>
<aside id="side"><h1>📈 StockApp 기능 보고서</h1><div class="sub">2026-10-22 · dev 8d7d3c7</div>{{NAV}}</aside>
<main>{{BODY}}</main>
<div id="lightbox"><img alt=""></div>
<script>
(function(){
  var lb=document.getElementById('lightbox'),lbi=lb.querySelector('img');
  document.querySelectorAll('main img').forEach(function(i){i.addEventListener('click',function(){lbi.src=i.src;lb.style.display='flex';});});
  lb.addEventListener('click',function(){lb.style.display='none';});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')lb.style.display='none';});
  var side=document.getElementById('side');
  document.getElementById('menu').onclick=function(){side.classList.toggle('open');};
  side.addEventListener('click',function(e){if(e.target.tagName==='A')side.classList.remove('open');});
  var root=document.documentElement;
  try{var t=localStorage.getItem('fr-theme');if(t)root.dataset.theme=t;}catch(e){}
  document.getElementById('theme').onclick=function(){
    var dark=root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme=dark?'light':'dark';
    try{localStorage.setItem('fr-theme',root.dataset.theme);}catch(e){}
  };
  var links=[].slice.call(document.querySelectorAll('.nav-group li a'));
  var obs=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){links.forEach(function(l){l.classList.toggle('on',l.getAttribute('href')==='#'+en.target.id);});}});},{rootMargin:'0px 0px -75% 0px'});
  document.querySelectorAll('main h2[id]').forEach(function(h){obs.observe(h);});
})();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
