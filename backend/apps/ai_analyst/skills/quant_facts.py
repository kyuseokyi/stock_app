"""AI Lab 정량 팩트 — 순수 함수(DB·네트워크 없음). 숫자는 여기서만 계산하고 AI 는 해석만 한다.

입력 봉(bars)은 날짜 오름차순 dict 목록: {"date", "open", "high", "low", "close", "volume"}.
이동평균은 저장값(ma5·ma20 …)을 믿지 않고 종가로 직접 계산한다(150·200일선은 저장값이 없기도 함).
비율·가격은 소수 2자리 반올림, 비교에는 부동소수 오차용 아주 작은 여유(_EPS)를 둔다.

설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 2절
"""
from __future__ import annotations

import math
import re
from statistics import median

_EPS = 1e-9
HORIZONS = (3, 5, 10, 20)
MAX_HORIZON = 20
WEEK52 = 250  # 52주 ≈ 250거래일
SPLIT_JUMP = 0.5  # 하루 종가 변동 ±50% 초과 = 수정주가 미반영 의심(patterns/kinds/htf.py 와 같은 기준)
COOLDOWN = 5  # 같은 셋업 신호가 직전 집계 신호 후 5봉 이내면 집계 제외(표본 겹침 방지)
VOL_MIN_VALID = 15  # 셋업 A 거래량 평균에 필요한 유효(거래량 > 0) 봉 수

SETUP_LABELS = {
    "A": "5일선 20일선 상향 돌파 + 거래량 1.5배",
    "B": "상승 추세 20일선 눌림목",
    "C": "당일 +10% 이상 장대양봉",
}
REGIME_RISK = {"BULL": [1.5, 2.0], "CHOPPY": [0.5, 1.0], "BEAR": [0.0, 0.5]}


def _r(x: float | None, nd: int = 2) -> float | None:
    return None if x is None else round(float(x), nd)


def _sma(values: list[float], k: int, end: int) -> float | None:
    """values[end-k+1 .. end] 평균 — 봉이 모자라면 None."""
    if end < k - 1 or end >= len(values):
        return None
    return sum(values[end - k + 1:end + 1]) / k


def _pct(a: float, b: float) -> float:
    return (a / b - 1.0) * 100.0


# ---------------------------------------------------------------- 수정주가 방어

def split_cut(bars: list[dict]) -> tuple[list[dict], dict | None]:
    """하루 종가 변동이 ±50% 를 넘는 봉(가장 최근 것)이 있으면 그 봉부터만 남긴다.

    KIS 수정주가 미반영(감자·액면 변경 등)으로 생긴 가짜 급등락이 이동평균·52주 고저·백테스트를 왜곡하지 않게.
    반환: (잘린 봉, {"date", "jump_pct", "dropped"} | None).
    """
    cut = None
    for i in range(len(bars) - 1, 0, -1):
        prev, cur = float(bars[i - 1]["close"]), float(bars[i]["close"])
        if prev > 0 and abs(cur / prev - 1.0) > SPLIT_JUMP:
            cut = i
            break
    if cut is None:
        return bars, None
    return bars[cut:], {"date": bars[cut]["date"], "jump_pct": _r(_pct(float(bars[cut]["close"]),
                                                                        float(bars[cut - 1]["close"]))),
                        "dropped": cut}


# ---------------------------------------------------------------- SEPA

