# 트레이딩 게임 서브페이즈 6a — web_client 트레이딩 코어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web_client `/game`의 "시즌 준비 중" 스켈레톤을 실시간 트레이딩 화면(헤더·코치 배너·심리 바·차트·포지션 카드·주문 패널·넛지 토스트)으로 교체한다.

**Architecture:** 백엔드는 공개 `GET /api/game/seasons/active` 하나만 추가. 프론트는 `types → lib(순수 함수) → api → store(zustand) + hook(WS) → components → page` 단방향 레이어. 금액 문자열(Decimal)은 api 계층에서 number로 변환. 차트는 lightweight-charts v4(일봉 + 오늘 캔들 실시간 병합).

**Tech Stack:** FastAPI/pytest(backend), React 18 + TS strict + Vite + Tailwind + zustand v4 + axios + lightweight-charts 4.2.3(web_client)

**스펙:** `docs/superpowers/specs/2026-10-13-trading-game-phase6a-web-trading-core-design.md`

---

## 공통 규칙 (모든 태스크)

- 브랜치 `dev`. 스테이징은 명시 경로만(`git add -A`/`git add .` 금지). `.claude/`·`.serena/project.yml` 절대 스테이징 금지.
- 커밋 메시지 끝에 정확히:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 백엔드 명령은 `cd backend && uv run ...`.
- web_client 검증(프론트 태스크 공통 종료 조건):
  ```bash
  cd web_client
  npx tsc --noEmit
  VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
  ```
- TS 규칙: 명시적 `any`·`@ts-ignore` 금지. `as`는 외부 데이터 경계에서만, `!`는 근거 주석과 함께만.
- 커뮤니티 기능(게시판/댓글/알림)과 기존 파일의 동작은 바꾸지 않는다. 기존 파일 수정은 `config.ts`·`vite-env.d.ts`·`pages/GamePage.tsx`·`package.json`/lock·README·ROADMAP뿐.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `backend/apps/trading_game/routers/leaderboard.py` (수정) | `GET /api/game/seasons/active` |
| `backend/tests/test_game_web_api.py` (신규) | 위 엔드포인트 테스트 |
| `web_client/src/config.ts`, `src/vite-env.d.ts` (수정) | `GAME_API_URL`·`STOCK_API_URL` 선택 변수 |
| `web_client/src/types/game.ts` | 게임 DTO·도메인·WS 메시지 타입 |
| `web_client/src/lib/decimal.ts` | Decimal 문자열 → number |
| `web_client/src/lib/format.ts` | ₩/%/가격 포맷, KST 날짜, D-day, 손익 색 |
| `web_client/src/lib/candles.ts` | 오늘 캔들 병합 |
| `web_client/src/lib/gameWs.ts` | WS 메시지 파싱 |
| `web_client/src/lib/gameErrors.ts` | 주문 오류 → 사용자 문구 |
| `web_client/src/api/gameClient.ts`, `api/game.ts`, `api/stock.ts` | REST/GraphQL 통신 |
| `web_client/src/store/tradingGame.ts` | 게임 상태 + 액션 |
| `web_client/src/hooks/useGameWebSocket.ts` | WS 연결/재연결 |
| `web_client/src/components/game/*.tsx` | 화면 컴포넌트 7개 |
| `web_client/src/pages/GamePage.tsx` (교체) | 조립 |

---

### Task 1: 백엔드 — 활성 시즌 공개 엔드포인트

**Files:**
- Modify: `backend/apps/trading_game/routers/leaderboard.py`
- Create: `backend/tests/test_game_web_api.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_game_web_api.py`:

```python
"""트레이딩 게임 Phase 6a — 유저 웹용 공개 API 테스트."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base
from shared.game_models import GameSeason
from apps.trading_game.main import app


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def session(maker):
    async with maker() as s:
        yield s


@pytest.fixture
async def client(maker):
    async def _db():
        async with maker() as s:
            yield s

    async def _no_user():  # 공개 엔드포인트 — 인증 의존성이 호출되면 실패시키기 위함
        raise AssertionError("공개 엔드포인트가 인증을 요구함")

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _no_user
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _seed_season(db, *, status: str = "ACTIVE", number: int = 1) -> GameSeason:
    season = GameSeason(
        season_number=number, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc),
        end_at=datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc), status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def test_active_season_null_when_none(client, session):
    await _seed_season(session, status="READY")
    r = await client.get("/api/game/seasons/active")
    assert r.status_code == 200
    assert r.json() is None


async def test_active_season_returns_public_fields(client, session):
    season = await _seed_season(session)
    r = await client.get("/api/game/seasons/active")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == season.id
    assert body["season_number"] == 1
    assert body["ticker"] == "005930"
    assert body["stock_name"] == "삼성전자"
    assert body["status"] == "ACTIVE"
    assert body["start_at"].startswith("2026-10-01")
    assert body["end_at"].startswith("2026-11-01")
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_game_web_api.py -v`
Expected: FAIL (404 — 라우트 없음)

- [ ] **Step 3: 구현** — `leaderboard.py` import 수정/추가:

```python
from apps.trading_game.schemas.game_dtos import SeasonOption
from apps.trading_game.services import account_service, ranking_service
```
(기존 `from apps.trading_game.services import ranking_service` 줄을 위 두 번째 줄로 교체.)

`router = APIRouter(...)` 아래, 기존 `leaderboard` 함수 **위**에 추가:

```python
@router.get("/seasons/active", response_model=SeasonOption | None)
async def active_season(db: AsyncSession = Depends(get_db)):
    """현재 ACTIVE 시즌(공개). 없으면 null — 유저 웹/앱 게임 화면 헤더용."""
    s = await account_service.get_active_season(db)
    if s is None:
        return None
    return SeasonOption(
        id=s.id, season_number=s.season_number, ticker=s.ticker, stock_name=s.stock_name,
        status=s.status, start_at=s.start_at, end_at=s.end_at,
    )
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_game_web_api.py -v` → 2 passed
Run: `cd backend && uv run pytest -q` → 전체 통과(기존 226 + 2)

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/trading_game/routers/leaderboard.py backend/tests/test_game_web_api.py
git commit -m "feat(game): 활성 시즌 공개 조회 API — GET /api/game/seasons/active (유저 웹 헤더용)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: web_client 기반 — 설정·타입·순수 함수

**Files:**
- Modify: `web_client/package.json`, `package-lock.json`, `src/config.ts`, `src/vite-env.d.ts`
- Create: `src/types/game.ts`, `src/lib/decimal.ts`, `src/lib/format.ts`, `src/lib/candles.ts`, `src/lib/gameWs.ts`, `src/lib/gameErrors.ts`

- [ ] **Step 1: 의존성** — `cd web_client && npm install lightweight-charts@4.2.3`

- [ ] **Step 2: `src/vite-env.d.ts`** — `ImportMetaEnv`에 두 줄 추가:

```ts
  readonly VITE_GAME_API_URL?: string
  readonly VITE_STOCK_API_URL?: string
```

- [ ] **Step 3: `src/config.ts`** — 파일 **끝**에 추가(기존 내용 유지):

