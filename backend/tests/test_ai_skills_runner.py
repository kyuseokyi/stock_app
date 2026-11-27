"""AI Lab B단계 추론기 — 응답 검증(확률 정규화·거부·EV 재계산·지어낸 공시 버림·범위 자르기·링크)과 프롬프트 (가짜 클라이언트)."""
from __future__ import annotations

import json

import pytest

from apps.ai_analyst.skills import skill_runner as R
from apps.ai_analyst.skills.schemas import SkillAnalysisResponse

PREVIEW = {
    "ticker": "005930", "name": "삼성전자", "as_of": "2026-11-26", "close": 10000.0,
    "sepa": {"pass_count": 7, "stage": 2}, "backtest": {"setups": {}}, "stop": {"stop": 9200.0, "basis": "8%"},
    "position": {"shares": 125, "amount": 1_250_000}, "position_error": None,
    "market_breadth": {"regime": "BULL", "risk_range": [1.5, 2.0]},
    "liquidity": {"rs": 85}, "split_cut": None,
    "dart": {"available": True, "days": 90, "positive_count": 1, "negative_count": 1, "overhang": True,
             "fatal": False,
             "items": [
                 {"title": "단일판매ㆍ공급계약체결", "rcept_dt": "20261120", "rcept_no": "20261120000111",
                  "url": "https://x", "tag": "positive", "labels": ["공급계약"], "corrected": False,
                  "cancelled": False},
                 {"title": "주요사항보고서(전환사채권발행결정)", "rcept_dt": "20261101", "rcept_no": "20261101000222",
                  "url": "https://y", "tag": "negative", "labels": ["CB"], "corrected": False, "cancelled": False},
             ]},
    "peer_valuation": {"target": {"per": 10.0}}, "earnings_trend": {"accelerating": True}, "annual": None,
}


def _resp(**over) -> SkillAnalysisResponse:
    node = {"title": "t", "evidence": "e"}
    body = {
        "logic_chain": {"trigger": node, "business": node, "earnings_flow": node, "price_momentum": node},
        "thesis": {"signal": "strengthen", "hypothesis": "수주 확대", "kill_switch": ["종가 9,200 이탈"]},
        "ev_scenarios": {
            "bull": {"target_price": 13000, "probability_pct": 30, "rationale": "r", "confidence": "HIGH"},
            "base": {"target_price": 11000, "probability_pct": 50, "rationale": "r", "confidence": "MEDIUM"},
            "bear": {"target_price": 9000, "probability_pct": 20, "rationale": "r", "confidence": "LOW"},
        },
        "dart_catalysts": [
            {"rcept_no": "20261120000111", "impact_grade": "deal_funding", "stars": 4, "sentiment": 0.6,
             "interpretation": "공급계약"},
        ],
        "sepa_comment": "s", "exposure_comment": "x", "valuation_comment": "v",
        "overall_verdict": "STRONG_SETUP", "executive_summary": ["1", "2", "3"],
    }
    body.update(over)
    return SkillAnalysisResponse.model_validate(body)


def _ev(bull=(13000, 30), base=(11000, 50), bear=(9000, 20)):
    return _resp(ev_scenarios={k: {"target_price": t, "probability_pct": p, "rationale": "r", "confidence": "HIGH"}
                               for k, (t, p) in (("bull", bull), ("base", base), ("bear", bear))}).ev_scenarios


# ---------------- EV 검증 ----------------

def test_ev_weighted_recomputed_by_python():
    ev, reason = R.validate_ev(_ev(), 10000.0)
    assert reason is None
    # (13000/10000−1)×30 + (11000/10000−1)×50 + (9000/10000−1)×20 = 9 + 5 − 2 = 12
    assert ev["weighted_ev_pct"] == 12.0
    assert ev["scenarios"]["bull"]["expected_return_pct"] == 30.0
    assert ev["scenarios"]["bear"]["expected_return_pct"] == -10.0
    assert ev["normalized"] is False and ev["base_close"] == 10000.0


def test_ev_within_tolerance_not_normalized():
    ev, reason = R.validate_ev(_ev(bull=(13000, 30.5)), 10000.0)  # 합 100.5 → 허용 범위
    assert reason is None and ev["normalized"] is False
    assert ev["scenarios"]["bull"]["probability_pct"] == 30.5


