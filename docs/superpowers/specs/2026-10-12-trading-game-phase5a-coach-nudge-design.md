# 트레이딩 게임 Phase 5a — 데일리 스마트 코치 + 스마트 넛지 설계 스펙

> 작성일: 2026-10-12 · 상태: 승인됨
> 원 지시서: `docs/prompts/trading_game/05_phase5_coach_quest_admin.md` §1(코치), §2(넛지)
> 범위 분할: Phase 5 = **5a(코치·넛지)** + 5b(퀘스트·아카데미·야간 퀴즈·Streak). 이 문서는 5a만 다룬다.
> 선행: admin_web TypeScript(strict) 전환 완료(`2026-10-12-admin-web-typescript-migration-design.md`).

## 0. 확정된 결정

| 항목 | 결정 |
|---|---|
| 넛지 전달 | REST 응답 + WS push 둘 다(자동 청산은 WS) |
| RSI 기준 | 일봉 종가(오늘 이전) + 실시간 현재가를 오늘 종가로 붙인 **Wilder RSI(14)** |
| 임시저장 | DB에 초안 상태(`status`) 추가 |
| 게임 API 주소 | `VITE_GAME_API_URL` **선택 변수**(배포 빌드에 없으면 "게임 서버 미연결" 안내) |
| 발행 알림 | 발행 즉시 WS로 접속자 전원 push |
| 본문 에디터 | 마크다운 textarea + 미리보기(`marked` + `dompurify`) |

## 1. DB 변경 (Alembic 마이그레이션 1개)

`game_coach_messages`:
- `status VARCHAR(20) NOT NULL server_default 'PUBLISHED'` 추가. 값: `DRAFT` | `PUBLISHED`. 기존 행은 기본값으로 PUBLISHED가 된다(하위 호환).
- `published_at`을 **nullable**로 변경. 기존 `server_default now()`는 제거한다(초안은 NULL). PUBLISHED로 전환되는 시점에만 서비스가 `now()`를 기록한다.
- 유니크 `uq_coach_slot(season_id, target_date, coach_type)`는 유지한다. 한 슬롯에는 한 행만 있고, 저장은 upsert다.
- ORM(`shared/game_models.py`)도 이에 맞춰 수정한다. `published_at: Mapped[datetime | None]`, `status: Mapped[str]`.
- 검증: 일회용 로컬 docker PG에서 `alembic upgrade head` + `alembic check`(dev 터널 DB는 건드리지 않는다).

## 2. 코치 API

라우터 `apps/trading_game/routers/coach.py` → 서비스 `apps/trading_game/services/coach_service.py` → ORM. `main.py`에 라우터를 등록한다.

### 2.1 DTO (`schemas/game_dtos.py`에 추가)
```python
CoachType = Literal["MORNING", "EVENING"]   # 모델의 IN_PLAY 는 5a 범위 밖

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
    status: str                 # DRAFT | PUBLISHED
    published_at: datetime | None

class CoachTodayResponse(BaseModel):
    target_date: date           # KST 오늘
    season_id: int | None
    morning: CoachMessageResponse | None   # PUBLISHED 만
    evening: CoachMessageResponse | None   # PUBLISHED 만
    active: CoachMessageResponse | None    # evening 이 있으면 evening, 없으면 morning
```
- 지지선과 저항선이 둘 다 있으면 `support_price < resistance_price`여야 한다(아니면 422).

### 2.2 엔드포인트
| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| `PUT /api/game/admin/coach-messages` | ADMIN (`shared.auth.require_admin`) | 슬롯 upsert. `action=draft` → status DRAFT, published_at NULL. `action=publish` → status PUBLISHED, published_at=now(), 이후 WS push. 응답 `CoachMessageResponse` |
| `GET /api/game/admin/coach-messages?season_id=&target_date=` | ADMIN | 해당 날짜의 MORNING·EVENING 슬롯(초안 포함) 목록 `list[CoachMessageResponse]` |
| `GET /api/game/admin/seasons` | ADMIN | 코치 화면 시즌 셀렉트용 목록(id, name, status, ticker, start_at, end_at). 이미 동등한 엔드포인트가 있으면 그것을 재사용 |
| `GET /api/game/coach/today` | 로그인 유저 (`get_current_user`) | 2.1 `CoachTodayResponse`. 발행된 것이 없으면 200 + `morning/evening/active = null` |