```ts

// trading_game(게임 8003)·stock_api(일봉 차트 GraphQL 8002) — 선택 변수.
//   dev(vite serve): 미설정 시 localhost
//   배포 빌드: 미설정이면 undefined → 게임 화면이 "준비 중"/차트 미표시로 처리(빌드는 깨지 않음).
//   운영에 trading_game 이 배포되기 전까지 vite.config.js REQUIRED 에 넣지 않는다(admin_web 과 동일 정책).
export const GAME_API_URL: string | undefined =
  import.meta.env.VITE_GAME_API_URL || (import.meta.env.DEV ? 'http://localhost:8003' : undefined)
export const STOCK_API_URL: string | undefined =
  import.meta.env.VITE_STOCK_API_URL || (import.meta.env.DEV ? 'http://localhost:8002/graphql' : undefined)
```

- [ ] **Step 4: `src/types/game.ts`**

```ts
// trading_game(8003) 계약 타입.
// 출처: backend/apps/trading_game/schemas/game_dtos.py, routers/{orders,leaderboard,coach,academy}.py,
//       services/{tick_listener,coach_service,connection_manager}.py, routers/ws_gateway.py
// pydantic v2 는 Decimal 을 JSON 문자열로 직렬화한다 → Raw* 는 문자열(Dec), 도메인 타입은 number.

export type Side = 'LONG' | 'SHORT'
export type Ratio = 0.25 | 0.5 | 1.0
export type Leverage = 1 | 2 | 5

/** Decimal 직렬화 값. 서버는 문자열을 보내지만 방어적으로 number 도 허용 */
export type Dec = string | number

/** GET /api/game/seasons/active (SeasonOption) */
export interface Season {
  id: number
  season_number: number
  ticker: string
  stock_name: string
  status: string
  start_at: string
  end_at: string | null
}

export interface RawAccount {
  season_id: number
  cash_balance: Dec
  total_asset: Dec
  current_roi: Dec
  total_trades: number
  win_trades: number
}

export interface Account {
  season_id: number
  cash_balance: number
  total_asset: number
  current_roi: number
  total_trades: number
  win_trades: number
}

export interface RawPosition {
  id: string
  side: Side
  entry_price: Dec
  size_amount: Dec
  leverage: number
  stop_loss_price: Dec | null
  take_profit_price: Dec | null
  status: string
  roi_pct: Dec | null
  pnl_amount: Dec | null
}

export interface Position {
  id: string
  side: Side
  entry_price: number
  size_amount: number
  leverage: number
  stop_loss_price: number | null
  take_profit_price: number | null
  status: string
  roi_pct: number | null
  pnl_amount: number | null
}

/** NudgeDTO — type: WARNING | PRAISE | ADVICE */
export interface Nudge {
  type: string
  code: string
  message: string
}

export interface RawOrderResult extends RawPosition {
  nudges: Nudge[]
}

export interface OrderResult {
  position: Position
  nudges: Nudge[]
}

export interface OrderRequest {
  season_id: number
  side: Side
  ratio: Ratio
  leverage: Leverage
}

/** GET /api/game/seasons/{id}/my-rank (ranking_service.my_rank — 이미 float) */
export interface MyRank {
  rank: number | null
  roi_pct: number | null
  percentile: number | null
  total: number
}

export interface RawCoachMessage {
  id: number
  season_id: number
  target_date: string
  coach_type: string
  title: string
  summary_nudge: string
  content_md: string
  support_price: Dec | null
  resistance_price: Dec | null
  status: string
  published_at: string | null
}

export interface RawCoachToday {
  target_date: string
  season_id: number | null
  morning: RawCoachMessage | null
  evening: RawCoachMessage | null
  active: RawCoachMessage | null
}

/** 화면용 코치 — REST active 또는 WS coach 메시지(content_md 없음 → null)에서 생성 */
export interface Coach {
  season_id: number
  coach_type: string
  title: string
  summary_nudge: string
  content_md: string | null
  support_price: number | null
  resistance_price: number | null
}

export interface Sentiment {
  long_pct: number
  short_pct: number
}

/** stock_api getChartData.candles (date = 'YYYY-MM-DD') */
export interface DailyCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
}

/** WS /ws/game/stream 서버→클라 메시지(파싱·정규화 후) */
export type GameWsMessage =
  | { type: 'tick'; ticker: string; price: number }
  | { type: 'position_pnl'; position_id: string; roi_pct: number; pnl_amount: number }
  | ({ type: 'sentiment' } & Sentiment)
  | { type: 'nudge'; position_id: string; nudge: Nudge }
  | { type: 'coach'; coach: Coach }
```

- [ ] **Step 5: `src/lib/decimal.ts`**

```ts
// pydantic Decimal(JSON 문자열) 또는 number → 유한 number.

/** 변환 불가(빈 문자열·NaN·Infinity·그 외 타입)면 null */
export function toNumOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 필수 숫자 필드용 — 변환 불가면 예외(조용한 NaN 표시 방지) */
export function toNum(v: unknown): number {
  const n = toNumOrNull(v)
  if (n === null) throw new Error(`숫자 변환 실패: ${String(v)}`)
  return n
}
```

- [ ] **Step 6: `src/lib/format.ts`**

```ts
// 표시용 순수 포맷 함수(원화·퍼센트·KST 날짜·D-day·손익 색).

const KRW = new Intl.NumberFormat('ko-KR')
const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3_600_000

/** 12450000.4 → '₩12,450,000' (원 단위 반올림) */
export const formatKrw = (n: number): string => `₩${KRW.format(Math.round(n))}`

/** 부호 포함 원화: +₩180,000 / -₩5,000 / ₩0 */
export const formatSignedKrw = (n: number): string => {
  const r = Math.round(n)
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${formatKrw(Math.abs(r))}`
}