def test_ev_probabilities_normalized_to_100():
    ev, reason = R.validate_ev(_ev(bull=(13000, 60), base=(11000, 100), bear=(9000, 40)), 10000.0)  # 합 200
    assert reason is None and ev["normalized"] is True and ev["prob_sum_raw"] == 200.0
    probs = [ev["scenarios"][k]["probability_pct"] for k in ("bull", "base", "bear")]
    assert probs == [30.0, 50.0, 20.0]
    assert ev["weighted_ev_pct"] == 12.0  # 정규화된 확률로 계산


@pytest.mark.parametrize("probs", [(0, 0, 0), (-10, 5, 5)])
def test_ev_rejects_non_positive_or_negative_probabilities(probs):
    ev, reason = R.validate_ev(_ev(bull=(13000, probs[0]), base=(11000, probs[1]), bear=(9000, probs[2])), 10000.0)
    assert ev is None and reason == "EV_PROB_INVALID"


@pytest.mark.parametrize("bear", [(0, 20), (-100, 20)])
def test_ev_rejects_non_positive_target(bear):
    ev, reason = R.validate_ev(_ev(bear=bear), 10000.0)
    assert ev is None and reason == "EV_TARGET_INVALID"


@pytest.mark.parametrize("close", [None, 0, -1])
def test_ev_rejects_bad_close(close):
    assert R.validate_ev(_ev(), close) == (None, "CLOSE_INVALID")


# ---------------- DART 촉매 ----------------

def test_catalysts_drop_invented_rcept_no_and_attach_link():
    items = _resp(dart_catalysts=[
        {"rcept_no": "99999999999999", "impact_grade": "regulation", "stars": 5, "sentiment": 1.0,
         "interpretation": "지어낸 공시"},
        {"rcept_no": "20261120000111", "impact_grade": "deal_funding", "stars": 4, "sentiment": 0.6,
         "interpretation": "공급계약"},
    ]).dart_catalysts
    out = R.filter_catalysts(items, R.prompt_disclosures(PREVIEW))
    assert [c["rcept_no"] for c in out] == ["20261120000111"]
    c = out[0]
    assert c["url"] == "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261120000111"
    assert c["title"] == "단일판매ㆍ공급계약체결" and c["rcept_dt"] == "20261120"  # 제목·접수일은 입력값(파이썬)


def test_catalysts_clamped_and_grade_normalized():
    items = _resp(dart_catalysts=[
        {"rcept_no": "20261120000111", "impact_grade": "MOON", "stars": 9.4, "sentiment": 3.0, "interpretation": "a"},
        {"rcept_no": "20261101000222", "impact_grade": "Deal_Funding", "stars": -2, "sentiment": -7,
         "interpretation": "b"},
        {"rcept_no": "20261101000222", "impact_grade": "tech", "stars": 3, "sentiment": 0, "interpretation": "중복"},
    ]).dart_catalysts
    out = R.filter_catalysts(items, R.prompt_disclosures(PREVIEW))
    by = {c["rcept_no"]: c for c in out}
    assert len(out) == 2  # 같은 접수번호 중복은 첫 항목만
    assert by["20261120000111"]["stars"] == 5 and by["20261120000111"]["sentiment"] == 1.0
    assert by["20261120000111"]["impact_grade"] == "general"  # 모르는 등급 → 일반
    assert by["20261101000222"]["stars"] == 1 and by["20261101000222"]["sentiment"] == -1.0
    assert by["20261101000222"]["impact_grade"] == "deal_funding"
    assert out[0]["rcept_no"] == "20261101000222"  # 임팩트 등급 순(자금조달 > 일반)


def test_dart_link_builder():
    assert R.dart_url("20261120000111") == "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261120000111"


# ---------------- 응답 전체 검증·저장 값 ----------------

def test_validate_response_rejects_bad_enums_and_empty_summary():
    assert R.validate_response(_resp(overall_verdict="BUY"), PREVIEW) == (None, "VERDICT_INVALID")
    bad_signal = _resp(thesis={"signal": "UP", "hypothesis": "h", "kill_switch": []})
    assert R.validate_response(bad_signal, PREVIEW) == (None, "SIGNAL_INVALID")
    assert R.validate_response(_resp(executive_summary=["  "]), PREVIEW) == (None, "SUMMARY_EMPTY")
    assert R.validate_response(None, PREVIEW) == (None, "NO_RESPONSE")


