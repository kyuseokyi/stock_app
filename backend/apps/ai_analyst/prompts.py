"""Gemini 프롬프트 — 시스템 프롬프트 상수 + 유저 프롬프트 빌더(순수 함수).

입력은 dict/list(뉴스는 NewsItem dataclass 또는 dict 모두 허용)로 받아 간결한 텍스트로 만든다.
뉴스는 종목·키워드당 최대 NEWS_PER_ITEM 건, 설명은 DESC_MAX 자로 자른다(토큰 절약).
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping

NEWS_PER_ITEM = 5
DESC_MAX = 120

SYSTEM_PROMPT = """너는 한국 주식시장 전문 애널리스트다. 다음 원칙을 반드시 지켜라.
1. 제공된 데이터(시세·지표·뉴스·공시)에 있는 사실만 근거로 쓴다. 추측·소문·과장 금지.
2. 모든 문장은 한국어로, 짧고 명확하게 쓴다. 매수·매도 추천이나 목표가는 쓰지 않는다.
3. 뉴스·공시에 근거가 없으면 지어내지 말고, 원인은 "단순수급", 신뢰도(reliability)는 "하"로 둔다.
4. 숫자는 제공된 값만 인용한다. 없는 수치를 만들지 않는다.
5. 응답은 지정된 JSON 스키마를 정확히 따른다."""


def _get(obj, key: str, default=None):
    """dict 와 dataclass/객체 모두에서 필드를 꺼낸다."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _cut(text, limit: int = DESC_MAX) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _num(v, fmt: str = "{:,.2f}") -> str:
    if v is None:
        return "-"
    try:
        return fmt.format(float(v))
    except (TypeError, ValueError):
        return str(v)


def _pct(v) -> str:
    if v is None:
        return "-"
    try:
        return f"{float(v):+.2f}%"
    except (TypeError, ValueError):
        return str(v)


def _news_lines(news: Iterable | None, indent: str = "  ") -> list[str]:
    lines = []
    for n in list(news or [])[:NEWS_PER_ITEM]:
        title = _cut(_get(n, "title"), DESC_MAX)
        desc = _cut(_get(n, "description"), DESC_MAX)
        lines.append(f"{indent}- {title}" + (f" — {desc}" if desc else ""))
    return lines or [f"{indent}- (관련 뉴스 없음)"]


def _amount_eok(v) -> str:
    """원 → 억 원 표기."""
    try:
        return f"{float(v) / 1e8:+,.0f}억"
    except (TypeError, ValueError):
        return "-"


def morning_brief_prompt(indices: Iterable[Mapping], macro: Iterable[Mapping], us_news: Iterable | None = None) -> str:
    """indices: [{name, close, change_rate}], macro: [{name, value, change_rate?}]."""
    out = ["[전일 해외·국내 지수]"]
    for i in indices or []:
        out.append(f"- {_get(i, 'name')}: {_num(_get(i, 'close'))} ({_pct(_get(i, 'change_rate'))})")
    out.append("[거시 지표]")
    for m in macro or []:
        line = f"- {_get(m, 'name')}: {_num(_get(m, 'value'))}"
        if _get(m, "change_rate") is not None:
            line += f" ({_pct(_get(m, 'change_rate'))})"
        out.append(line)
    if us_news is not None:
        out.append("[미국 증시 관련 뉴스]")
        out.extend(_news_lines(us_news, indent=""))
    out.append(
        "위 데이터만 근거로 오늘 아침 한국 투자자용 모닝 브리핑을 작성하라. "
        "뉴욕증시 마감 요약, 한국 증시 영향, 수혜 섹터·주의 섹터(각 이유 1문장), 거시 체크포인트를 담아라."
    )
    return "\n".join(out)


def _mover_block(title: str, movers: Iterable[Mapping], news_by_ticker: Mapping) -> list[str]:
    out = [f"[{title}]"]
    for m in movers or []:
        t = _get(m, "ticker")
        out.append(f"* {t} {_get(m, 'name') or _get(m, 'stock_name')} 등락률 {_pct(_get(m, 'change_rate'))}")
        out.extend(_news_lines((news_by_ticker or {}).get(t)))
    return out


def movers_prompt(gainers: Iterable[Mapping], losers: Iterable[Mapping], news_by_ticker: Mapping) -> str:
    """gainers/losers: [{ticker, name, change_rate}], news_by_ticker: {ticker: [뉴스]}."""
    out = _mover_block("급등 종목", gainers, news_by_ticker)
    out += _mover_block("급락 종목", losers, news_by_ticker)
    out.append(
        "각 종목마다 급등·급락의 핵심 원인을 30자 내외 1문장으로 요약하라(items 에 위 모든 종목). "
        "ticker·stock_name·change_rate 는 위 값을 그대로 쓴다. "
        "category 는 수주계약 | 실적호조 | 테마수급 | 경영권 | 유상증자/악재 | 단순수급 중 하나, "
        "reliability 는 뉴스 실체가 분명하면 상, 정황뿐이면 중, 근거 없으면 하. "
        "단기 추격매수 위험이 있으면 risk_warning 에 쓴다."
    )
    return "\n".join(out)