/** 부호 포함 퍼센트(소수 1자리): +14.4% / -3.0% / 0.0% (반올림 후 0이면 부호 없음) */
export const formatPct = (n: number): string => {
  const r = Math.round(n * 10) / 10
  if (r === 0) return '0.0%'
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`
}

/** 가격(원 단위 콤마): 71200 → '71,200' */
export const formatPrice = (n: number): string => KRW.format(n)

/** 손익 색: 양수 빨강(up) / 음수 파랑(down) / 0·없음 기본 */
export const pnlClass = (n: number | null | undefined): string =>
  n == null || n === 0 ? 'text-ink' : n > 0 ? 'text-up' : 'text-down'

/** KST 기준 날짜 'YYYY-MM-DD' */
export function kstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 종료 시각까지 남은 일수(KST 날짜 차). end 없음 → null, 지남 → 0 */
export function daysUntil(endIso: string | null, now: Date = new Date()): number | null {
  if (!endIso) return null
  const end = Date.parse(kstDateString(new Date(endIso)))
  const today = Date.parse(kstDateString(now))
  return Math.max(0, Math.round((end - today) / DAY_MS))
}
```

- [ ] **Step 7: `src/lib/candles.ts`**

```ts
import type { DailyCandle } from '../types/game'

/**
 * 틱 가격을 마지막 일봉에 병합(원본 불변).
 * 마지막 캔들 날짜가 today 면 고가/저가/종가 갱신, 아니면(없음 포함) 오늘 캔들 신규 생성.
 */
export function mergeTick(last: DailyCandle | null, today: string, price: number): DailyCandle {
  if (last && last.date === today) {
    return { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }
  }
  return { date: today, open: price, high: price, low: price, close: price }
}
```

- [ ] **Step 8: `src/lib/gameWs.ts`**

```ts
import { toNumOrNull } from './decimal'
import type { GameWsMessage } from '../types/game'

// WS 원문(JSON 문자열) → 판별 유니온. 형식이 틀리거나 모르는 type 은 null(무시) —
// 백엔드에 새 메시지 type 이 추가돼도 기존 클라이언트가 깨지지 않게 한다.

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export function parseGameMessage(raw: string): GameWsMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(data)) return null

  switch (data.type) {
    case 'tick': {
      const ticker = str(data.ticker)
      const price = toNumOrNull(data.price)
      return ticker !== null && price !== null ? { type: 'tick', ticker, price } : null
    }
    case 'position_pnl': {
      const id = str(data.position_id)
      const roi = toNumOrNull(data.roi_pct)
      const pnl = toNumOrNull(data.pnl_amount)
      return id !== null && roi !== null && pnl !== null
        ? { type: 'position_pnl', position_id: id, roi_pct: roi, pnl_amount: pnl }
        : null
    }
    case 'sentiment': {
      const long = toNumOrNull(data.long_pct)
      const short = toNumOrNull(data.short_pct)
      return long !== null && short !== null ? { type: 'sentiment', long_pct: long, short_pct: short } : null
    }
    case 'nudge': {
      const id = str(data.position_id)
      const n = data.nudge
      if (id === null || !isObj(n)) return null
      const type = str(n.type)
      const code = str(n.code)
      const message = str(n.message)
      return type !== null && code !== null && message !== null
        ? { type: 'nudge', position_id: id, nudge: { type, code, message } }
        : null
    }
    case 'coach': {
      const seasonId = toNumOrNull(data.season_id)
      const title = str(data.title)
      const summary = str(data.summary_nudge)
      if (seasonId === null || title === null || summary === null) return null
      return {
        type: 'coach',
        coach: {
          season_id: seasonId,
          coach_type: str(data.coach_type) ?? '',
          title,
          summary_nudge: summary,
          content_md: null, // WS 페이로드에는 본문이 없다
          support_price: toNumOrNull(data.support_price),
          resistance_price: toNumOrNull(data.resistance_price),
        },
      }
    }
    default:
      return null
  }
}
```

- [ ] **Step 9: `src/lib/gameErrors.ts`**

```ts
import axios from 'axios'

// 주문/청산 실패 → 사용자 문구. 서버 409/422 detail 은 이미 한국어 문장이므로 그대로 노출.

const NETWORK = '게임 서버에 연결할 수 없어요'

export function orderErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err) || !err.response) return NETWORK
  const { status } = err.response
  const data: unknown = err.response.data
  const detail: unknown = typeof data === 'object' && data !== null && 'detail' in data ? data.detail : undefined

  if (status === 401) return '로그인이 만료되었어요. 다시 로그인해 주세요'
  if (status === 403 && typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'LEVERAGE_LOCKED') {
    return '5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요'
  }
  if ((status === 403 || status === 404 || status === 409 || status === 422) && typeof detail === 'string') {
    return detail
  }
  if (status === 422) return '주문 조건이 올바르지 않아요'
  return NETWORK
}
```

- [ ] **Step 10: 검증** — 공통 web_client 검증 명령. 기대: 통과.

- [ ] **Step 11: 경계값 점검(보고에 포함)** — 아래 기대값을 코드 읽기로 확인해 보고: `formatPct(-0.04)='0.0%'`, `formatPct(14.44)='+14.4%'`, `formatPct(-3)='-3.0%'`, `formatSignedKrw(-5000.4)='-₩5,000'`, `daysUntil(null)=null`, 과거 end → 0, `mergeTick(null,'2026-10-13',100)` → OHLC 모두 100, `parseGameMessage('{"type":"x"}')=null`, `parseGameMessage('[]')=null`, tick price `"71200"` → 71200.

- [ ] **Step 12: 커밋**

```bash
git add web_client/package.json web_client/package-lock.json web_client/src/config.ts web_client/src/vite-env.d.ts web_client/src/types/game.ts web_client/src/lib/decimal.ts web_client/src/lib/format.ts web_client/src/lib/candles.ts web_client/src/lib/gameWs.ts web_client/src/lib/gameErrors.ts
git commit -m "feat(web): 게임 기반 — lightweight-charts·게임/주식 API 선택 변수·게임 타입·순수 함수(포맷·캔들 병합·WS 파서·오류 문구)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: API 계층 — gameClient · game · stock

**Files:** Create `web_client/src/api/gameClient.ts`, `src/api/game.ts`, `src/api/stock.ts`

- [ ] **Step 1: `src/api/gameClient.ts`**

```ts
import axios from 'axios'
import { GAME_API_URL } from '../config'
import { TOKEN_KEY } from '../store/auth'

// trading_game(8003) 클라이언트. GAME_API_URL 미설정(운영 빌드)이면 null → 게임 화면이 "준비 중"으로 처리.
// 401 시 토큰을 지우지 않는다(블로그 client 와 달리) — 화면에서 재로그인 안내만.
export const gameClient = GAME_API_URL
  ? axios.create({ baseURL: GAME_API_URL, headers: { 'Content-Type': 'application/json' } })
  : null

gameClient?.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
```

- [ ] **Step 2: `src/api/game.ts`**

```ts
import type { AxiosInstance } from 'axios'
import { gameClient } from './gameClient'
import { toNum, toNumOrNull } from '../lib/decimal'
import type {
  Account, Coach, MyRank, OrderRequest, OrderResult, Position, RawAccount, RawCoachMessage,
  RawCoachToday, RawOrderResult, RawPosition, Season,
} from '../types/game'

// trading_game REST. Decimal 문자열은 여기서 number 로 변환해 UI 는 number 만 다룬다.

function client(): AxiosInstance {
  if (!gameClient) throw new Error('GAME_API_URL 미설정')
  return gameClient
}

export const toPosition = (r: RawPosition): Position => ({
  id: r.id,
  side: r.side,
  entry_price: toNum(r.entry_price),
  size_amount: toNum(r.size_amount),
  leverage: r.leverage,
  stop_loss_price: toNumOrNull(r.stop_loss_price),
  take_profit_price: toNumOrNull(r.take_profit_price),
  status: r.status,
  roi_pct: toNumOrNull(r.roi_pct),
  pnl_amount: toNumOrNull(r.pnl_amount),
})

const toAccount = (r: RawAccount): Account => ({
  season_id: r.season_id,
  cash_balance: toNum(r.cash_balance),
  total_asset: toNum(r.total_asset),
  current_roi: toNum(r.current_roi),
  total_trades: r.total_trades,
  win_trades: r.win_trades,
})

const toCoach = (m: RawCoachMessage): Coach => ({
  season_id: m.season_id,
  coach_type: m.coach_type,
  title: m.title,
  summary_nudge: m.summary_nudge,
  content_md: m.content_md,
  support_price: toNumOrNull(m.support_price),
  resistance_price: toNumOrNull(m.resistance_price),
})

const toOrderResult = (r: RawOrderResult): OrderResult => ({ position: toPosition(r), nudges: r.nudges })

/** 공개 — 활성 시즌 없으면 null */
export async function getActiveSeason(): Promise<Season | null> {
  const { data } = await client().get<Season | null>('/api/game/seasons/active')
  return data
}

export async function getMyAccount(seasonId: number): Promise<Account> {
  const { data } = await client().get<RawAccount>('/api/game/accounts/me', { params: { season_id: seasonId } })
  return toAccount(data)
}

/** 보유 포지션(서버 규칙상 최대 1개) — 없으면 null */
export async function getActivePosition(seasonId: number): Promise<Position | null> {
  const { data } = await client().get<RawPosition[]>('/api/game/positions/active', { params: { season_id: seasonId } })
  return data.length > 0 ? toPosition(data[0]) : null
}

export async function getMyRank(seasonId: number): Promise<MyRank> {
  const { data } = await client().get<MyRank>(`/api/game/seasons/${seasonId}/my-rank`)
  return data
}

/** 오늘의 코치(evening 우선 active) — 없으면 null */
export async function getTodayCoach(): Promise<Coach | null> {
  const { data } = await client().get<RawCoachToday>('/api/game/coach/today')
  return data.active ? toCoach(data.active) : null
}

/** 5배 레버리지 해금 여부(문항은 6b에서 사용) */
export async function getAcademyUnlocked(): Promise<boolean> {
  const { data } = await client().get<{ unlocked: boolean }>('/api/game/academy/quiz')
  return data.unlocked
}

export async function placeOrder(body: OrderRequest): Promise<OrderResult> {
  const { data } = await client().post<RawOrderResult>('/api/game/orders', body)
  return toOrderResult(data)
}

export async function closePosition(positionId: string): Promise<OrderResult> {
  const { data } = await client().post<RawOrderResult>(`/api/game/positions/${positionId}/close`)
  return toOrderResult(data)
}
```

- [ ] **Step 3: `src/api/stock.ts`**

```ts
import axios from 'axios'
import { STOCK_API_URL } from '../config'
import { kstDateString } from '../lib/format'
import type { DailyCandle } from '../types/game'

// stock_api GraphQL 일봉 조회(graphql-request 없이 axios POST — 신규 의존성 회피).

const QUERY = `query GameDailyCandles($symbol: String!, $startDate: String!, $endDate: String!) {
  getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate) {
    candles { date open high low close }
  }
}`

const LOOKBACK_DAYS = 180
const DAY_MS = 86_400_000

interface ChartResponse {
  data?: { getChartData: { candles: DailyCandle[] } | null } | null
  errors?: { message: string }[]
}

/** 최근 약 180일 일봉. URL 미설정·GraphQL 오류·빈 응답이면 throw(차트만 오류 표시) */
export async function getDailyCandles(ticker: string, now: Date = new Date()): Promise<DailyCandle[]> {
  if (!STOCK_API_URL) throw new Error('STOCK_API_URL 미설정')
  const variables = {
    symbol: ticker,
    startDate: kstDateString(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)),
    endDate: kstDateString(now),
  }
  const { data } = await axios.post<ChartResponse>(STOCK_API_URL, { query: QUERY, variables })
  const candles = data.data?.getChartData?.candles
  if ((data.errors && data.errors.length > 0) || !candles || candles.length === 0) {
    throw new Error('일봉 데이터 없음')
  }
  return candles
}
```

- [ ] **Step 4: 검증** — 공통 web_client 검증 명령. 기대: 통과.

- [ ] **Step 5: 커밋**

```bash
git add web_client/src/api/gameClient.ts web_client/src/api/game.ts web_client/src/api/stock.ts
git commit -m "feat(web): 게임 REST·일봉 GraphQL 클라이언트 — Decimal 문자열 → number 변환

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: 상태 — zustand 스토어 + WebSocket 훅