def compute_sepa_template(bars: list[dict], rs: float | None) -> dict:
    """미너비니 추세 템플릿 8조건 + 단계(Stage 1~4).

    - 200봉 미만: evaluable=False(판정 불가).
    - ③(200일선 20봉 전보다 상승)은 220봉 미만이면 None(자료 부족). RS 가 None 이면 ⑧ None.
    - 52주 최고·최저는 최근 250봉(모자라면 있는 만큼)의 고가·저가.
    - 단계(단순 규칙): 150>200일선 & 종가>150일선 & 200일선 하락 아님 → 2,
      150>200일선인데 종가≤150일선 → 3, 150≤200일선인데 종가>150일선(또는 2단계 구조에 200일선 하락) → 1, 그 밖 4.
    """
    n = len(bars)
    if n < 200:
        return {"evaluable": False, "reason": f"200봉 미만({n}봉) — 판정 불가", "bars": n,
                "conditions": [], "pass_count": 0, "evaluable_count": 0, "all_pass": False, "stage": None}
    closes = [float(b["close"]) for b in bars]
    last = n - 1
    close = closes[last]
    ma50, ma150, ma200 = _sma(closes, 50, last), _sma(closes, 150, last), _sma(closes, 200, last)
    ma200_prev = _sma(closes, 200, last - 20)
    window = bars[-WEEK52:]
    hi52 = max(float(b["high"]) for b in window)
    lo52 = min(float(b["low"]) for b in window)
    rising = None if ma200_prev is None else ma200 > ma200_prev + _EPS

    conds = [
        (1, "close_above_ma150_ma200", "종가 > 150·200일선", close > ma150 and close > ma200,
         {"close": close, "ma150": ma150, "ma200": ma200}),
        (2, "ma150_above_ma200", "150일선 > 200일선", ma150 > ma200, {"ma150": ma150, "ma200": ma200}),
        (3, "ma200_rising_20", "200일선 20봉 전보다 상승", rising, {"ma200": ma200, "ma200_20ago": ma200_prev}),
        (4, "ma50_above_ma150_ma200", "50일선 > 150·200일선", ma50 > ma150 and ma50 > ma200,
         {"ma50": ma50, "ma150": ma150, "ma200": ma200}),
        (5, "close_above_ma50", "종가 > 50일선", close > ma50, {"close": close, "ma50": ma50}),
        (6, "above_52w_low_130", "종가 ≥ 52주 최저 × 1.30", close >= lo52 * 1.30 - _EPS,
         {"close": close, "low_52w": lo52, "ratio": close / lo52 if lo52 > 0 else None}),
        (7, "within_25_of_52w_high", "종가 ≥ 52주 최고 × 0.75", close >= hi52 * 0.75 - _EPS,
         {"close": close, "high_52w": hi52, "pct_from_high": _pct(close, hi52) if hi52 > 0 else None}),
        (8, "rs_70", "RS ≥ 70", None if rs is None else float(rs) >= 70, {"rs": rs}),
    ]
    conditions = [{"no": no, "key": key, "label": label, "pass": None if ok is None else bool(ok),
                   "values": {k: _r(v) for k, v in vals.items()}}
                  for no, key, label, ok, vals in conds]
    passed = sum(1 for c in conditions if c["pass"] is True)
    evaluable = sum(1 for c in conditions if c["pass"] is not None)

    up_struct = ma150 > ma200
    above = close > ma150
    if up_struct and above and rising is not False:
        stage = 2
    elif up_struct and not above:
        stage = 3
    elif above:
        stage = 1
    else:
        stage = 4
    return {"evaluable": True, "reason": None, "bars": n, "conditions": conditions, "pass_count": passed,
            "evaluable_count": evaluable, "all_pass": passed == 8, "stage": stage}


# ---------------------------------------------------------------- 셋업 백테스트

def _setups_at(i: int, closes, lows, vols, ma5, ma20, ma50) -> list[str]:
    hits: list[str] = []
    # A: 5일선이 20일선을 아래→위 돌파 + 거래량 ≥ 직전 20일(당일 제외) 평균 × 1.5
    #    거래량 0 봉(거래정지)은 평균에서 빼고, 유효 봉이 15개 미만이면 판정하지 않는다
    if i >= 20 and None not in (ma5[i], ma20[i], ma5[i - 1], ma20[i - 1]):
        valid = [v for v in vols[i - 20:i] if v > 0]
        avg_v = sum(valid) / len(valid) if len(valid) >= VOL_MIN_VALID else 0.0
        if ma5[i - 1] <= ma20[i - 1] + _EPS and ma5[i] > ma20[i] + _EPS and avg_v > 0 \
                and vols[i] >= avg_v * 1.5 - _EPS:
            hits.append("A")
    # B: 종가 > 50일선, 20일선이 5봉 전보다 높음, 저가 ≤ 20일선 × 1.01, 종가 ≥ 20일선
    if i >= 5 and None not in (ma50[i], ma20[i], ma20[i - 5]):
        if closes[i] > ma50[i] and ma20[i] > ma20[i - 5] + _EPS and lows[i] <= ma20[i] * 1.01 + _EPS \
                and closes[i] >= ma20[i] - _EPS:
            hits.append("B")
    # C: 전일 종가 대비 +10% 이상
    if i >= 1 and closes[i - 1] > 0 and _pct(closes[i], closes[i - 1]) >= 10.0 - 1e-6:
        hits.append("C")
    return hits