- 원 지시서의 `POST`를 **`PUT`(upsert)** 로 바꾼다. 슬롯 키가 자연 키이므로 멱등 저장이 의미에 맞다.
- **발행된 슬롯에 `action=draft` → 409 `ALREADY_PUBLISHED`**. 실수로 발행이 취소되는 것을 막는다. 발행된 슬롯을 수정할 때는 `action=publish`로 다시 저장한다(published_at 갱신 + 재push).
- 존재하지 않는 `season_id` → 404.
- `/coach/today`의 "오늘"은 `Asia/Seoul` 기준 날짜다. "활성 시즌"은 Phase 3·4가 쓰는 활성 시즌 조회 규칙을 재사용한다(없으면 `season_id=null`, 나머지도 null).

### 2.3 발행 WS push
발행에 성공하고 커밋한 **후에** `connection_manager.manager.broadcast({...})`로 보낸다.
```json
{"type": "coach", "coach_type": "MORNING", "target_date": "2026-10-13",
 "title": "...", "summary_nudge": "...", "support_price": "70000.00", "resistance_price": "75000.00"}
```
- best-effort다. 예외는 로깅만 하고 삼키므로 발행 응답은 성공한다.
- 단일 워커 전제(Phase 3과 동일)이므로 인메모리 레지스트리로 충분하다.

## 3. 스마트 넛지

### 3.1 순수 규칙 엔진 `services/nudge_engine.py`
I/O가 없는 순수 함수다. 테스트가 쉽다.
```python
NudgeType = Literal["WARNING", "PRAISE", "ADVICE"]

@dataclass(frozen=True)
class Nudge:
    type: NudgeType
    code: str        # OVERBOUGHT_CHASE | PRINCIPLED_STOP | OVERLEVERAGE
    message: str

def nudges_for_open(*, side: str, ratio: float, leverage: int, rsi: float | None) -> list[Nudge]: ...
def nudges_for_close(*, closed_reason: str, roi_pct: Decimal) -> list[Nudge]: ...
```

| 코드 | 타입 | 정확한 조건 | 메시지 |
|---|---|---|---|
| `OVERBOUGHT_CHASE` | WARNING | `side == "LONG"` 그리고 `rsi is not None` 그리고 `rsi >= 80` | ⚠️ RSI 과열 구간입니다! 추격 매수는 물릴 위험이 높아요. |
| `OVERLEVERAGE` | ADVICE | `ratio == 1.0` 그리고 `leverage == 5` | 💬 과도한 레버리지는 급격한 마진콜을 유발할 수 있습니다. 분할 매수를 고려하세요. |
| `PRINCIPLED_STOP` | PRAISE | `closed_reason in {"STOP_LOSS", "MANUAL"}` 그리고 `-3 <= roi_pct <= -1` | 💡 원칙대로 손실을 잘 끊어냈습니다! 훌륭한 자금 관리 습관입니다. |

- `roi_pct`는 `GameTrade.roi_pct`다. 이 값은 **레버리지와 왕복 수수료를 반영한 % 값으로, 화면에 표시되는 그 ROI**다. 가격 변동률이 아니다.
- SHORT 진입의 과열 경고(역방향)는 만들지 않는다(지시서 범위 밖).
- 진입 한 번에 WARNING과 ADVICE가 함께 나올 수 있으므로 반환은 **리스트**다. 순서는 WARNING → ADVICE.
- `TAKE_PROFIT`·`MARGIN_CALL` 청산에는 넛지가 없다.