**Files:** Create `web_client/src/store/tradingGame.ts`, `src/hooks/useGameWebSocket.ts`

- [ ] **Step 1: `src/store/tradingGame.ts`**

```ts
import { create } from 'zustand'
import * as gameApi from '../api/game'
import { gameClient } from '../api/gameClient'
import { orderErrorMessage } from '../lib/gameErrors'
import type {
  Account, Coach, GameWsMessage, Leverage, MyRank, Nudge, Position, Ratio, Season, Sentiment, Side,
} from '../types/game'

// 트레이딩 게임 전역 상태. 공개 데이터(시즌)와 로그인 데이터(계좌·포지션·순위·코치·해금·WS 실시간)를 분리한다.

export type GameStatus = 'loading' | 'ready' | 'no-season' | 'unavailable' | 'error'

export interface GameToast {
  id: number
  kind: 'nudge' | 'error' | 'info'
  icon: string
  message: string
}

interface PrivateState {
  account: Account | null
  position: Position | null
  myRank: MyRank | null
  coach: Coach | null
  academyUnlocked: boolean
  lastPrice: number | null
  sentiment: Sentiment | null
}

interface TradingGameState extends PrivateState {
  status: GameStatus
  season: Season | null
  submitting: boolean
  closing: boolean
  toasts: GameToast[]
  loadSeason: () => Promise<void>
  loadPrivate: () => Promise<void>
  refreshTrading: () => Promise<void>
  refreshRank: () => Promise<void>
  resetPrivate: () => void
  placeOrder: (side: Side, ratio: Ratio, leverage: Leverage) => Promise<void>
  closePosition: () => Promise<void>
  applyMessage: (msg: GameWsMessage) => void
  pushToast: (t: Omit<GameToast, 'id'>) => void
  dismissToast: (id: number) => void
}

const PRIVATE_EMPTY: PrivateState = {
  account: null,
  position: null,
  myRank: null,
  coach: null,
  academyUnlocked: false,
  lastPrice: null,
  sentiment: null,
}

const NUDGE_ICON: Record<string, string> = { WARNING: '⚠️', PRAISE: '👏', ADVICE: '💡' }
let toastSeq = 0

export const useTradingGameStore = create<TradingGameState>()((set, get) => {
  const pushNudges = (nudges: Nudge[]) => {
    for (const n of nudges) get().pushToast({ kind: 'nudge', icon: NUDGE_ICON[n.type] ?? '💬', message: n.message })
  }

  /** 거래·자동청산 후 계좌/포지션/순위 재조회. 개별 실패는 무시(다음 갱신에서 회복) */
  const refreshTrading = async () => {
    const season = get().season
    if (!season) return
    const [acc, pos, rank] = await Promise.allSettled([
      gameApi.getMyAccount(season.id),
      gameApi.getActivePosition(season.id),
      gameApi.getMyRank(season.id),
    ])
    const patch: Partial<PrivateState> = {}
    if (acc.status === 'fulfilled') patch.account = acc.value
    if (pos.status === 'fulfilled') patch.position = pos.value
    if (rank.status === 'fulfilled') patch.myRank = rank.value
    set(patch)
  }

  return {
    ...PRIVATE_EMPTY,
    status: 'loading',
    season: null,
    submitting: false,
    closing: false,
    toasts: [],

    loadSeason: async () => {
      if (!gameClient) {
        set({ status: 'unavailable' })
        return
      }
      set({ status: 'loading' })
      try {
        const season = await gameApi.getActiveSeason()
        set(season ? { status: 'ready', season } : { status: 'no-season', season: null })
      } catch {
        set({ status: 'error' })
      }
    },

    loadPrivate: async () => {
      const season = get().season
      if (!season) return
      const [, coach, academy] = await Promise.allSettled([
        refreshTrading(),
        gameApi.getTodayCoach(),
        gameApi.getAcademyUnlocked(),
      ])
      const patch: Partial<PrivateState> = {}
      if (coach.status === 'fulfilled') {
        patch.coach = coach.value && coach.value.season_id === season.id ? coach.value : null
      }
      if (academy.status === 'fulfilled') patch.academyUnlocked = academy.value
      set(patch)
    },

    refreshTrading,

    refreshRank: async () => {
      const season = get().season
      if (!season) return
      try {
        set({ myRank: await gameApi.getMyRank(season.id) })
      } catch {
        // 순위 갱신 실패는 조용히 무시(다음 주기에 재시도)
      }
    },

    resetPrivate: () => set({ ...PRIVATE_EMPTY }),

    placeOrder: async (side, ratio, leverage) => {
      const { season, submitting } = get()
      if (!season || submitting) return
      set({ submitting: true })
      try {
        const result = await gameApi.placeOrder({ season_id: season.id, side, ratio, leverage })
        set({ position: result.position })
        pushNudges(result.nudges)
        await refreshTrading()
      } catch (err) {
        get().pushToast({ kind: 'error', icon: '⚠️', message: orderErrorMessage(err) })
      } finally {
        set({ submitting: false })
      }
    },

    closePosition: async () => {
      const { position, closing } = get()
      if (!position || closing) return
      set({ closing: true })
      try {
        const result = await gameApi.closePosition(position.id)
        set({ position: null })
        pushNudges(result.nudges)
        await refreshTrading()
      } catch (err) {
        get().pushToast({ kind: 'error', icon: '⚠️', message: orderErrorMessage(err) })
        void refreshTrading() // 이미 자동청산된 경우 등 — 서버 상태로 동기화
      } finally {
        set({ closing: false })
      }
    },

    applyMessage: (msg) => {
      const { season, position } = get()
      switch (msg.type) {
        case 'tick':
          if (season && msg.ticker === season.ticker) set({ lastPrice: msg.price })
          return
        case 'position_pnl':
          if (position && position.id === msg.position_id) {
            set({ position: { ...position, roi_pct: msg.roi_pct, pnl_amount: msg.pnl_amount } })
          }
          return
        case 'sentiment':
          set({ sentiment: { long_pct: msg.long_pct, short_pct: msg.short_pct } })
          return
        case 'nudge':
          pushNudges([msg.nudge])
          void refreshTrading() // 자동청산(손절/익절/마진콜) 반영
          return
        case 'coach':
          if (season && msg.coach.season_id === season.id) set({ coach: msg.coach })
          return
      }
    },

    pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastSeq }] })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})
```