def run_setup_backtest(bars: list[dict]) -> dict:
    """셋업 A·B·C 신호일 종가 진입 → D+3·5·10·20 종가 수익률(승률 = 수익률 > 0 비율·평균),
    D+1~D+20 고가·저가로 MFE·MAE 평균. D+20 봉이 없는 신호는 모든 통계에서 제외(지평별 발생 수가 같게).
    같은 셋업 신호가 직전 집계 신호 후 COOLDOWN(5)봉 이내면 집계 제외(skipped_cooldown). today 는 쿨다운과 무관.
    """
    n = len(bars)
    closes = [float(b["close"]) for b in bars]
    highs = [float(b["high"]) for b in bars]
    lows = [float(b["low"]) for b in bars]
    vols = [float(b["volume"] or 0) for b in bars]
    ma5 = [_sma(closes, 5, i) for i in range(n)]
    ma20 = [_sma(closes, 20, i) for i in range(n)]
    ma50 = [_sma(closes, 50, i) for i in range(n)]

    samples: dict[str, list[dict]] = {k: [] for k in SETUP_LABELS}
    excluded = {k: 0 for k in SETUP_LABELS}
    cooled = {k: 0 for k in SETUP_LABELS}
    last_taken: dict[str, int] = {}
    detected: dict[str, list[str]] = {k: [] for k in SETUP_LABELS}
    today: list[str] = []
    for i in range(n):
        hits = _setups_at(i, closes, lows, vols, ma5, ma20, ma50)
        if i == n - 1:
            today = hits
        for k in hits:
            detected[k].append(str(bars[i]["date"]))
            if k in last_taken and i - last_taken[k] <= COOLDOWN:
                cooled[k] += 1
                continue
            last_taken[k] = i
            if i + MAX_HORIZON > n - 1:
                excluded[k] += 1
                continue
            entry = closes[i]
            fut = range(i + 1, i + MAX_HORIZON + 1)
            samples[k].append({
                "date": str(bars[i]["date"]),
                "returns": {h: _pct(closes[i + h], entry) for h in HORIZONS},
                "mfe": _pct(max(highs[j] for j in fut), entry),
                "mae": _pct(min(lows[j] for j in fut), entry),
            })

    setups = {}
    for k, label in SETUP_LABELS.items():
        ss = samples[k]
        horizons = {}
        for h in HORIZONS:
            rets = [s["returns"][h] for s in ss]
            horizons[f"d{h}"] = {
                "win_rate": _r(sum(1 for x in rets if x > _EPS) / len(rets) * 100) if rets else None,
                "avg_return": _r(sum(rets) / len(rets)) if rets else None,
            }
        setups[k] = {
            "label": label, "count": len(ss), "excluded_recent": excluded[k], "skipped_cooldown": cooled[k],
            "horizons": horizons,
            "mfe_avg": _r(sum(s["mfe"] for s in ss) / len(ss)) if ss else None,
            "mae_avg": _r(sum(s["mae"] for s in ss) / len(ss)) if ss else None,
            "last_signal_date": ss[-1]["date"] if ss else None,
            "signal_dates": detected[k],  # 감지된 모든 신호일(쿨다운·미래 부족 제외 포함)
        }
    return {"bars": n, "cooldown": COOLDOWN, "setups": setups, "today": today}


# ---------------------------------------------------------------- 시장 폭

def compute_market_breadth(rows: list[dict]) -> dict:
    """같은 시장 보통주의 종가 > 20·50일선 비율 → 레짐.

    BULL: 20일선 위 ≥ 60% 그리고 50일선 위 ≥ 55% / BEAR: 둘 다 < 40% / 그 밖 CHOPPY.
    권장 1회 리스크(%): BULL 1.5~2.0, CHOPPY 0.5~1.0, BEAR 0~0.5.
    이동평균이 없거나 0 이하인 행은 뺀다(두 비율 모두 같은 표본).
    """
    valid = [r for r in rows if r.get("close") and r.get("ma20") and r.get("ma50")
             and float(r["ma20"]) > 0 and float(r["ma50"]) > 0]
    n = len(valid)
    if n == 0:
        return {"count": 0, "pct_above_ma20": None, "pct_above_ma50": None, "regime": None, "risk_range_pct": None}
    p20 = sum(1 for r in valid if float(r["close"]) > float(r["ma20"])) / n * 100
    p50 = sum(1 for r in valid if float(r["close"]) > float(r["ma50"])) / n * 100
    if p20 >= 60 - _EPS and p50 >= 55 - _EPS:
        regime = "BULL"
    elif p20 < 40 - _EPS and p50 < 40 - _EPS:
        regime = "BEAR"
    else:
        regime = "CHOPPY"
    return {"count": n, "pct_above_ma20": _r(p20), "pct_above_ma50": _r(p50), "regime": regime,
            "risk_range_pct": list(REGIME_RISK[regime])}


# ---------------------------------------------------------------- 손절·포지션