### 3.2 RSI 서비스 `services/rsi_service.py`
```python
async def current_rsi(redis, ticker: str, live_price: Decimal) -> float | None
def wilder_rsi(closes: Sequence[float], period: int = 14) -> float | None   # 순수 함수
```
- **Wilder RSI(14)**: 첫 14개 변화량의 단순평균으로 시드를 잡고, 이후 `avg = (prev*13 + x)/14`로 평활한다. 평균 손실이 0이면 100을 반환한다. 종가가 `period + 1`개보다 적으면 `None`.
- 종가 출처는 ClickHouse 일봉(FINAL) 중 **`date < 오늘(KST)`인 최근 100개**다. 오늘 행을 제외해야 실시간 가격과 이중 계산되지 않는다. 마지막에 `live_price`를 오늘 종가로 붙인다.
- 조회는 `apps.stock_api.services.clickhouse_source.get_candles`를 재사용한다. collector `settle_season.py`와 같은 **의도적 cross-app import**다(`Candle` GraphQL 타입 의존 때문에 shared로 옮기지 않는다). 동기 함수이므로 `asyncio.to_thread`로 호출한다. 조회 구간은 오늘에서 200일 전부터 어제까지(영업일 약 100개 이상 확보).
- 종가 조회 함수는 주입 가능하게 한다(`closes_provider` 인자, 기본값은 위 CH 조회). 테스트에서 가짜 provider를 쓰기 위함이다.
- **캐시**: Redis `game:rsi:closes:{ticker}:{YYYYMMDD}` = JSON 종가 배열, TTL 26시간. 하루 첫 주문에서만 ClickHouse를 조회한다.
- 실패(ClickHouse 다운, 데이터 부족, Redis 오류)하면 `None` → WARNING 넛지가 나가지 않는다.

### 3.3 전달 — REST
- 새 DTO `OrderResultResponse(PositionResponse)`에 `nudges: list[NudgeDTO] = []`를 추가한다. `NudgeDTO = {type, code, message}`.
- `POST /api/game/orders`와 `POST /api/game/positions/{id}/close`의 `response_model`만 `OrderResultResponse`로 바꾼다. 기존 필드는 모두 그대로 있다(추가 필드만 늘어나므로 하위 호환). `/positions/active`는 `PositionResponse`를 그대로 쓴다.
- 진입: 체결 커밋 후 `rsi_service.current_rsi`(LONG일 때만 호출) → `nudges_for_open`.
- 수동 청산: 커밋 후 `nudges_for_close(closed_reason="MANUAL", roi_pct=trade.roi_pct)`.
- **넛지 생성 전체를 try/except로 감싼다.** 예외가 나면 `nudges=[]`로 응답하고, 주문·청산 자체의 성공 응답은 바뀌지 않는다(Phase 4 랭킹 동기화와 같은 best-effort 원칙).

### 3.4 전달 — WS (자동 청산)
- `liquidation_service.check_and_liquidate`가 청산 결과와 함께 **청산 전에 조회해 둔 `user_id`** 를 돌려주도록 확장한다. 계좌의 `user_id`는 `_open_positions_for_ticker` 단계에서 `GameAccount`를 join해 함께 select한다. 청산 후 관계를 lazy-load하는 것은 금지한다(Phase 3 MissingGreenlet 함정).
  - 반환 형태 예: `list[LiquidationResult(trade: GameTrade, user_id: int)]`. 기존 호출부(`tick_listener._handle_tick`의 랭킹 동기화)도 함께 수정한다.
