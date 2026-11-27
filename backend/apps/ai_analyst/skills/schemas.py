"""AI Lab B단계 — Gemini 구조화 응답 스키마(해석 전용).

원칙
- 숫자는 파이썬이 계산한다. Gemini 가 내는 숫자는 시나리오 목표가·확률, 촉매 별점·감성 점수뿐이고
  손절가·피벗·주식 수·리스크%·기대수익률은 스키마에 아예 없다(낼 수 없으니 버릴 숫자도 없다).
- 기존 apps/ai_analyst/schemas.py 와 같은 이유로 Literal·dict·Any·ge/le 를 쓰지 않는다 — google-genai 의
  enum/anyOf 변환을 믿지 않고, 허용값은 Field description 으로 알린다. 범위·허용값 검사는 skill_runner 의
  순수 검증 함수가 맡는다(여기서 예외를 던지면 generate_json 이 사유 없이 None 을 돌려준다).
- 구조는 리스트 대신 이름 있는 필드로 고정한다(인과 사슬 4노드, 시나리오 3개).
설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 3절
"""
from __future__ import annotations

from pydantic import BaseModel, Field

SIGNALS = ("STRENGTHEN", "MAINTAIN", "WEAKEN", "FALSIFY")
VERDICTS = ("STRONG_SETUP", "WATCH_PULLBACK", "HOLD_WAIT", "AVOID_RISK")
IMPACT_GRADES = ("regulation", "deal_funding", "tech", "earnings", "general")  # 앞쪽이 영향 큼
CONFIDENCES = ("HIGH", "MEDIUM", "LOW")


class ChainNode(BaseModel):
    title: str = Field(description="노드 제목(짧게)")
    evidence: str = Field(description="근거 — 주어진 정량 팩트 키나 DART 공시(접수번호)를 인용한 1~2문장")


class LogicChain(BaseModel):
    trigger: ChainNode = Field(description="① 공시·업황·정책 트리거")
    business: ChainNode = Field(description="② 사업·수주·수요 변화")
    earnings_flow: ChainNode = Field(description="③ 영업이익·수급 반영")
    price_momentum: ChainNode = Field(description="④ 주가 모멘텀·피벗 돌파")


class Thesis(BaseModel):
    signal: str = Field(description="STRENGTHEN | MAINTAIN | WEAKEN | FALSIFY 중 하나")
    hypothesis: str = Field(description="투자 가설 한 줄")
    kill_switch: list[str] = Field(description="가설 기각 조건 목록(관찰 가능한 조건, 2~4개)")


class Scenario(BaseModel):
    target_price: float = Field(description="목표 주가(원). 정량 팩트의 종가·손절가·업종 비교에 근거")
    probability_pct: float = Field(description="확률(%). bull·base·bear 합이 100")
    rationale: str = Field(description="근거 1~2문장")
    confidence: str = Field(description="HIGH | MEDIUM | LOW 중 하나")


class EvScenarios(BaseModel):
    bull: Scenario
    base: Scenario
    bear: Scenario


class DartCatalyst(BaseModel):
    rcept_no: str = Field(description="입력 DART 목록에 있는 접수번호 그대로(없는 공시를 만들지 말 것)")
    impact_grade: str = Field(description="regulation | deal_funding | tech | earnings | general 중 하나 "
                                          "(규제·정책 > 수주·M&A·자금조달 > 기술·특허 > 실적·업황 > 일반)")
    stars: float = Field(description="영향 별점 1~5(정수)")  # 소수가 와도 스키마 검증이 통째로 실패하지 않게 float — 파이썬이 반올림·자름
    sentiment: float = Field(description="감성 점수 -1.0(악재) ~ +1.0(호재)")
    interpretation: str = Field(description="한 줄 해석(공시 제목만으로, 금액·규모 추정 금지)")


class SkillAnalysisResponse(BaseModel):
    """Gemini 응답 전체. 숫자 재계산·거부 판단은 skill_runner.validate_response."""

    logic_chain: LogicChain
    thesis: Thesis
    ev_scenarios: EvScenarios
    dart_catalysts: list[DartCatalyst] = Field(description="입력 공시 중 의미 있는 것 최대 5개, 없으면 빈 목록")
    sepa_comment: str = Field(description="SEPA 8조건·추세 단계 해석 1~2문장")
    exposure_comment: str = Field(description="시장 폭 레짐·포지션 크기 해석 1~2문장")
    valuation_comment: str = Field(description="업종 상대가치·실적 추세·공시 오버행 해석 1~2문장")
    overall_verdict: str = Field(description="STRONG_SETUP | WATCH_PULLBACK | HOLD_WAIT | AVOID_RISK 중 하나")
    executive_summary: list[str] = Field(description="핵심 투자 메모 3줄")