def suggest_stop(bars: list[dict]) -> dict | None:
    """손절가 = max(종가 × 0.92, 최근 10봉 최저가) 중 종가보다 낮은 값."""
    if not bars:
        return None
    close = float(bars[-1]["close"])
    pct_stop = close * 0.92
    low10 = min(float(b["low"]) for b in bars[-10:])
    if low10 < close - _EPS and low10 > pct_stop:
        stop, basis = low10, f"최근 10봉 최저가 {_r(low10)}"
    else:
        stop, basis = pct_stop, f"종가 −8% ({_r(pct_stop)})"
    return {"close": _r(close), "stop": _r(stop), "basis": basis, "pct_stop": _r(pct_stop), "low_10": _r(low10),
            "stop_distance_pct": _r(_pct(stop, close)) if close > 0 else None}


def position_size(capital: float, risk_pct: float, entry: float, stop: float) -> dict:
    """주식 수 = 내림(자본 × 리스크% ÷ (진입 − 손절)). 손절 ≥ 진입이면 ValueError.

    계산된 주식 수를 사면 자본을 넘는 경우 살 수 있는 만큼(내림(자본 ÷ 진입))으로 줄이고 capped_by_capital=True.
    """
    if capital <= 0 or risk_pct <= 0 or entry <= 0:
        raise ValueError("자본·리스크·진입가는 0보다 커야 합니다.")
    if stop >= entry:
        raise ValueError("손절가가 진입가 이상입니다.")
    per_share = entry - stop
    risk_amount = capital * risk_pct / 100.0
    shares = math.floor(risk_amount / per_share + _EPS)
    affordable = math.floor(capital / entry + _EPS)
    capped = shares > affordable
    shares = min(shares, affordable)
    amount = shares * entry
    return {"capital": _r(capital), "risk_pct": _r(risk_pct), "entry": _r(entry), "stop": _r(stop),
            "risk_amount": _r(risk_amount), "shares": shares, "amount": _r(amount),
            "weight_pct": _r(amount / capital * 100), "max_loss": _r(shares * per_share),
            "stop_distance_pct": _r(_pct(stop, entry)), "capped_by_capital": capped}


# ---------------------------------------------------------------- DART

# (라벨, 제목 패턴) — 공백을 지운 제목에서 찾는다. 실제 DART 보고서명 표기 기준.
_POSITIVE = [
    ("공급계약", re.compile(r"공급계약")),
    ("자사주 취득", re.compile(r"자기주식취득")),
    ("자사주 소각", re.compile(r"(자기주식|주식)소각")),
    ("무상증자", re.compile(r"무상증자")),
    ("잠정실적", re.compile(r"잠정\)?실적|\(잠정\)")),
]
_NEGATIVE = [
    ("유상증자", re.compile(r"유상증자"), True),
    ("CB", re.compile(r"전환사채"), True),
    ("BW", re.compile(r"신주인수권부사채"), True),
    ("EB", re.compile(r"교환사채"), True),
    ("전환청구", re.compile(r"전환청구"), True),
    ("신주인수권행사", re.compile(r"신주인수권행사"), True),
    ("감사의견", re.compile(r"감사의견.*(거절|한정|부적정)|의견거절"), False),
    ("관리종목", re.compile(r"관리종목"), False),
    ("불성실공시", re.compile(r"불성실공시"), False),
]
_FATAL = {"감사의견", "관리종목"}
# 해지·해제·철회·취소 — 호재 공시가 무르는 것이면 호재가 아니다(공급계약 해지는 악재), 지정 해제·결정 철회는 악재 아님
_CANCEL = re.compile(r"해지|해제|철회|취소")
# 자기주식취득 신탁계약 해지 — 만기 정상 종료가 많아 호재 철회(악재)로 보지 않고 중립(태그 없음)으로 둔다(사용자 결정 2026-11-27)
_TRUST_TERMINATION = re.compile(r"자기주식취득신탁계약")