def hot_keywords_prompt(movers: Iterable[Mapping], news: Iterable | None) -> str:
    """movers: 오늘 급등락 종목 [{ticker, name, change_rate}], news: 시장 전반 뉴스."""
    out = ["[오늘 급등락 종목]"]
    for m in movers or []:
        out.append(f"- {_get(m, 'ticker')} {_get(m, 'name') or _get(m, 'stock_name')} {_pct(_get(m, 'change_rate'))}")
    out.append("[관련 뉴스]")
    news = list(news or [])
    lines = []
    for n in news[: NEWS_PER_ITEM * 4]:
        title, desc = _cut(_get(n, "title")), _cut(_get(n, "description"))
        lines.append(f"- {title}" + (f" — {desc}" if desc else ""))
    out.extend(lines or ["- (관련 뉴스 없음)"])
    out.append(
        "위 종목과 뉴스에서 오늘 시장의 핫 키워드(테마·이슈)를 최대 10개 뽑아라. "
        "각 키워드에 떠오른 배경 1문장과 관련 종목 코드(위 목록에 있는 것만)를 붙여라."
    )
    return "\n".join(out)


def _flow_block(title: str, rows: Iterable[Mapping], sector_by_ticker: Mapping) -> list[str]:
    out = [f"[{title}]"]
    rows = list(rows or [])
    for r in rows:
        t = _get(r, "ticker")
        sector = (sector_by_ticker or {}).get(t)
        out.append(f"- {_get(r, 'name')}({t}){' · ' + sector if sector else ''}: {_amount_eok(_get(r, 'net_amount'))}")
    if not rows:
        out.append("- (데이터 없음)")
    return out


def investor_flow_prompt(foreign_top, institution_top, pension_top, double_buy, sector_by_ticker: Mapping) -> str:
    out = _flow_block("외국인 순매수 상위", foreign_top, sector_by_ticker)
    out += _flow_block("기관 순매수 상위", institution_top, sector_by_ticker)
    out += _flow_block("연기금 순매수 상위", pension_top, sector_by_ticker)
    out.append("[외국인·기관 동반 순매수]")
    db = list(double_buy or [])
    for r in db:
        t = _get(r, "ticker")
        out.append(f"- {_get(r, 'name')}({t}): 외국인 {_amount_eok(_get(r, 'foreign_amount'))}, "
                   f"기관 {_amount_eok(_get(r, 'institution_amount'))}")
    if not db:
        out.append("- (데이터 없음)")
    out.append("위 수급 데이터만 근거로 오늘 큰손의 자금이 어느 업종·종목으로 향했는지 2줄로 해설하라.")
    return "\n".join(out)


def stock_qualitative_prompt(ticker: str, name: str, canslim_summary: Mapping | str | None,
                             disclosures: Iterable | None, red_flag_hints: Iterable[str] | None,
                             news: Iterable | None) -> str:
    """canslim_summary: {항목: 값} 또는 문자열, disclosures: Disclosure 또는 dict(report_nm, rcept_dt)."""
    out = [f"[종목] {name}({ticker})", "[CANSLIM 요약]"]
    if isinstance(canslim_summary, Mapping):
        out.extend(f"- {k}: {v}" for k, v in canslim_summary.items())
    elif canslim_summary:
        out.append(f"- {_cut(canslim_summary, 400)}")
    else:
        out.append("- (없음)")
    out.append("[최근 공시]")
    disc = list(disclosures or [])[:10]
    out.extend(f"- {_get(d, 'rcept_dt') or ''} {_cut(_get(d, 'report_nm'))}".rstrip() for d in disc)
    if not disc:
        out.append("- (최근 공시 없음)")
    hints = [h for h in (red_flag_hints or []) if h]
    out.append("[공시 기반 위험 신호]")
    if hints:
        out.extend(f"- {h}" for h in hints)
    else:
        out.append("- (없음)")
    out.append("[최근 뉴스]")
    out.extend(_news_lines(news, indent=""))
    out.append(
        "이 종목이 스크리너에 포착된 사유를 1줄(hook_summary)로 쓰고, 실적 품질(growth_quality)을 "
        "본업성장/일회성이익/불확실 중 하나로 판정하라(근거 부족하면 불확실). financial_quality_note 에 근거를 쓰고, "
        "지뢰 위험도(red_flag_level)를 CLEAN/WARNING/DANGER 중 하나로, red_flags 에 감지된 리스크를 나열하라. "
        f"ticker 는 {ticker} 로 둔다."
    )
    return "\n".join(out)
