"""AI 시황 분석 Pydantic 스키마 — Gemini 구조화 응답용 + stock_api 응답용.

스펙 §4.3 기준. 단 Gemini response_schema 는 dict/Any 필드를 다루지 못하므로
섹터 목록은 `List[dict]` 대신 `SectorItem(sector, reason)` 으로 평평하게 둔다.
허용값 제한은 Literal(enum) 대신 str + validator — google-genai 의 enum/anyOf 변환을 믿지 않고,
허용값은 Field description 으로 모델에 알린다.
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

GROWTH_QUALITIES = ("본업성장", "일회성이익", "불확실")
RED_FLAG_LEVELS = ("CLEAN", "WARNING", "DANGER")


# --- Gemini 응답용 ------------------------------------------------------------ #
class MoverReasonItem(BaseModel):
    """급등·급락 종목 1개의 원인 분석. category·reliability 는 검증하지 않는다 —
    20종목 묶음 응답에서 한 항목만 어긋나도 전체가 버려지지 않게."""

    ticker: str
    stock_name: str
    change_rate: float
    reason_summary: str = Field(description="급등 또는 급락의 핵심 원인 1문장 (30자 내외)")
    category: str = Field(description="수주계약 | 실적호조 | 테마수급 | 경영권 | 유상증자/악재 | 단순수급")
    reliability: str = Field(description="상 | 중 | 하 (뉴스 실체 여부)")
    risk_warning: str | None = Field(None, description="단기 추격매수 시 주의점")


class MoverReasonsResponse(BaseModel):
    """급등·급락 종목을 한 번에 묶어 보낸 요청의 응답."""

    items: list[MoverReasonItem]


class HotKeyword(BaseModel):
    keyword: str = Field(description="오늘 시장의 핫 키워드(테마·이슈) 한 단어 또는 짧은 구")
    background: str = Field(description="키워드가 떠오른 배경 1문장")
    tickers: list[str] = Field(description="관련 종목 코드(6자리) 목록")


class HotKeywordsResponse(BaseModel):
    keywords: list[HotKeyword]


class SectorItem(BaseModel):
    sector: str = Field(description="섹터·업종 이름")
    reason: str = Field(description="수혜 또는 주의 이유 1문장")


class MorningBriefingResponse(BaseModel):
    headline: str = Field(description="브리핑 핵심 헤드라인 1줄")
    us_market_summary: str = Field(description="뉴욕증시 마감 요약")
    kr_impact_summary: str = Field(description="오늘 한국 증시에 미칠 영향")
    bullish_sectors: list[SectorItem]
    bearish_sectors: list[SectorItem]
    macro_checkpoints: list[str] = Field(description="오늘 확인할 거시경제 체크포인트")


class InvestorFlowComment(BaseModel):
    comment: str = Field(description="오늘 외국인·기관 수급 흐름 해설 2줄")


class ScreenerQualitativeResponse(BaseModel):
    ticker: str
    hook_summary: str = Field(description="이 종목이 포착된 사유 1줄")
    growth_quality: str = Field(description="본업성장 | 일회성이익 | 불확실")
    financial_quality_note: str = Field(description="실적 품질 판단 근거(공시·재무 기반)")
    red_flag_level: str = Field(description="CLEAN | WARNING | DANGER")
    red_flags: list[str] = Field(description="감지된 리스크(CB/BW 전환물량, 대주주 매도 등)")

    @field_validator("growth_quality")
    @classmethod
    def _check_growth(cls, v: str) -> str:
        v = v.strip()
        if v not in GROWTH_QUALITIES:
            raise ValueError(f"growth_quality 는 {GROWTH_QUALITIES} 중 하나여야 함: {v!r}")
        return v

    @field_validator("red_flag_level")
    @classmethod
    def _check_level(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in RED_FLAG_LEVELS:
            raise ValueError(f"red_flag_level 은 {RED_FLAG_LEVELS} 중 하나여야 함: {v!r}")
        return v


# --- API 응답용 --------------------------------------------------------------- #
class Mover(BaseModel):
    """급등락 종목 — AI 원인이 없으면 원인 필드는 None."""

    ticker: str
    stock_name: str
    price: float | None = None
    change_rate: float
    reason_summary: str | None = None
    category: str | None = None
    reliability: str | None = None
    risk_warning: str | None = None


class MarketMoversResponse(BaseModel):
    updated_at: str | None = None
    gainers: list[Mover] = []
    losers: list[Mover] = []
    keywords: list[HotKeyword] = []


class FlowItem(BaseModel):
    ticker: str
    name: str
    net_amount: float  # 원


class DoubleBuyItem(BaseModel):
    ticker: str
    name: str
    foreign_amount: float  # 원
    institution_amount: float  # 원


class InvestorFlowResponse(BaseModel):
    date: str | None = None
    source: str | None = None  # "pykrx" | "kis"
    foreign_top: list[FlowItem] = []
    institution_top: list[FlowItem] = []
    pension_top: list[FlowItem] = []
    double_buy: list[DoubleBuyItem] = []
    ai_comment: str | None = None
    updated_at: str | None = None