def classify_dart(disclosures: list[dict]) -> dict:
    """공시 제목 → 호재(positive)/악재·오버행(negative) 태그. 둘 다 걸리면 악재 우선.
    자기주식처분은 호재가 아니다(태그 없음). 해지·해제·철회·취소가 든 제목은 호재가 아니며(호재 해지=악재,
    단 자기주식취득 신탁계약 해지는 만기 정상 종료가 많아 태그 없음, 악재 해제·철회=태그 없음, overhang·fatal 아님). overhang = 증자·CB·BW·EB·전환청구·신주인수권행사 존재,
    fatal = 감사의견(거절·한정·부적정)·관리종목 존재.
    """
    items = []
    overhang = fatal = False
    pos = neg = 0
    for d in disclosures:
        title = str(d.get("report_nm") or d.get("title") or "").strip()
        flat = re.sub(r"\s+", "", title)
        cancelled = bool(_CANCEL.search(flat))
        labels: list[str] = []
        is_neg = False
        is_pos = False
        if cancelled:
            # 호재를 무르는 공시(공급계약 해지 등)는 악재, 악재를 무르는 공시(관리종목 지정 해제·증자 철회)는 태그 없음
            for label, pat in _POSITIVE:
                if pat.search(flat) and "처분" not in flat:
                    if _TRUST_TERMINATION.search(flat):
                        labels.append(f"{label} 신탁계약 해지")  # 중립 — is_neg 아님
                        continue
                    labels.append(f"{label} 해지·철회")
                    is_neg = True
            for label, pat, _ in _NEGATIVE:
                if pat.search(flat):
                    labels.append(f"{label} 해제·철회")
        else:
            for label, pat, is_overhang in _NEGATIVE:
                if pat.search(flat):
                    labels.append(label)
                    is_neg = True
                    overhang = overhang or is_overhang
                    fatal = fatal or label in _FATAL
            for label, pat in _POSITIVE:
                if pat.search(flat) and "처분" not in flat:
                    labels.append(label)
                    is_pos = True
        tag = "negative" if is_neg else ("positive" if is_pos else None)
        pos += tag == "positive"
        neg += tag == "negative"
        items.append({"title": title, "rcept_dt": d.get("rcept_dt"), "rcept_no": d.get("rcept_no"),
                      "url": d.get("url"), "tag": tag, "labels": labels, "corrected": "정정" in flat,
                      "cancelled": cancelled})
    return {"items": items, "positive_count": pos, "negative_count": neg, "overhang": overhang, "fatal": fatal}


# ---------------------------------------------------------------- 업종 비교

def _ratios(row: dict) -> dict:
    close = row.get("close")
    eps, bps, roe = row.get("eps"), row.get("bps"), row.get("roe")
    return {
        "per": close / eps if close and eps is not None and eps > 0 else None,
        "pbr": close / bps if close and bps is not None and bps > 0 else None,
        "roe": float(roe) if roe is not None else None,
    }


def peer_valuation(target: dict, peers: list[dict]) -> dict:
    """업종 중앙값 PER(종가÷EPS)·PBR(종가÷BPS)·ROE 대비 괴리율(%). EPS·BPS 0 이하는 그 비율 표본에서 제외.
    대상 종목은 peers 에서 뺀다."""
    t = _ratios(target)
    others = [_ratios(p) for p in peers if p.get("ticker") != target.get("ticker")]
    med, sample, gap = {}, {}, {}
    for k in ("per", "pbr", "roe"):
        vals = [o[k] for o in others if o[k] is not None]
        sample[k] = len(vals)
        med[k] = median(vals) if vals else None
        gap[k] = _r((t[k] - med[k]) / abs(med[k]) * 100) if t[k] is not None and med[k] else None
    return {"target": {k: _r(v) for k, v in t.items()}, "median": {k: _r(v) for k, v in med.items()},
            "gap_pct": gap, "sample": sample}


# ---------------------------------------------------------------- 분기 이익 흐름

def earnings_trend(quarters: list[dict]) -> dict:
    """최근 4개 분기(stac_yymm 오름차순) 영업이익 증가율 나열. 최근 3개 분기 값이 연속 상승이면 가속, 연속 하락이면 감속
    (분기 3개 미만이거나 최근 3개 중 값 없는 분기가 끼면 None — 연속이 아니므로 판정하지 않음)."""
    qs = sorted((q for q in quarters if q.get("stac_yymm")), key=lambda q: str(q["stac_yymm"]))[-4:]
    rows = [{"stac_yymm": str(q["stac_yymm"]), "op_growth": _r(q.get("op_growth")),
             "sales_growth": _r(q.get("sales_growth")), "ni_growth": _r(q.get("ni_growth"))} for q in qs]
    series = [r["op_growth"] for r in rows]
    vals = series[-3:]
    if len(vals) < 3 or None in vals:
        acc = dec = None
    else:
        acc = vals[0] < vals[1] < vals[2]
        dec = vals[0] > vals[1] > vals[2]
    latest = None
    if qs:
        q = qs[-1]
        latest = {"stac_yymm": str(q["stac_yymm"]), "op_growth": _r(q.get("op_growth")),
                  "sales_growth": _r(q.get("sales_growth")), "ni_growth": _r(q.get("ni_growth")),
                  "debt_ratio": _r(q.get("debt_ratio"))}
    return {"quarters": rows, "op_growth_series": series, "accelerating": acc, "decelerating": dec, "latest": latest}
