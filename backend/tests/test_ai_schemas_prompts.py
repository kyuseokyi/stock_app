"""AI 시황 스키마(허용값·Gemini 호환) + 프롬프트 빌더(자르기·필수 내용)."""
import typing
from dataclasses import dataclass

import pytest
from pydantic import BaseModel, ValidationError

from apps.ai_analyst import prompts as p
from apps.ai_analyst import schemas as s

GEMINI_MODELS = [s.MoverReasonItem, s.MoverReasonsResponse, s.HotKeyword, s.HotKeywordsResponse, s.SectorItem,
                 s.MorningBriefingResponse, s.InvestorFlowComment, s.ScreenerQualitativeResponse]


def _walk(tp, seen):
    """타입 안의 dict/Any 를 찾는다(list[...]·Optional·중첩 BaseModel 재귀)."""
    if tp is typing.Any or tp is dict or typing.get_origin(tp) is dict:
        return [tp]
    if isinstance(tp, type) and issubclass(tp, BaseModel):
        if tp in seen:
            return []
        seen.add(tp)
        bad = []
        for f in tp.model_fields.values():
            bad += _walk(f.annotation, seen)
        return bad
    bad = []
    for a in typing.get_args(tp):
        bad += _walk(a, seen)
    return bad


@pytest.mark.parametrize("model", GEMINI_MODELS)
def test_gemini_models_have_no_dict_or_any(model):
    assert _walk(model, set()) == []


def _qual(**kw):
    base = dict(ticker="005930", hook_summary="신고가 돌파", growth_quality="본업성장",
                financial_quality_note="영업이익 증가", red_flag_level="CLEAN", red_flags=[])
    return s.ScreenerQualitativeResponse(**{**base, **kw})


def test_screener_qualitative_allowed_values():
    assert _qual().growth_quality == "본업성장"
    assert _qual(red_flag_level=" warning ").red_flag_level == "WARNING"
    with pytest.raises(ValidationError):
        _qual(growth_quality="회계착시")
    with pytest.raises(ValidationError):
        _qual(red_flag_level="RED")


def test_mover_item_category_not_validated_and_optional_warning():
    m = s.MoverReasonItem(ticker="1", stock_name="a", change_rate=29.9, reason_summary="r",
                          category="기타", reliability="상")
    assert m.risk_warning is None
    assert s.MoverReasonsResponse.model_validate_json('{"items": []}').items == []


def test_morning_briefing_sector_items():
    b = s.MorningBriefingResponse(headline="h", us_market_summary="u", kr_impact_summary="k",
                                  bullish_sectors=[{"sector": "반도체", "reason": "r"}], bearish_sectors=[],
                                  macro_checkpoints=["CPI"])
    assert b.model_dump()["bullish_sectors"] == [{"sector": "반도체", "reason": "r"}]


def test_api_response_defaults():
    assert s.MarketMoversResponse().model_dump() == {"updated_at": None, "gainers": [], "losers": [], "keywords": []}
    r = s.InvestorFlowResponse()
    assert r.foreign_top == [] and r.double_buy == [] and r.ai_comment is None
    assert s.Mover(ticker="1", stock_name="a", change_rate=1.0).reason_summary is None


# --- 프롬프트 ----------------------------------------------------------------- #
@dataclass(frozen=True)
class _News:
    title: str
    description: str


def test_system_prompt_rules():
    assert "추측" in p.SYSTEM_PROMPT and "한국어" in p.SYSTEM_PROMPT
    assert "단순수급" in p.SYSTEM_PROMPT and '"하"' in p.SYSTEM_PROMPT


def test_movers_prompt_limits_news_and_cuts_description():
    long = "가" * 300
    news = [_News(f"제목{i}", long) for i in range(8)]
    text = p.movers_prompt([{"ticker": "000001", "name": "알파", "change_rate": 29.87}],
                           [{"ticker": "000002", "name": "베타", "change_rate": -12.3}],
                           {"000001": news})
    assert "000001 알파" in text and "+29.87%" in text and "-12.30%" in text
    assert "제목4" in text and "제목5" not in text  # 최대 5건
    assert "가" * p.DESC_MAX not in text and "…" in text  # 120자로 자름
    assert "(관련 뉴스 없음)" in text  # 베타는 뉴스 없음


def test_news_accepts_dicts():
    text = p.hot_keywords_prompt([{"ticker": "1", "stock_name": "a", "change_rate": 3}],
                                 [{"title": "AI반도체 급등", "description": "설명"}])
    assert "AI반도체 급등 — 설명" in text and "1 a +3.00%" in text


def test_morning_brief_prompt():
    text = p.morning_brief_prompt([{"name": "S&P500", "close": 5000.123, "change_rate": 1.2}],
                                  [{"name": "미국10년물", "value": 4.25}], None)
    assert "S&P500: 5,000.12 (+1.20%)" in text and "미국10년물: 4.25" in text
    assert "미국 증시 관련 뉴스" not in text
    assert "미국 증시 관련 뉴스" in p.morning_brief_prompt([], [], [])


def test_investor_flow_prompt_amounts_in_eok():
    text = p.investor_flow_prompt([{"ticker": "005930", "name": "삼성전자", "net_amount": 123_000_000_000}],
                                  [], [], [{"ticker": "005930", "name": "삼성전자", "foreign_amount": 1e10,
                                            "institution_amount": 5e9}], {"005930": "반도체"})
    assert "삼성전자(005930) · 반도체: +1,230억" in text
    assert "외국인 +100억, 기관 +50억" in text
    assert text.count("(데이터 없음)") == 2


def test_stock_qualitative_prompt():
    text = p.stock_qualitative_prompt("123456", "테스트", {"C": "EPS +40%"},
                                      [{"report_nm": "전환사채권발행결정", "rcept_dt": "20261020"}],
                                      ["CB 발행"], [])
    assert "테스트(123456)" in text and "C: EPS +40%" in text and "20261020 전환사채권발행결정" in text
    assert "- CB 발행" in text and "ticker 는 123456" in text
    empty = p.stock_qualitative_prompt("1", "a", None, None, None, None)
    assert "(최근 공시 없음)" in empty and "(관련 뉴스 없음)" in empty