def test_build_report_values_uses_python_numbers_only():
    valid, reason = R.validate_response(_resp(executive_summary=["a", "b", "c", "d"]), PREVIEW)
    assert reason is None
    v = R.build_report_values(PREVIEW, valid, "gemini-test")
    assert v["ticker"] == "005930" and v["stock_name"] == "삼성전자" and str(v["as_of_date"]) == "2026-11-26"
    assert v["quant_facts"] == PREVIEW
    assert v["sepa_analysis"]["pass_count"] == 7 and v["sepa_analysis"]["comment"] == "s"
    assert v["sepa_analysis"]["stop"] == PREVIEW["stop"]
    assert v["vibe_backtest"] == PREVIEW["backtest"]
    ex = v["exposure_and_sizing"]
    assert ex["position"] == PREVIEW["position"] and ex["market_breadth"]["regime"] == "BULL"
    assert ex["comment"] == "x"
    assert v["logic_chain_and_thesis"]["thesis"]["signal"] == "STRENGTHEN"  # 대문자로 맞춤
    assert set(v["logic_chain_and_thesis"]["logic_chain"]) == {"trigger", "business", "earnings_flow",
                                                               "price_momentum"}
    assert v["ev_scenarios"]["weighted_ev_pct"] == 12.0
    kd = v["k_dart_and_valuation"]
    assert kd["dart"]["overhang"] is True and kd["comment"] == "v" and kd["peer_valuation"] == PREVIEW["peer_valuation"]
    assert v["dart_catalysts"][0]["url"].endswith("20261120000111")
    assert v["overall_verdict"] == "STRONG_SETUP"
    assert v["executive_summary"] == "a\nb\nc"  # 3줄까지
    assert v["model_name"] == "gemini-test"
    json.dumps({k: x for k, x in v.items() if k != "as_of_date"})


def test_stock_name_falls_back_to_ticker():
    valid, _ = R.validate_response(_resp(), PREVIEW)
    assert R.build_report_values({**PREVIEW, "name": None}, valid, "m")["stock_name"] == "005930"


# ---------------- 프롬프트 ----------------

def test_prompt_contains_facts_and_dart_titles_only():
    system, prompt = R.build_prompt(PREVIEW, None)
    text = (system + "\n" + prompt).lower()
    for banned in ("네이버", "naver", "뉴스", "news", "originallink", "언론사"):
        assert banned not in text, banned
    assert "단일판매ㆍ공급계약체결" in prompt and "20261120000111" in prompt and "20261120" in prompt
    assert "https://x" not in prompt  # 공시 링크·제출인은 넣지 않는다
    assert '"pass_count": 7' in prompt and '"regime": "BULL"' in prompt  # 정량 팩트 JSON
    assert "sepa_strategy" in prompt and "logic_chain" in prompt  # 스킬 루브릭(전부)


def test_prompt_only_selected_skills():
    _, prompt = R.build_prompt(PREVIEW, ["k_dart"])
    assert "(k_dart)" in prompt and "(sepa_strategy)" not in prompt


def test_prompt_without_dart():
    _, prompt = R.build_prompt({**PREVIEW, "dart": {"available": False, "items": []}}, None)
    assert "공시 없음" in prompt


# ---------------- 실행(가짜 클라이언트 1회 호출) ----------------

class FakeClient:
    model = "gemini-fake"

    def __init__(self, resp):
        self.resp = resp
        self.calls: list = []

    def generate_json(self, prompt, schema, *, system=None):
        self.calls.append((prompt, schema, system))
        return self.resp


def test_run_calls_client_once_and_returns_values():
    client = FakeClient(_resp())
    out = R.run(PREVIEW, None, client)
    assert out.ok and out.reason is None and len(client.calls) == 1
    assert client.calls[0][1] is SkillAnalysisResponse and client.calls[0][2]
    assert out.values["model_name"] == "gemini-fake"


@pytest.mark.parametrize("resp,reason", [(None, "NO_RESPONSE"), ("bad_ev", "EV_PROB_INVALID")])
def test_run_failure_reasons(resp, reason):
    if resp == "bad_ev":
        resp = _resp(ev_scenarios={k: {"target_price": 1, "probability_pct": 0, "rationale": "r", "confidence": "LOW"}
                                   for k in ("bull", "base", "bear")})
    out = R.run(PREVIEW, None, FakeClient(resp))
    assert not out.ok and out.values is None and out.reason == reason
