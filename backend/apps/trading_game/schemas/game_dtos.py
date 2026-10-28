"""트레이딩 게임 REST/WS DTO."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


# 주문 비중 선택지 — 칩(25/50/100%) + 드롭다운(10~90%). 그 외 값은 422.
OrderRatio = Literal[0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0]


class OrderRequest(BaseModel):
    season_id: int
    side: Literal["LONG", "SHORT"]
    ratio: OrderRatio
    leverage: Literal[1, 2, 5]
    # 진입가 대비 '주가' 변동 분수(0.05=5%) — 레버리지 반영 수익률 아님(pricing.tp_sl_prices)
    stop_loss_pct: float | None = Field(default=None, gt=0, le=1)
    take_profit_pct: float | None = Field(default=None, gt=0, le=1)


class PositionResponse(BaseModel):
    id: str
    side: str
    entry_price: Decimal
    size_amount: Decimal
    leverage: int
    stop_loss_price: Decimal | None
    take_profit_price: Decimal | None
    status: str
    roi_pct: Decimal | None = None
    pnl_amount: Decimal | None = None


class NudgeDTO(BaseModel):
    type: str      # WARNING | PRAISE | ADVICE
    code: str
    message: str


class ClosePositionRequest(BaseModel):
    """수동 청산 본문(선택). 본문이 없으면 all(옛 앱 호환).

    all=전량, half=원금 절반, principal=지금 원금만큼 회수(남은 평가금 = 수익금). 부분은 수익 상태에서만.
    """
    portion: Literal["all", "half", "principal"] = "all"


class OrderResultResponse(PositionResponse):
    """진입/수동청산 응답 — PositionResponse + 교육 넛지(Phase 5a). /positions/active 는 미사용.

    청산 응답이면 realized_pnl(이번 청산 실현손익)·returned_amount(현금으로 돌아온 금액)를 채운다(진입은 None).
    부분 청산이면 status=OPEN, size_amount=남은 원금, roi_pct/pnl_amount=남은 포지션 평가.
    """
    nudges: list[NudgeDTO] = Field(default_factory=list)
    realized_pnl: Decimal | None = None
    returned_amount: Decimal | None = None


class AccountResponse(BaseModel):
    season_id: int
    cash_balance: Decimal
    total_asset: Decimal
    current_roi: Decimal
    total_trades: int
    win_trades: int


# ---------------------------------------------------------------- Phase 5a: coach
CoachType = Literal["MORNING", "EVENING"]  # 모델의 IN_PLAY 는 5a 범위 밖


class CoachUpsertRequest(BaseModel):
    season_id: int
    target_date: date
    coach_type: CoachType
    title: str = Field(min_length=1, max_length=100)
    summary_nudge: str = Field(min_length=1, max_length=200)
    support_price: Decimal | None = Field(default=None, gt=0)
    resistance_price: Decimal | None = Field(default=None, gt=0)
    content_md: str = Field(min_length=1)
    action: Literal["draft", "publish"]

    @model_validator(mode="after")
    def _support_below_resistance(self) -> "CoachUpsertRequest":
        if (
            self.support_price is not None
            and self.resistance_price is not None
            and self.support_price >= self.resistance_price
        ):
            raise ValueError("지지선은 저항선보다 낮아야 합니다.")
        return self


class CoachMessageResponse(BaseModel):
    id: int
    season_id: int
    target_date: date
    coach_type: str
    title: str
    summary_nudge: str
    content_md: str
    support_price: Decimal | None
    resistance_price: Decimal | None
    status: str
    published_at: datetime | None


class CoachTodayResponse(BaseModel):
    target_date: date
    season_id: int | None
    morning: CoachMessageResponse | None
    evening: CoachMessageResponse | None
    active: CoachMessageResponse | None


class CoachLevelSuggestion(BaseModel):
    price: int
    touches: int
    basis: str


class CoachLevelsResponse(BaseModel):
    """지지·저항 추천값 — admin 폼 채우기용(저장·발행 안 함)."""
    ticker: str
    basis_end: date  # 이 날짜까지의 일봉으로 계산(MORNING=전날, EVENING=당일)
    bars: int
    last_close: int
    support: CoachLevelSuggestion | None
    resistance: CoachLevelSuggestion | None


class SeasonOption(BaseModel):
    id: int
    season_number: int
    ticker: str
    stock_name: str
    status: str
    start_at: datetime
    end_at: datetime | None
    period: str = "month"  # month|quarter — 분기 시즌이면 클라이언트가 월간 랭킹 탭을 연다


class GameFeatures(BaseModel):
    """관리자 기능 on/off(게임 설정) — 꺼진 기능은 웹·앱이 버튼·배너를 숨긴다."""

    quiz: bool = True
    streak: bool = True


class ActiveSeason(SeasonOption):
    """공개 활성 시즌(헤더용) + 기능 on/off. 관리자 시즌 목록(SeasonOption)과 분리."""

    features: GameFeatures = GameFeatures()


# ---------------------------------------------------------------- Phase 5b
class FeatureFlagResponse(BaseModel):
    key: str
    enabled: bool
    updated_at: datetime | None


class FeatureFlagUpdate(BaseModel):
    enabled: bool


class StreakRewardDTO(BaseModel):
    """연속 출석 마일스톤 보상(백로그 ⑤-1). amount 는 코드 상수 정수(원)."""

    milestone: int
    amount: int
    claimed: bool
    claimable: bool


class StreakResponse(BaseModel):
    current_streak: int
    highest_streak: int
    last_activity_date: date | None
    enabled: bool
    # 플래그 꺼짐·활성 시즌 없음이면 빈 배열
    rewards: list[StreakRewardDTO] = Field(default_factory=list)


class StreakRewardClaimResponse(BaseModel):
    streak: StreakResponse
    cash_balance: Decimal  # 지급 후 잔고


class QuestResponse(BaseModel):
    code: str
    title: str
    description: str
    target: int
    progress: int
    reward_cash: Decimal | None
    reward_badge: str | None
    completed: bool
    claimed: bool


class BadgeDTO(BaseModel):
    code: str
    name: str
    awarded_at: datetime | None


class QuestListResponse(BaseModel):
    quests: list[QuestResponse]
    badges: list[BadgeDTO]


class QuestClaimResponse(BaseModel):
    quest: QuestResponse
    cash_balance: Decimal | None  # 현금 보상일 때 지급 후 잔고
    badge: BadgeDTO | None


class AcademyQuestionDTO(BaseModel):
    id: int
    question: str
    choices: list[str]


class AcademyQuizResponse(BaseModel):
    unlocked: bool
    questions: list[AcademyQuestionDTO]


class AcademySubmitRequest(BaseModel):
    answers: dict[int, int]  # 문항 id → 선택 인덱스(0-based)


class AcademyResultItem(BaseModel):
    id: int
    correct: bool
    answer: int
    explanation: str


class AcademySubmitResponse(BaseModel):
    unlocked: bool
    results: list[AcademyResultItem]


class QuizQuestionResponse(BaseModel):
    """출제 — 정답 검색 방지를 위해 종목·날짜 은닉, 가격은 첫 종가=100 정규화."""
    id: int
    chart_snapshot: list[dict]
    time_limit_sec: int
    horizon_bars: int = 5  # B3-1 — "N거래일 뒤" 의 N
    quiz_type: str = "DIRECTION"  # B3-2 — DIRECTION | RANGE | PATTERN
    choices: list["QuizChoiceDTO"] | None = None  # 4지선다 보기(출제 순서). DIRECTION 은 None(오를까/내릴까)


class QuizChoiceDTO(BaseModel):
    code: str
    label: str


class QuizSubmitRequest(BaseModel):
    # DIRECTION 은 UP/DOWN, 4지선다는 그 문제 choices 의 code — 서버가 문제별로 검증(INVALID_CHOICE 422)
    choice: str = Field(min_length=1, max_length=20)


class QuizSubmitResponse(BaseModel):
    correct: bool
    answer: str
    actual_change: Decimal
    pattern_type: str
    explanation: str
    rewarded: bool
    reward_cash: int
    timed_out: bool
    ticker: str  # 제출 후 공개
    base_date: date
    streak: StreakResponse | None
    # B2 — 기준일 다음 5봉(문제 차트와 같은 정규화, 날짜 없음). 이전 생성분은 None
    future_snapshot: list[dict] | None = None
    # B2 — 패턴 기대 방향과 실제 결과를 잇는 한 줄. 알 수 없는 패턴이면 None
    outcome: str | None = None
    horizon_bars: int = 5  # B3-1
    quiz_type: str = "DIRECTION"  # B3-2
    answer_label: str | None = None  # B3-2 — 정답 보기 문구(DIRECTION 은 상승/하락)


# ---------------------------------------------------------------- 관리자 퀴즈·아카데미 편집(백로그 ⑤-2)
ChoiceText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
QuestionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
ExplanationText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
PatternText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]


class AcademyQuestionUpsert(BaseModel):
    """관리자 아카데미 문항 생성·수정(PUT 전체 교체)."""

    question: QuestionText
    choices: list[ChoiceText] = Field(min_length=2, max_length=6)
    answer: int = Field(ge=0)
    explanation: ExplanationText
    sort_order: int = Field(default=0, ge=0, le=10000)
    is_active: bool = True

    @model_validator(mode="after")
    def _answer_in_range(self) -> "AcademyQuestionUpsert":
        if self.answer >= len(self.choices):
            raise ValueError("answer 는 선택지 범위(0-based) 안이어야 합니다.")
        return self


class AcademyQuestionAdminDTO(BaseModel):
    id: int
    question: str
    choices: list[str]
    answer: int
    explanation: str
    sort_order: int
    is_active: bool
    created_at: datetime | None
    updated_at: datetime | None


class QuizAdminItem(BaseModel):
    id: int
    ticker: str
    base_date: date
    pattern_type: str
    answer: str
    actual_change: Decimal
    is_active: bool
    attempt_count: int
    created_at: datetime | None
    window_bars: int = 60  # B3-1
    horizon_bars: int = 5
    quiz_type: str = "DIRECTION"  # B3-2
    answer_label: str = ""  # 정답 코드의 보기 문구


class QuizAdminListResponse(BaseModel):
    items: list[QuizAdminItem]
    total: int
    page: int
    size: int


class QuizAdminDetail(QuizAdminItem):
    """원본 chart_snapshot(날짜 포함, 기준일까지 window_bars봉)·정답·해설."""

    explanation: str
    reward_cash: int
    chart_snapshot: list[dict]
    future_snapshot: list[dict] | None = None  # 원본 이후 horizon_bars봉(날짜 포함). B2 이전 생성분은 None


class QuizAdminUpdate(BaseModel):
    """수정 허용 필드만(차트·정답·등락률 불변). 그 외 필드는 422."""

    model_config = ConfigDict(extra="forbid")

    pattern_type: PatternText | None = None
    explanation: ExplanationText | None = None
    is_active: bool | None = None


QuizType = Literal["DIRECTION", "RANGE", "PATTERN"]


class QuizGenerateRequest(BaseModel):
    count: int = Field(ge=1, le=200)
    types: list[QuizType] | None = Field(default=None, min_length=1)  # None = 기본 비율(B3-2)


class QuizGenerateResponse(BaseModel):
    created: int
    skipped: int  # (ticker, base_date) 중복으로 건너뜀


class QuizCreateRequest(BaseModel):
    """직접 출제 — 종목 일봉(ClickHouse)에서 기준일까지 60봉·이후 5거래일로 정답·등락률·해설 자동 계산."""

    ticker: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
    base_date: date