- [ ] **Step 2: `src/hooks/useGameWebSocket.ts`**

```ts
import { useEffect, useRef } from 'react'
import { GAME_API_URL } from '../config'
import { parseGameMessage } from '../lib/gameWs'
import { useTradingGameStore } from '../store/tradingGame'

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const PING_MS = 25_000
const AUTH_FAILED = 4401 // 서버 ws_gateway: 토큰 무효/비활성 유저

/**
 * 게임 실시간 스트림. token 이 있고 enabled 일 때만 연결한다.
 * 끊기면 지수 백오프로 재연결, 4401 이면 재연결하지 않고 onAuthFailed 호출.
 * 재연결 성공 시 놓친 자동청산 등을 반영하려고 계좌/포지션/순위를 다시 불러온다.
 */
export function useGameWebSocket(token: string | null, enabled: boolean, onAuthFailed: () => void): void {
  const onAuthFailedRef = useRef(onAuthFailed)
  onAuthFailedRef.current = onAuthFailed

  useEffect(() => {
    if (!token || !enabled || !GAME_API_URL) return
    const url = `${GAME_API_URL.replace(/^http/, 'ws')}/ws/game/stream?token=${encodeURIComponent(token)}`
    const store = useTradingGameStore.getState
    let ws: WebSocket | null = null
    let stopped = false
    let opened = false
    let backoff = INITIAL_BACKOFF_MS
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      const sock = new WebSocket(url)
      ws = sock
      sock.onopen = () => {
        backoff = INITIAL_BACKOFF_MS
        if (opened) void store().refreshTrading()
        opened = true
        pingTimer = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send('ping')
        }, PING_MS)
      }
      sock.onmessage = (e: MessageEvent<string>) => {
        const msg = parseGameMessage(e.data)
        if (msg) store().applyMessage(msg)
      }
      sock.onclose = (e: CloseEvent) => {
        clearInterval(pingTimer)
        if (stopped) return
        if (e.code === AUTH_FAILED) {
          onAuthFailedRef.current()
          return
        }
        retryTimer = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      ws?.close()
    }
  }, [token, enabled])
}
```

- [ ] **Step 3: 검증** — 공통 web_client 검증 명령. 기대: 통과.

- [ ] **Step 4: 커밋**

```bash
git add web_client/src/store/tradingGame.ts web_client/src/hooks/useGameWebSocket.ts
git commit -m "feat(web): 트레이딩 게임 스토어·WebSocket 훅 — 주문/청산 액션, 실시간 메시지 반영, 지수 백오프 재연결(4401 중단)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 화면 컴포넌트 (차트 제외 6개)

**Files:** Create `web_client/src/components/game/{GameHeader,CoachBanner,SentimentBar,ActivePositionCard,OrderPanel,NudgeToaster}.tsx`

- [ ] **Step 1: `GameHeader.tsx`**

```tsx
import Card from '../ui/Card'
import { daysUntil, formatKrw, formatPct, pnlClass } from '../../lib/format'
import type { Account, MyRank, Season } from '../../types/game'

interface GameHeaderProps {
  season: Season
  account: Account | null
  myRank: MyRank | null
  loggedIn: boolean
}