- `tick_listener._handle_tick`은 각 청산 결과에 대해 `nudges_for_close(trade.closed_reason, trade.roi_pct)`를 계산한다. 넛지가 있으면 **기존 fan-out 큐에 적재**하고 인라인으로 `await send_to_user` 하지 않는다. 이렇게 해야 느린 소켓이 청산 경로를 막지 않는다.
  - `fanout_worker`가 `{"type": "nudge", "position_id": "...", "nudge": {type, code, message}}`를 `manager.send_to_user(user_id, ...)`로 보낸다.
  - 큐 항목은 종류를 구분할 수 있게 확장한다(기존 틱 항목과 넛지 항목). 큐가 가득 차면 기존 정책을 따른다(드롭 + 로그).
- 넛지 계산·적재 단계 전체를 try/except로 감싼다. 예외가 나도 청산과 랭킹 동기화에는 영향이 없다.

## 4. admin_web — 데일리 코치 화면

### 4.1 설정·클라이언트
- `src/vite-env.d.ts`에 `readonly VITE_GAME_API_URL?: string`을 추가한다.
- `src/config.ts`에 **선택 변수 리더**를 추가한다. 기존 `readEnv`는 값이 없으면 throw하므로 재사용하지 않는다.
  ```ts
  // dev: 미설정 시 localhost:8003, 배포 빌드: 미설정이면 undefined(코치 화면이 "게임 서버 미연결" 안내)
  export const GAME_API_URL: string | undefined =
    import.meta.env.VITE_GAME_API_URL || (import.meta.env.DEV ? 'http://localhost:8003' : undefined)
  ```
- `vite.config.js`의 `REQUIRED`는 **바꾸지 않는다**(운영에 trading_game이 아직 없으므로 배포 빌드가 깨지면 안 된다).
- `src/api/client.ts`: `export const gameClient = GAME_API_URL ? makeClient(GAME_API_URL) : null`. 401 인터셉터를 공유한다.
- `src/api/coach.ts`: `upsertCoachMessage(body)`, `listCoachMessages(seasonId, targetDate)`, `listSeasons()`.
- `src/types/game.ts`: 2.1의 DTO와 시즌 DTO를 pydantic 기준으로 정의한다(admin_web TS 정책 준수: `any` 금지, 경계에서만 `as`). Decimal은 JSON에서 문자열로 직렬화되므로 `string | null`로 받는다.

### 4.2 화면 `src/pages/TradingGameCoach.tsx` (라우트 `/game/coach`)
- 사이드바에 그룹 "트레이딩 게임"과 항목 "📣 데일리 코치"(`/game/coach`)를 추가하고, `App.tsx`에 라우트를 등록한다.
- 폼 요소:
  - 시즌 셀렉트(기본값: ACTIVE 시즌)
  - 모닝/이브닝 라디오
  - 날짜 피커(기본값: KST 오늘)
  - 지지선/저항선 숫자 입력(원 단위, 비우면 null)
  - 한 줄 넛지 입력(200자 카운터)
  - 제목(100자)
  - **마크다운 textarea + 미리보기**: 데스크톱은 좌우 분할, 모바일 폭은 [작성]/[미리보기] 탭. 미리보기는 `DOMPurify.sanitize(marked.parse(md))`로 만든다.
- 동작:
  - 시즌, 날짜, 슬롯을 바꾸면 해당 슬롯을 불러온다. 없으면 빈 폼.
  - 상태 배지를 보여 준다(초안 / 발행됨 + 발행 시각).
  - [임시저장] → `action=draft`. 발행된 슬롯이면 **버튼 비활성화 + 안내 문구**("발행된 브리핑은 다시 발행해서 수정합니다").
  - [🚀 실시간 발행하기] → `action=publish`. 성공하면 토스트를 띄우고 상태를 갱신한다.
  - 클라이언트 검증(필수값, 지지<저항)은 토스트로 안내한다. 서버 422/409 메시지도 토스트로 보여 준다.
  - `GAME_API_URL`이 없으면 폼 대신 "게임 서버 미연결 — VITE_GAME_API_URL 설정 필요" 안내를 표시한다.
