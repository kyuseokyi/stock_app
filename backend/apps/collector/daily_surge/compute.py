"""급등락·테마 분석 순수 계산 — DB·네트워크 없음(입력은 dict, 출력은 dict 목록).

- 종목 행: 기준일·직전 거래일 일봉(close, volume)으로 등락률·전일대비·거래대금(close × volume)·거래량 배수.
- 분류: 급등 +10.0 ~ +30.5%, 급락 −30.5 ~ −10.0%(상·하한가 호가 단위 여유 0.5%p), 거래대금 상위 top_n.
- 테마 묶음: 같은 테마에서 같은 방향 2종목 이상. 대장주 = 거래대금 1위(같으면 |등락률| 큰 쪽 → 코드 오름차순).
- 대표 테마: 종목이 속한 같은 방향 묶음 중 **함께 움직인 비율(종목 수 ÷ 테마 크기)** → 종목 수 → 거래대금 합 → 테마 id 순.
  종목 수만 보면 구성 종목이 수백 개인 넓은 테마(신규상장·대형 묶음 등)가 우연히 여러 급등주를 품어 뽑힌다(2026-11-27 상용).
- 소속 테마 목록: 묶음이 없는 종목도 어느 테마에 속하는지 보이게, 종목마다 최대 5개(함께 움직인 수 → 작은 테마 순).
- 공시 키워드: 정해진 사전과 공시 제목 대조(AI·뉴스 미사용).
- 뉴스 시각 배지: 받은 기사에 붙이는 표시일 뿐 목록 순서·개수는 바꾸지 않는다(네이버 약관 N1).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")

SURGE_MIN, SURGE_MAX = 10.0, 30.5
PLUNGE_MIN, PLUNGE_MAX = -30.5, -10.0
GROUP_MIN_STOCKS = 2
TOP_VALUE_N = 50
DART_VIEWER = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo="

# (키워드, 제목에서 찾을 말들) — 순서 = 표시 순서
DART_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("유상증자", ("유상증자",)),
    ("무상증자", ("무상증자",)),
    ("전환사채", ("전환사채",)),
    ("신주인수권", ("신주인수권",)),
    ("교환사채", ("교환사채",)),
    ("공급계약", ("공급계약",)),
    ("수주", ("수주",)),
    ("감자", ("감자결정", "감자 결정", "자본감소")),
    ("합병", ("합병",)),
    ("분할", ("분할",)),
    ("자기주식", ("자기주식",)),
    ("최대주주변경", ("최대주주변경", "최대주주 변경")),
    ("감사의견", ("감사의견", "감사보고서")),
    ("관리종목", ("관리종목",)),
    ("상장폐지", ("상장폐지",)),
    ("불성실공시", ("불성실공시",)),
    ("소송", ("소송",)),
    ("임상", ("임상",)),
    ("특허", ("특허",)),
    ("실적", ("영업실적", "잠정실적", "매출액또는손익구조", "손익구조")),
    ("투자판단", ("투자판단",)),
)


def _round2(x: float) -> float:
    return round(x + 0.0, 2)


def build_rows(today: dict[str, tuple[float, float]], prev: dict[str, tuple[float, float]],
               profiles: dict[str, tuple[str, bool]], names: dict[str, str]) -> list[dict]:
    """기준일·직전 거래일 (close, volume) → 보통주 종목 행. 전일 없음·전일 종가 0·보통주 아님·프로필 없음은 뺀다."""
    out: list[dict] = []
    for ticker, (close, volume) in today.items():
        prof = profiles.get(ticker)
        before = prev.get(ticker)
        if prof is None or not prof[1] or before is None:
            continue
        prev_close, prev_volume = before
        if not prev_close or prev_close <= 0 or close is None or close <= 0:
            continue
        rate = (close - prev_close) / prev_close * 100.0
        out.append({
            "ticker": ticker,
            "name": names.get(ticker) or ticker,
            "market": prof[0],
            "close": float(close),
            "prev_close": float(prev_close),
            "change_price": float(close) - float(prev_close),
            "change_rate": _round2(rate),
            "volume": int(volume or 0),
            "volume_ratio": _round2(volume / prev_volume * 100.0) if prev_volume else None,
            "trading_value": float(close) * float(volume or 0),
        })
    return out


def classify(rows: list[dict], *, top_n: int = TOP_VALUE_N) -> list[dict]:
    """분류·순위를 행에 채운다(같은 목록 반환). 경계값은 반올림한 등락률 기준."""
    for r in rows:
        rate = r["change_rate"]
        r["is_surge"] = SURGE_MIN <= rate <= SURGE_MAX
        r["is_plunge"] = PLUNGE_MIN <= rate <= PLUNGE_MAX
        r["surge_rank"] = r["plunge_rank"] = None
        r.setdefault("primary_theme_id", None)
        r.setdefault("primary_theme_name", None)
        r.setdefault("is_theme_leader", False)
    by_value = sorted(rows, key=lambda r: (-r["trading_value"], r["ticker"]))
    for i, r in enumerate(by_value, 1):
        r["value_rank"] = i
        r["is_top_value"] = i <= top_n
    for i, r in enumerate(sorted((r for r in rows if r["is_surge"]), key=lambda r: (-r["change_rate"], r["ticker"])), 1):
        r["surge_rank"] = i
    for i, r in enumerate(sorted((r for r in rows if r["is_plunge"]), key=lambda r: (r["change_rate"], r["ticker"])), 1):
        r["plunge_rank"] = i
    return rows


def targets(rows: list[dict]) -> list[dict]:
    """저장 대상 = 급등 ∪ 급락 ∪ 거래대금 상위."""
    return [r for r in rows if r["is_surge"] or r["is_plunge"] or r["is_top_value"]]


def _leader_key(r: dict) -> tuple:
    return (-r["trading_value"], -abs(r["change_rate"]), r["ticker"])


def theme_groups(rows: list[dict], themes: dict[int, tuple[str, list[str]]]) -> list[dict]:
    """방향별로 같은 테마 급등(급락) 종목이 GROUP_MIN_STOCKS 개 이상이면 묶음."""
    by_ticker = {r["ticker"]: r for r in rows}
    out: list[dict] = []
    for theme_id, (name, tickers) in themes.items():
        unique = list(dict.fromkeys(tickers))
        members = [by_ticker[t] for t in unique if t in by_ticker]
        for direction, flag in (("up", "is_surge"), ("down", "is_plunge")):
            hit = sorted((m for m in members if m[flag]), key=_leader_key)
            if len(hit) < GROUP_MIN_STOCKS:
                continue
            leader = hit[0]
            out.append({
                "theme_id": int(theme_id),
                "theme_name": name,
                "theme_size": len(unique),
                "direction": direction,
                "stock_count": len(hit),
                "avg_change_rate": _round2(sum(m["change_rate"] for m in hit) / len(hit)),
                "value_sum": sum(m["trading_value"] for m in hit),
                "leader_ticker": leader["ticker"],
                "leader_name": leader["name"],
                "members": [m["ticker"] for m in hit],
            })
    out.sort(key=lambda g: (g["direction"] != "up", -g["stock_count"], -g["value_sum"], g["theme_id"]))
    return out


def assign_primary(rows: list[dict], groups: list[dict]) -> None:
    """급등·급락 종목에 대표 테마와 대장주 여부를 채운다(거래대금 상위만인 종목은 없음)."""
    for r in rows:
        direction = "up" if r.get("is_surge") else "down" if r.get("is_plunge") else None
        r["primary_theme_id"] = None
        r["primary_theme_name"] = None
        r["is_theme_leader"] = False
        if direction is None:
            continue
        cands = [g for g in groups if g["direction"] == direction and r["ticker"] in g["members"]]
        if not cands:
            continue
        best = min(cands, key=lambda g: (-g["stock_count"] / max(g.get("theme_size") or g["stock_count"], 1),
                                          -g["stock_count"], -g["value_sum"], g["theme_id"]))
        r["primary_theme_id"] = best["theme_id"]
        r["primary_theme_name"] = best["theme_name"]
        r["is_theme_leader"] = best["leader_ticker"] == r["ticker"]


def dart_keywords(titles: list[str]) -> list[str]:
    found: list[str] = []
    for kw, needles in DART_KEYWORDS:
        if any(n in t for t in titles for n in needles):
            found.append(f"#{kw}")
    return found


def dart_items(disclosures: list[tuple[str, str, str]], trade_date: date) -> list[dict]:
    """[(rcept_dt YYYYMMDD, rcept_no, 제목)] → 저장용. 기준일 접수 = same, 그 전 = prev(시각은 DART 가 주지 않는다)."""
    same = trade_date.strftime("%Y%m%d")
    return [{
        "rcept_no": no, "rcept_dt": dt, "title": title,
        "when": "same" if dt == same else "prev",
        "url": f"{DART_VIEWER}{no}",
    } for dt, no, title in disclosures]


def time_slot(published: datetime | None, trade_date: date, prev_date: date) -> str:
    """기사 발행 시각 → pre(직전 거래일 15:30 ~ 기준일 09:00) · intra(09:00~15:30) · post(15:30 초과 ~ 자정 전) · other."""
    if published is None:
        return "other"
    t = published.astimezone(KST) if published.tzinfo else published.replace(tzinfo=KST)
    close_prev = datetime.combine(prev_date, time(15, 30), KST)
    open_t = datetime.combine(trade_date, time(9, 0), KST)
    close_t = datetime.combine(trade_date, time(15, 30), KST)
    end_t = datetime.combine(trade_date + timedelta(days=1), time(0, 0), KST)
    if close_prev <= t < open_t:
        return "pre"
    if open_t <= t <= close_t:
        return "intra"
    if close_t < t < end_t:
        return "post"
    return "other"


def parse_pub_date(raw: str | None) -> datetime | None:
    """네이버 pubDate(RFC 822) → aware datetime. 실패하면 None."""
    if not raw:
        return None
    try:
        d = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        return None
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=KST)


THEME_LIST_MAX = 5


def stock_theme_lists(rows: list[dict], themes: dict[int, tuple[str, list[str]]], groups: list[dict],
                      *, limit: int = THEME_LIST_MAX, source: str | None = None) -> None:
    """각 행에 소속 테마 목록(row["themes"])을 채운다 — [{id, name, size, moved}] 최대 limit 개.

    moved = 그날 같은 방향으로 함께 움직인 종목 수(그 테마 묶음의 종목 수, 묶음 없으면 0).
    정렬: moved 큰 순 → 테마 크기 작은 순(구체적인 테마 먼저) → id.
    """
    wanted = {r["ticker"] for r in rows}
    member_of: dict[str, list[tuple[int, str, int]]] = {}
    for theme_id, (name, tickers) in themes.items():
        unique = list(dict.fromkeys(tickers))
        for t in unique:
            if t in wanted:
                member_of.setdefault(t, []).append((int(theme_id), name, len(unique)))
    moved = {(g["theme_id"], g["direction"]): g["stock_count"] for g in groups}
    for r in rows:
        direction = "up" if r.get("is_surge") else "down" if r.get("is_plunge") else None
        items = [{"id": i, "name": n, "size": size, "moved": moved.get((i, direction), 0) if direction else 0,
                  "source": source}
                 for i, n, size in member_of.get(r["ticker"], [])]
        items.sort(key=lambda x: (-x["moved"], x["size"], x["id"]))
        r["themes"] = items[:limit]


def fill_fallback_themes(rows: list[dict], targets_: list[dict], fallback: dict[int, tuple[str, list[str]]],
                         *, source: str = "kis", limit: int = THEME_LIST_MAX) -> int:
    """주 출처(키움) 소속 테마가 하나도 없는 대상 종목에만 보충 출처(KIS) 테마 목록을 채운다. 채운 종목 수.

    함께 움직인 수(moved)는 보충 출처 테마 기준으로 센다(전체 행 rows 로 계산). 대표 테마·묶음·대장주는 바꾸지 않는다.
    """
    empty = [r for r in targets_ if not r.get("themes")]
    if not empty or not fallback:
        return 0
    stock_theme_lists(empty, fallback, theme_groups(rows, fallback), limit=limit, source=source)
    return sum(1 for r in empty if r.get("themes"))