// 시즌·종목·D-day + 내 순위/수익률 + 자본금. 랭킹·퀘스트 버튼은 6b 에서 연결(현재 비활성).
export default function GameHeader({ season, account, myRank, loggedIn }: GameHeaderProps) {
  const dday = daysUntil(season.end_at)
  const rank = myRank?.rank ?? null
  const roi = myRank?.roi_pct ?? null

  return (
    <Card className="sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-brand">
            시즌 {season.season_number}기{dday !== null && ` · 종료 D-${dday}`}
          </p>
          <h1 className="mt-0.5 text-lg font-bold text-ink">
            {season.stock_name} <span className="text-sm font-medium text-ink-muted">({season.ticker})</span>
          </h1>
        </div>
        <div className="text-right text-sm">
          {!loggedIn ? (
            <p className="text-ink-muted">로그인하고 시즌에 참여하세요</p>
          ) : rank !== null ? (
            <p className="font-semibold text-ink">
              내 순위 {rank}위
              {roi !== null && <span className={`ml-1 ${pnlClass(roi)}`}>{formatPct(roi)}</span>}
            </p>
          ) : (
            <p className="text-ink-muted">첫 거래 후 순위가 집계돼요</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          자본금
          <span className="ml-1.5 text-base font-bold text-ink tabular-nums">
            {account ? formatKrw(account.total_asset) : '—'}
          </span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            title="곧 열려요"
            className="rounded-field bg-white px-3 py-1.5 text-sm text-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            🏆 랭킹
          </button>
          <button
            type="button"
            disabled
            title="곧 열려요"
            className="rounded-field bg-white px-3 py-1.5 text-sm text-ink-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            🎯 퀘스트
          </button>
        </div>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: `CoachBanner.tsx`**

```tsx
import { useState } from 'react'
import Card from '../ui/Card'
import type { Coach } from '../../types/game'

// 오늘의 코치 한 줄 요약. 본문(content_md)이 있으면 펼쳐서 제목·본문을 텍스트로 표시(마크다운 렌더 없음).
export default function CoachBanner({ coach }: { coach: Coach | null }) {
  const [open, setOpen] = useState(false)
  if (!coach) return null
  const expandable = coach.content_md !== null && coach.content_md !== ''

  return (
    <Card className="bg-brand-soft">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className="flex w-full items-start gap-2 text-left"
      >
        <span>{coach.coach_type === 'EVENING' ? '🌙' : '🌅'}</span>
        <span className="flex-1 text-sm text-ink">
          <span className="font-semibold">오늘의 코치</span> “{coach.summary_nudge}”
        </span>
        {expandable && <span className="text-ink-muted">{open ? '▲' : '▼'}</span>}
      </button>
      {open && expandable && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="font-semibold text-ink">{coach.title}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink">{coach.content_md}</p>
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 3: `SentimentBar.tsx`**

```tsx
import type { Sentiment } from '../../types/game'

// 유저 베팅 심리(WS 5초 주기). 미수신이면 숨김, 0/0 이면 안내 문구.
export default function SentimentBar({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return null
  const empty = sentiment.long_pct === 0 && sentiment.short_pct === 0

  return (
    <div className="rounded-card bg-surface p-4">
      <p className="mb-2 text-xs font-medium text-ink-muted">📊 유저 베팅 심리</p>
      {empty ? (
        <p className="text-sm text-ink-muted">아직 포지션이 없어요</p>
      ) : (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
            <div className="bg-up transition-all" style={{ width: `${sentiment.long_pct}%` }} />
            <div className="bg-down transition-all" style={{ width: `${sentiment.short_pct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-sm font-semibold">
            <span className="text-up">🔴 Long {sentiment.long_pct}%</span>
            <span className="text-down">🔵 Short {sentiment.short_pct}%</span>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: `ActivePositionCard.tsx`**

```tsx
import Button from '../ui/Button'
import Card from '../ui/Card'
import { formatPct, formatPrice, formatSignedKrw, pnlClass } from '../../lib/format'
import type { Position } from '../../types/game'

interface ActivePositionCardProps {
  position: Position
  lastPrice: number | null
  closing: boolean
  onClose: () => void
}

// 보유 포지션 — 평가손익(₩, %)은 WS position_pnl 로 틱마다 갱신. 원클릭 전액 청산.
export default function ActivePositionCard({ position, lastPrice, closing, onClose }: ActivePositionCardProps) {
  const long = position.side === 'LONG'
  return (
    <Card className="border border-line bg-white">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold text-ink">
          <span className={long ? 'text-up' : 'text-down'}>{position.side}</span> x{position.leverage}배
        </p>
        <p className={`text-right font-bold tabular-nums transition-colors ${pnlClass(position.pnl_amount)}`}>
          {position.pnl_amount !== null ? formatSignedKrw(position.pnl_amount) : '—'}
          <span className="ml-1 text-sm">({position.roi_pct !== null ? formatPct(position.roi_pct) : '—'})</span>
        </p>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        진입가 {formatPrice(position.entry_price)}원
        {lastPrice !== null && ` (현재가 ${formatPrice(lastPrice)}원)`}
      </p>
      <Button
        type="button"
        variant="secondary"
        full
        className="mt-3"
        onClick={onClose}
        disabled={closing}
        loading={closing}
        loadingText="청산 중…"
      >
        즉시 전액 청산하기
      </Button>
    </Card>
  )
}
```

- [ ] **Step 5: `OrderPanel.tsx`**

```tsx
import { useState } from 'react'
import Card from '../ui/Card'
import { chipClass } from '../ui/Chip'
import type { Leverage, Ratio, Side } from '../../types/game'

const RATIOS: { value: Ratio; label: string }[] = [
  { value: 0.25, label: '25%' },
  { value: 0.5, label: '50%' },
  { value: 1.0, label: '100%' },
]
const LEVERAGES: Leverage[] = [1, 2, 5]

interface OrderPanelProps {
  hasPosition: boolean
  academyUnlocked: boolean
  submitting: boolean
  onOrder: (side: Side, ratio: Ratio, leverage: Leverage) => void
  onLockedLeverage: () => void
}

// 원클릭 주문 — 비중·배율 칩 + BUY(상승=빨강)/SELL(하락=파랑). 5x 는 아카데미 미해금 시 잠금.
export default function OrderPanel({ hasPosition, academyUnlocked, submitting, onOrder, onLockedLeverage }: OrderPanelProps) {
  const [ratio, setRatio] = useState<Ratio>(0.25)
  const [leverage, setLeverage] = useState<Leverage>(1)
  const disabled = hasPosition || submitting

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">비중</span>
          {RATIOS.map((r) => (
            <button
              key={r.label}
              type="button"
              aria-pressed={ratio === r.value}
              onClick={() => setRatio(r.value)}
              className={chipClass(ratio === r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">배율</span>
          {LEVERAGES.map((l) => {
            const locked = l === 5 && !academyUnlocked
            return (
              <button
                key={l}
                type="button"
                aria-pressed={leverage === l}
                onClick={() => (locked ? onLockedLeverage() : setLeverage(l))}
                className={chipClass(leverage === l)}
              >
                {l}x{locked && ' 🔒'}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOrder('LONG', ratio, leverage)}
          className="h-14 rounded-btn bg-up text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔴 BUY <span className="text-sm font-medium">(상승 베팅)</span>
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOrder('SHORT', ratio, leverage)}
          className="h-14 rounded-btn bg-down text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          🔵 SELL <span className="text-sm font-medium">(하락 베팅)</span>
        </button>
      </div>
      {hasPosition && <p className="mt-2 text-center text-xs text-ink-muted">보유 포지션을 먼저 청산하세요</p>}
    </Card>
  )
}
```

- [ ] **Step 6: `NudgeToaster.tsx`**

```tsx
import { useEffect } from 'react'
import { useTradingGameStore, type GameToast } from '../../store/tradingGame'

const TTL_MS = 5_000

// 게임 넛지/오류 토스트 — 상단 중앙(커뮤니티 알림 토스트는 우하단이라 겹치지 않음). 각 5초 후 자동 닫힘.
function ToastItem({ toast }: { toast: GameToast }) {
  const dismiss = useTradingGameStore((s) => s.dismissToast)
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), TTL_MS)
    return () => clearTimeout(t)
  }, [toast.id, dismiss])

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-card border bg-white px-4 py-3 shadow-lg ${
        toast.kind === 'error' ? 'border-up/40' : 'border-line'
      }`}
    >
      <span className="mt-0.5 text-lg">{toast.icon}</span>
      <p className="flex-1 text-sm text-ink">{toast.message}</p>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="shrink-0 text-ink-muted hover:text-ink"
        aria-label="닫기"
      >
        ✕
      </button>
    </div>
  )
}

export default function NudgeToaster() {
  const toasts = useTradingGameStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-40 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
```

- [ ] **Step 7: 검증** — 공통 web_client 검증 명령. 기대: 통과.

- [ ] **Step 8: 커밋**

```bash
git add web_client/src/components/game/GameHeader.tsx web_client/src/components/game/CoachBanner.tsx web_client/src/components/game/SentimentBar.tsx web_client/src/components/game/ActivePositionCard.tsx web_client/src/components/game/OrderPanel.tsx web_client/src/components/game/NudgeToaster.tsx
git commit -m "feat(web): 게임 화면 컴포넌트 — 헤더·코치 배너·심리 바·포지션 카드·주문 패널(5x 잠금)·넛지 토스트

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 실시간 차트 (`TradingChart.tsx`)

**Files:** Create `web_client/src/components/game/TradingChart.tsx`

- [ ] **Step 1: 구현**

```tsx
import { useEffect, useRef, useState } from 'react'
import {
  CrosshairMode, LineStyle, createChart, type IPriceLine, type ISeriesApi,
} from 'lightweight-charts'
import { getDailyCandles } from '../../api/stock'
import { mergeTick } from '../../lib/candles'
import { kstDateString } from '../../lib/format'
import type { Coach, DailyCandle, Position } from '../../types/game'

// 일봉(stock_api) + 오늘 캔들 실시간 병합(WS tick) + 지지/저항/진입가 라인.
// 색: 상승=빨강/하락=파랑(국내 관례, Tailwind up/down 토큰과 동일).
const UP = '#f04452'
const DOWN = '#3182f6'
const SUPPORT = '#8b5cf6'
const RESIST = '#f59e0b'

interface TradingChartProps {
  ticker: string
  lastPrice: number | null
  coach: Coach | null
  position: Position | null
}

const toBar = (c: DailyCandle) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close })

export default function TradingChart({ ticker, lastPrice, coach, position }: TradingChartProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const lastCandleRef = useRef<DailyCandle | null>(null)
  const linesRef = useRef<IPriceLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // 1) 차트 생성 + 일봉 로드(종목 바뀌면 재생성)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b95a1' },
      grid: { vertLines: { color: '#f2f4f6' }, horzLines: { color: '#f2f4f6' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#e5e8eb' },
      timeScale: { borderColor: '#e5e8eb' },
      localization: { priceFormatter: (p: number) => Math.round(p).toLocaleString('ko-KR') },
    })
    const series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    })
    seriesRef.current = series
    setLoaded(false)
    setFailed(false)

    let cancelled = false
    getDailyCandles(ticker)
      .then((candles) => {
        if (cancelled) return
        series.setData(candles.map(toBar))
        lastCandleRef.current = candles[candles.length - 1] ?? null
        chart.timeScale().fitContent()
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      seriesRef.current = null
      linesRef.current = []
      lastCandleRef.current = null
      chart.remove()
    }
  }, [ticker])

  // 2) 틱 → 오늘 캔들 병합
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !loaded || lastPrice === null) return
    const next = mergeTick(lastCandleRef.current, kstDateString(), lastPrice)
    lastCandleRef.current = next
    series.update(toBar(next))
  }, [lastPrice, loaded])

  // 3) 가격선(지지/저항/진입가) — 값이 바뀔 때만 재생성(손익 틱마다 재생성하지 않도록 원시값 의존)
  const support = coach?.support_price ?? null
  const resistance = coach?.resistance_price ?? null
  const entry = position?.entry_price ?? null
  const side = position?.side ?? null
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !loaded) return
    for (const l of linesRef.current) series.removePriceLine(l)
    const lines: IPriceLine[] = []
    if (support !== null) {
      lines.push(series.createPriceLine({
        price: support, color: SUPPORT, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '지지',
      }))
    }
    if (resistance !== null) {
      lines.push(series.createPriceLine({
        price: resistance, color: RESIST, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '저항',
      }))
    }
    if (entry !== null && side !== null) {
      lines.push(series.createPriceLine({
        price: entry, color: side === 'LONG' ? UP : DOWN, lineWidth: 2, lineStyle: LineStyle.Solid,
        axisLabelVisible: true, title: '진입',
      }))
    }
    linesRef.current = lines
  }, [support, resistance, entry, side, loaded])

  return (
    <div className="relative h-[260px] overflow-hidden rounded-card border border-line bg-white sm:h-[320px]">
      <div ref={boxRef} className="h-full w-full" />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-ink-muted">
          차트 데이터를 불러오지 못했어요
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 검증** — 공통 web_client 검증 명령. 기대: 통과. (`time: c.date`는 v4 `Time`이 `'YYYY-MM-DD'` 문자열을 허용 — 타입 에러가 나면 `import type { Time }` 후 `time: c.date as Time` 경계 단언으로 바꾸고 보고.)

- [ ] **Step 3: 커밋**

```bash
git add web_client/src/components/game/TradingChart.tsx
git commit -m "feat(web): 실시간 캔들 차트 — 일봉+오늘 캔들 틱 병합, 지지/저항/진입가 라인(lightweight-charts)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: 게임 페이지 조립

**Files:** Replace `web_client/src/pages/GamePage.tsx`

- [ ] **Step 1: `GamePage.tsx` 전체 교체**

```tsx
import { useEffect, useState } from 'react'
import LoginModal from '../components/LoginModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ActivePositionCard from '../components/game/ActivePositionCard'
import CoachBanner from '../components/game/CoachBanner'
import GameHeader from '../components/game/GameHeader'
import NudgeToaster from '../components/game/NudgeToaster'
import OrderPanel from '../components/game/OrderPanel'
import SentimentBar from '../components/game/SentimentBar'
import TradingChart from '../components/game/TradingChart'
import { useGameWebSocket } from '../hooks/useGameWebSocket'
import { useAuthStore } from '../store/auth'
import { useTradingGameStore } from '../store/tradingGame'
import type { Leverage, Ratio, Side } from '../types/game'

const RANK_POLL_MS = 30_000

// 실시간 트레이딩 게임 — 상태별 분기: 서버 미설정/시즌 없음 → 준비 중, 연결 실패 → 재시도, 정상 → 트레이딩 화면
export default function GamePage() {
  const token = useAuthStore((s) => s.token)
  const loggedIn = token !== null
  const {
    status, season, account, position, myRank, coach, academyUnlocked, lastPrice, sentiment,
    submitting, closing, loadSeason, loadPrivate, resetPrivate, refreshRank, placeOrder, closePosition, pushToast,
  } = useTradingGameStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const ready = status === 'ready'

  useEffect(() => {
    loadSeason()
  }, [loadSeason])

  // 로그인 상태가 바뀌면 개인 데이터 로드/초기화
  useEffect(() => {
    if (!ready) return
    if (loggedIn) loadPrivate()
    else resetPrivate()
  }, [ready, loggedIn, loadPrivate, resetPrivate])

  // 보유 중 실시간 ROI 로 순위가 움직이므로 주기적으로 갱신
  useEffect(() => {
    if (!ready || !loggedIn) return
    const t = setInterval(() => refreshRank(), RANK_POLL_MS)
    return () => clearInterval(t)
  }, [ready, loggedIn, refreshRank])

  useGameWebSocket(token, ready, () =>
    pushToast({ kind: 'error', icon: '🔑', message: '로그인이 만료되었어요. 다시 로그인해 주세요' }),
  )

  if (status === 'unavailable' || status === 'no-season') {
    return (
      <EmptyState
        emoji="🎮"
        title="시즌을 준비하고 있어요"
        description="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
      />
    )
  }
  if (status === 'error') {
    return (
      <EmptyState
        emoji="🔌"
        title="게임 서버에 연결할 수 없어요"
        description="잠시 후 다시 시도해 주세요."
        action={<Button onClick={() => loadSeason()}>다시 시도</Button>}
      />
    )
  }
  if (!ready || !season) return <p className="py-16 text-center text-ink-muted">불러오는 중…</p>

  const handleOrder = (side: Side, ratio: Ratio, leverage: Leverage) => {
    if (!loggedIn) {
      setLoginOpen(true)
      return
    }
    placeOrder(side, ratio, leverage)
  }

  return (
    <div className="space-y-4">
      <GameHeader season={season} account={account} myRank={myRank} loggedIn={loggedIn} />
      <CoachBanner coach={coach} />
      {loggedIn ? (
        <SentimentBar sentiment={sentiment} />
      ) : (
        <p className="rounded-card bg-surface p-4 text-sm text-ink-muted">로그인하면 실시간 시세와 주문이 열려요</p>
      )}
      <TradingChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />
      {position && (
        <ActivePositionCard position={position} lastPrice={lastPrice} closing={closing} onClose={() => closePosition()} />
      )}
      <OrderPanel
        hasPosition={position !== null}
        academyUnlocked={academyUnlocked}
        submitting={submitting}
        onOrder={handleOrder}
        onLockedLeverage={() =>
          pushToast({ kind: 'info', icon: '🔒', message: '5배 레버리지는 아카데미 퀴즈를 통과하면 열려요 (곧 오픈)' })
        }
      />
      <NudgeToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 2: 검증** — 공통 web_client 검증 명령 + 번들 점검:

```bash
cd web_client
grep -l "localhost:800" dist/assets/*.js || echo "OK: localhost 없음"
```
기대: 빌드 통과, `OK: localhost 없음`.

- [ ] **Step 3: 커밋**

```bash
git add web_client/src/pages/GamePage.tsx
git commit -m "feat(web): 게임 페이지 — 스켈레톤을 실시간 트레이딩 화면으로 교체(상태별 분기·로그인 연동·순위 30초 갱신)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 8: 문서 + 브라우저 스모크 (컨트롤러 수행)

**Files:** Modify `README.md`(web_client 섹션·환경변수 표), `docs/ROADMAP.md`(Phase 5 서브페이즈 6 항목·백로그)

- [ ] **Step 1: README** — `### 4. 일반 유저 웹 (web_client)` 섹션의 TS 안내 2줄 다음에 추가:

```markdown
- **게임 탭(`/game`)** 은 trading_game(8003)·stock_api(8002, 일봉 차트)를 호출한다. 실시간 화면을 보려면 auth(8001)·blog(8000)와 함께 두 서비스도 띄운다. `VITE_GAME_API_URL`·`VITE_STOCK_API_URL`은 **선택** 변수 — dev 미설정 시 `http://localhost:8003`·`http://localhost:8002/graphql`, 배포 빌드 미설정이면 게임 탭은 "시즌을 준비하고 있어요"(빌드는 실패하지 않음). trading_game 운영 배포 전까지 필수 목록에 넣지 않는다.
```

환경변수 표(`VITE_AUTH_BASE_URL | web_client` 행 아래)에 두 행 추가:

```markdown
| `VITE_GAME_API_URL` | web_client (선택) | `http://localhost:8003` | 트레이딩 게임 API·WS(미설정 배포 빌드 → 게임 탭 준비 중) |
| `VITE_STOCK_API_URL` | web_client (선택) | `http://localhost:8002/graphql` | 게임 차트 일봉(GraphQL) |
```

- [ ] **Step 2: ROADMAP** — Phase 5의 `- [ ] **서브페이즈 6** — ...` 줄을 다음으로 교체:

```markdown
- [ ] **서브페이즈 6** — 프론트(web_client·mobile) 실시간 트레이딩 화면. 6a/6b/6c 분할
  - [x] **6a** web 트레이딩 코어(헤더·코치 배너·심리 바·일봉+실시간 차트·주문/포지션·넛지) + `GET /api/game/seasons/active` (2026-10-13)
  - [ ] **6b** web 모달 — 랭킹/명예의전당(MBTI)·퀘스트·아카데미(5x 해금)·야간 퀴즈·Streak
  - [ ] **6c** 모바일(Expo) 동일 기능
```

상시 백로그에 추가:

```markdown
- [ ] 지인 리그(Private League) — 백엔드(리그 생성·초대코드·리그 랭킹) + UI. 서브페이즈 6 범위에서 제외
```

- [ ] **Step 3: 커밋**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: README·ROADMAP — 트레이딩 게임 6a(web 트레이딩 코어) 반영·서브페이즈 6 분할·지인 리그 백로그

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

- [ ] **Step 4: 브라우저 스모크(컨트롤러)** — 스펙 §7.4 체크리스트.
  - DB: 로컬 docker PG에 스모크 전용 DB 생성 → `alembic upgrade head`(dev 터널 15432 금지). Redis는 로컬 docker(전용 DB 번호).
  - 서비스: auth(8001)·blog(8000)·stock_api(8002)·trading_game(8003, `TRADING_WINDOWS=00:00-23:59`로 거래 창 확장) + `web_client npm run dev`(3000). 모두 스모크 DB/Redis를 바라보게 env 오버라이드.
  - 시즌 시드(ACTIVE, ticker 005930 — ClickHouse 일봉이 없으면 stock_api 온더플라이 시드 캔들로 표시됨).
  - 시세: `SET stock:latest:005930 '{"price":71200,"ts":<now>}'` + `PUBLISH stock:tick:005930 '{"ticker":"005930","price":71200,"timestamp":"..."}'`를 몇 초 간격 반복.
  - 끝나면 서비스 종료, 스모크 DB drop·Redis DB flush.