- **모든 비-submit 버튼에 `type="button"`** 을 붙인다(액션 버튼, 미리보기 탭, 라디오형 버튼). 직전 차트 모달 버그의 재발을 막기 위함이다.
- 디자인은 기존 admin 페이지의 Tailwind 패턴(카드 `rounded-xl border bg-white`, indigo 주 버튼 등)을 따른다.
- 의존성: `marked`, `dompurify`를 추가한다(둘 다 자체 타입을 동봉하는지 설치 후 확인하고, 없을 때만 `@types/*`를 추가한다).

## 5. 테스트

### 5.1 백엔드 `backend/tests/test_coach_and_nudge.py`
(원 지시서의 `test_coach_and_quiz.py`에서 퀴즈는 5b 범위이므로 파일명을 5a에 맞춰 바꿨다.)
- `nudge_engine`: 각 규칙의 경계값(RSI 79.99/80, ratio 0.5/1.0 × leverage 2/5, roi −0.99/−1/−3/−3.01, SHORT+RSI 90, TAKE_PROFIT 무넛지), 복합(WARNING+ADVICE 순서).
- `wilder_rsi`: 고정 테스트 벡터 1개 이상(손계산 또는 공개 예제 값과 소수 둘째 자리까지 일치), 전부 상승 → 100, 데이터 부족 → None.
- `rsi_service.current_rsi`: fakeredis + 가짜 종가 provider로 캐시 적중/미스, 오늘 행 제외, 실패 시 None.
- 코치 서비스·라우터(aiosqlite + 의존성 override):
  - 초안 저장 → 목록에 DRAFT, `/coach/today`에는 안 보임
  - 발행 → PUBLISHED, `published_at` 기록, `/coach/today`의 `active`
  - 발행 후 `action=draft` → 409
  - 재발행 → 덮어쓰기
  - 비ADMIN → 403
  - 지지 ≥ 저항 → 422
  - 발행된 것이 없을 때 200 + null
  - 발행 시 broadcast 호출(manager를 monkeypatch)
- 주문·청산 REST: `nudges` 필드 포함, 넛지 생성 예외 시에도 201/200 + `nudges=[]`.
- 자동 청산: `_handle_tick` 경로에서 STOP_LOSS + roi −2% → 넛지 큐 항목 적재(user_id 포함), TAKE_PROFIT → 미적재.
- 기존 101개 테스트 전부 green 유지.

### 5.2 admin_web
- `npx tsc --noEmit` + 더미 env 빌드 통과.
- 브라우저 스모크: 로컬 trading_game(8003) + auth + admin dev
  - 초안 저장 → 새로고침 후 불러오기
  - 발행 → 배지 변경
  - 발행 슬롯의 임시저장 비활성화
  - 미리보기에서 XSS 스크립트가 제거되는지
  - `VITE_GAME_API_URL` 미설정 배포 빌드에서 안내 표시(빌드 산출물 확인)

## 6. 문서
- README: trading_game 섹션에 코치 API·넛지를 추가하고, admin_web 섹션에 `VITE_GAME_API_URL`(선택)을 추가한다. 환경변수 표도 갱신한다.
- ROADMAP: 서브페이즈 5를 5a/5b로 분리 표기하고 5a 완료를 반영한다. 백로그에 **"trading_game 운영 배포 — prod compose 미포함, 운영 호스트 8003은 blog_api가 사용 중이므로 포트 재배정 필요, Cloudflare 서브도메인·KIS WS 데몬 포함"** 을 추가한다.

## 7. 범위 밖 (5b 또는 이후)
퀘스트·보상 수령, 아카데미 퀴즈와 `unlocked_leverage_5x`, 야간 차트 퀴즈(`chart_quiz_pool`), Streak(`user_streaks`), IN_PLAY 코치 타입, SHORT 과열 넛지, 유저 프론트(web_client·mobile) 코치 표시(서브페이즈 6), trading_game 운영 배포.
