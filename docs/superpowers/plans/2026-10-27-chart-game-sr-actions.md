# 차트 게임 지지·저항 표시와 손절·익절·홀딩 대응(A+B) 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬 — superpowers:subagent-driven-development(추천) 또는 superpowers:executing-plans 로 작업 단위로 실행한다. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** 게임 차트(웹·앱)에 가까운 지지·저항 4개를 라벨로 보여 주고, 청산 버튼을 손익에 따라 익절/손절로 바꾸며, 화면을 보는 중 가격이 그 선에 닿으면 [익절·손절] vs [✊ 홀딩] 대응 시트를 띄운다.

**구조:** 지지·저항 고르기·감지·버튼 문구는 I/O 없는 순수 함수(앱 `features/game/lib`, 웹 `src/lib`, 같은 규칙)로 만들고 앱 jest 로 검증한다. 차트는 고른 목록으로 가격선을 그리고 목록을 부모(게임 화면)에 올리며, 게임 화면이 감지기(`SrWatcher`)를 돌려 시트를 띄운다. 서버는 요청 형식을 바꾸지 않고 체결 가격으로 청산 사유(`MANUAL_TP`/`MANUAL_SL`)를 정한다.

**기술:** FastAPI·pytest(백엔드), React Native(Expo)·jest·react-native-webview + lightweight-charts 4.2.3(앱), React·Vite·lightweight-charts 4.2.3(웹)

**설계 문서:** `docs/superpowers/specs/2026-10-27-chart-game-sr-actions-design.md`

**설계와 달라진 점(계획 작성 중 코드 확인으로 정함)**
- 앱 차트 페이지는 실선·점선(dashed)만 지원하므로 지지·저항 선은 웹·앱 모두 **점선(dashed)** 으로 그린다(설계의 dotted 대신).
- 앱 `ChartLine.title` 은 이미 범례 이름으로 쓰이므로, 가격축 라벨은 새 선택 필드 **`axisTitle`** 로 넘긴다(설계 4.2 의 `title?` 대신). 지지·저항 선은 범례에 넣지 않는다(축 라벨이 이름 역할).
- 웹은 테스트 도구가 없으므로 웹 순수 함수는 앱 함수와 **같은 코드**(세미콜론만 다름)로 옮기고 타입 검사·빌드로 확인한다.

**브랜치**
- 작업 1(백엔드): `git switch -c feature/game-manual-close-reason dev` → 끝나면 dev 에 `--no-ff` 머지.
- 작업 2~13(화면): `git switch -c ui/game-sr-actions dev` → 끝나면 dev 에 `--no-ff` 머지(제목에 `[UI]`).
- `git add` 는 파일을 지정한다(`-A`/`.` 금지). 커밋 끝에 아래 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```

**파일 지도**

| 파일 | 책임 |
|---|---|
| `backend/apps/trading_game/services/pricing.py` | `manual_close_reason` — 수동 청산 사유 순수 함수 |
| `backend/apps/trading_game/routers/orders.py` | 청산 API 가 위 함수로 사유 결정 |
| `backend/apps/trading_game/services/nudge_engine.py` | 칭찬 넛지 대상 사유 확장 |
| `mobile/src/features/game/lib/krx-tick.ts` | KRX 호가 단위·반올림 |
| `mobile/src/features/game/lib/close-action.ts` | 손익 → 버튼 종류·문구 |
| `mobile/src/features/game/lib/sr-levels.ts` | 후보 만들기·지지·저항 고르기·이름·라벨·서명 |
| `mobile/src/features/game/lib/sr-watch.ts` | 터치·돌파·이탈 감지 상태 기계, 시트 문구 |
| `mobile/src/features/game/lib/chart-bridge.ts` | `ChartLine.axisTitle`, `PageEvent` 의 `poc` |
| `mobile/src/features/game/chart-web/page/chart-page-script.ts` (+생성 파일) | POC 점·`poc` 메시지·축 라벨 |
| `mobile/src/features/game/components/tv-chart.tsx` | `onPoc` 전달 |
| `mobile/src/features/game/components/candle-chart.tsx` | 지지·저항 선 그리기, `onSrLevels` |
| `mobile/src/ui/button.tsx` | `labelColor` 선택 prop |
| `mobile/src/features/game/components/position-card.tsx` | 손익 버튼 |
| `mobile/src/features/game/components/sr-action-sheet.tsx` | 대응 시트(새 파일) |
| `mobile/src/app/(tabs)/game.tsx` | 감지기 실행·시트 열기·홀딩 토스트 |
| `web_client/src/lib/krxTick.ts`, `closeAction.ts`, `srLevels.ts`, `srWatch.ts` | 앱과 같은 순수 함수(새 파일) |
| `web_client/src/lib/volumeProfile.ts` | `pocPrice`, POC 점, `onPocChange` |
| `web_client/src/components/game/TradingChart.tsx` | 지지·저항 선, `onSrLevels` |
| `web_client/src/components/game/ActivePositionCard.tsx` | 손익 버튼 |
| `web_client/src/components/game/SrActionModal.tsx` | 대응 모달(새 파일) |
| `web_client/src/pages/GamePage.tsx` | 감지기 실행·모달 열기·홀딩 토스트 |

---

### 작업 1: 백엔드 — 수동 청산 사유를 체결 가격으로 결정

**파일:**
- 수정: `backend/apps/trading_game/services/pricing.py` (끝에 함수 추가)
- 수정: `backend/apps/trading_game/routers/orders.py:236-249`
- 수정: `backend/apps/trading_game/services/nudge_engine.py:17`
- 테스트: `backend/tests/test_order_engine.py`, `backend/tests/test_coach_and_nudge.py`

- [ ] **1-1: 브랜치 만들기**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git switch -c feature/game-manual-close-reason dev
```

- [ ] **1-2: 실패하는 순수 함수 테스트 작성** — `backend/tests/test_order_engine.py` 의 `test_liquidation_none_when_untriggered` 함수 바로 뒤에 추가

```python
@pytest.mark.parametrize("side, entry, exit_, expected", [
    ("LONG", "100", "101", "MANUAL_TP"),
    ("LONG", "100", "99", "MANUAL_SL"),
    ("LONG", "100", "100", "MANUAL_SL"),   # 본전은 손절로 본다
    ("SHORT", "100", "99", "MANUAL_TP"),
    ("SHORT", "100", "101", "MANUAL_SL"),
    ("SHORT", "100", "100", "MANUAL_SL"),
])
def test_manual_close_reason(side, entry, exit_, expected):
    assert pricing.manual_close_reason(side, Decimal(entry), Decimal(exit_)) == expected


def test_manual_close_reason_rejects_bad_side():
    with pytest.raises(ValueError):
        pricing.manual_close_reason("UP", Decimal("100"), Decimal("101"))
```

- [ ] **1-3: 실패 확인**

```bash
cd backend && uv run pytest tests/test_order_engine.py -k manual_close_reason -q
```
예상: `AttributeError: module ... has no attribute 'manual_close_reason'` 로 FAIL.

- [ ] **1-4: 구현** — `backend/apps/trading_game/services/pricing.py` 맨 끝에 추가

```python


def manual_close_reason(side: str, entry: Decimal, exit_price: Decimal) -> str:
    """수동 청산 사유 — 가격이 유리한 쪽으로 움직였으면 MANUAL_TP, 아니면(본전 포함) MANUAL_SL.

    수수료 때문에 아주 작은 이익이 손실 ROI 가 될 수 있지만, 사용자가 본 '가격 방향'과 맞춘다.
    """
    if side == "LONG":
        return "MANUAL_TP" if exit_price > entry else "MANUAL_SL"
    if side == "SHORT":
        return "MANUAL_TP" if exit_price < entry else "MANUAL_SL"
    raise ValueError(f"side must be LONG or SHORT, got {side!r}")
```

- [ ] **1-5: 통과 확인**

```bash
cd backend && uv run pytest tests/test_order_engine.py -k manual_close_reason -q
```
예상: 7 passed.

- [ ] **1-6: 실패하는 API 테스트 작성** — `backend/tests/test_coach_and_nudge.py`

파일 위 import 에 추가(기존 import 줄 옆):
```python
import uuid

from sqlalchemy import select
```
그리고 `from shared.game_models import GameCoachMessage, GameSeason, UserAcademy` 를 아래로 바꾼다.
```python
from shared.game_models import GameCoachMessage, GameSeason, GameTrade, UserAcademy
```
`test_manual_close_praise_nudge` 함수 바로 뒤에 추가:
```python
@pytest.mark.parametrize("exit_price, expected", [
    (Decimal("98.5"), "MANUAL_SL"),
    (Decimal("101.5"), "MANUAL_TP"),
])
async def test_manual_close_reason_by_price_direction(api, maker, order_env, exit_price, expected):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_player(db))
    r = await client.post("/api/game/orders", json={
        "season_id": season.id, "side": "LONG", "ratio": 0.25, "leverage": 1,
    })
    assert r.status_code == 201, r.text
    pos_id = r.json()["id"]
    order_env["v"] = exit_price
    r = await client.post(f"/api/game/positions/{pos_id}/close")
    assert r.status_code == 200, r.text
    async with maker() as db:
        trade = (await db.execute(
            select(GameTrade).where(GameTrade.position_id == uuid.UUID(pos_id))
        )).scalar_one()
    assert trade.closed_reason == expected
```
그리고 넛지 표 테스트 `test_close_principled_stop` 의 parametrize 목록에 두 줄을 추가한다(`("MANUAL", Decimal("-2.5"), ["PRINCIPLED_STOP"]),` 바로 아래).
```python
    ("MANUAL_SL", Decimal("-2"), ["PRINCIPLED_STOP"]),
    ("MANUAL_TP", Decimal("-2"), ["PRINCIPLED_STOP"]),
```

- [ ] **1-7: 실패 확인**

```bash
cd backend && uv run pytest tests/test_coach_and_nudge.py -k "manual_close_reason_by_price or principled_stop" -q
```
예상: `manual_close_reason_by_price_direction` 2개가 `'MANUAL' == 'MANUAL_SL'` 류로 FAIL, `MANUAL_SL`·`MANUAL_TP` 넛지 2개 FAIL.

- [ ] **1-8: 구현** — `backend/apps/trading_game/routers/orders.py` 의 `close_order` 에서

```python
    trade = await order_engine.close_position(
        db, position_id=pos.id, exit_price=exit_price, reason="MANUAL"
    )
```
를
```python
    # 수동 청산 사유는 체결 가격 방향으로 서버가 정한다(요청 형식 그대로 — 옛 앱 호환·화면이 조작 불가)
    reason = pricing.manual_close_reason(pos.side, pos.entry_price, exit_price)
    trade = await order_engine.close_position(
        db, position_id=pos.id, exit_price=exit_price, reason=reason
    )
```
로, 같은 함수 마지막 줄
```python
    return OrderResultResponse(**dto.model_dump(), nudges=_close_nudges("MANUAL", trade.roi_pct))
```
를
```python
    return OrderResultResponse(**dto.model_dump(), nudges=_close_nudges(reason, trade.roi_pct))
```
로 바꾼다. 파일 위 import 에 `pricing` 이 없으면 기존 서비스 import 줄(`from apps.trading_game.services import ...`)에 `pricing` 을 추가한다.

`backend/apps/trading_game/services/nudge_engine.py:17` 을
```python
_PRAISE_REASONS = frozenset({"STOP_LOSS", "MANUAL", "MANUAL_SL", "MANUAL_TP"})  # MANUAL = 2026-10 이전 기록
```
로 바꾼다.

- [ ] **1-9: 통과 + 회귀 확인**

```bash
cd backend && uv run pytest tests/test_order_engine.py tests/test_coach_and_nudge.py tests/test_ranking_and_settlement.py tests/test_weekly_ranking.py tests/test_order_messages.py -q
```
예상: 전부 PASS.

- [ ] **1-10: 커밋하고 dev 에 머지**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/apps/trading_game/services/pricing.py backend/apps/trading_game/routers/orders.py backend/apps/trading_game/services/nudge_engine.py backend/tests/test_order_engine.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): 수동 청산 사유를 체결 가격으로 MANUAL_TP/MANUAL_SL 구분

- 요청 형식 그대로(옛 앱 호환), 서버가 가격 방향으로 판정 — 본전은 SL
- 칭찬 넛지 대상에 MANUAL_SL·MANUAL_TP 추가(옛 MANUAL 유지)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
git switch dev
git merge --no-ff feature/game-manual-close-reason -m "Merge feature/game-manual-close-reason: 수동 청산 사유 익절·손절 구분"
git branch -d feature/game-manual-close-reason
git switch -c ui/game-sr-actions dev
```

---

### 작업 2: 앱 — 호가 단위와 손익 버튼 순수 함수

**파일:**
- 생성: `mobile/src/features/game/lib/krx-tick.ts`, `mobile/src/features/game/lib/close-action.ts`
- 테스트: `mobile/src/features/game/lib/krx-tick.test.ts`, `mobile/src/features/game/lib/close-action.test.ts`

- [ ] **2-1: 실패하는 테스트 작성**

`mobile/src/features/game/lib/krx-tick.test.ts`
```ts
import { krxTick, roundToTick } from './krx-tick';

describe('krxTick', () => {
  test.each([
    [1_999, 1],
    [2_000, 5],
    [4_999, 5],
    [5_000, 10],
    [19_999, 10],
    [20_000, 50],
    [49_999, 50],
    [50_000, 100],
    [199_999, 100],
    [200_000, 500],
    [499_999, 500],
    [500_000, 1_000],
  ])('%d원 → 호가 %d원', (price, tick) => {
    expect(krxTick(price)).toBe(tick);
  });
});

describe('roundToTick', () => {
  test('가까운 호가로 반올림', () => {
    expect(roundToTick(71_249)).toBe(71_200);
    expect(roundToTick(71_250)).toBe(71_300);
    expect(roundToTick(1_234.4)).toBe(1_234);
  });
});
```

`mobile/src/features/game/lib/close-action.test.ts`
```ts
import { closeActionOf } from './close-action';

describe('closeActionOf', () => {
  test('이익(0 포함)은 익절', () => {
    expect(closeActionOf(12_000)).toEqual({ kind: 'tp', label: '💰 익절하기' });
    expect(closeActionOf(0)).toEqual({ kind: 'tp', label: '💰 익절하기' });
  });
  test('손실은 손절', () => {
    expect(closeActionOf(-1)).toEqual({ kind: 'sl', label: '🛡️ 손절하기' });
  });
  test('손익 모름(틱 전)은 중립', () => {
    expect(closeActionOf(null)).toEqual({ kind: 'neutral', label: '청산하기' });
  });
});
```

- [ ] **2-2: 실패 확인**

```bash
cd mobile && npx jest src/features/game/lib/krx-tick.test.ts src/features/game/lib/close-action.test.ts
```
예상: `Cannot find module './krx-tick'` 등으로 FAIL.

- [ ] **2-3: 구현**

`mobile/src/features/game/lib/krx-tick.ts`
```ts
// KRX 호가 단위(2023-01 KOSPI·KOSDAQ 통합) — 백엔드 apps/trading_game/services/sr_levels.krx_tick 과 같은 표.
// 웹 web_client/src/lib/krxTick.ts 와 같은 코드.
const TABLE: readonly (readonly [number, number])[] = [
  [2_000, 1],
  [5_000, 5],
  [20_000, 10],
  [50_000, 50],
  [200_000, 100],
  [500_000, 500],
];

/** 가격의 호가 단위(원) */
export function krxTick(price: number): number {
  for (const [limit, tick] of TABLE) if (price < limit) return tick;
  return 1_000;
}

/** 가장 가까운 호가로 반올림 */
export function roundToTick(price: number): number {
  const tick = krxTick(price);
  return Math.floor(price / tick + 0.5) * tick;
}
```

`mobile/src/features/game/lib/close-action.ts`
```ts
// 청산 버튼 문구 — 평가손익이 0 이상이면 익절, 음수면 손절(설계 2026-10-27 §6.1).
// 사유 기록은 서버가 체결 가격으로 정한다(이 함수는 화면 표시만). 웹 web_client/src/lib/closeAction.ts 와 같은 코드.
export type CloseKind = 'tp' | 'sl' | 'neutral';

export interface CloseAction {
  kind: CloseKind;
  label: string;
}

export function closeActionOf(pnl: number | null): CloseAction {
  if (pnl === null) return { kind: 'neutral', label: '청산하기' };
  return pnl >= 0 ? { kind: 'tp', label: '💰 익절하기' } : { kind: 'sl', label: '🛡️ 손절하기' };
}
```

- [ ] **2-4: 통과 확인**

```bash
cd mobile && npx jest src/features/game/lib/krx-tick.test.ts src/features/game/lib/close-action.test.ts
```
예상: PASS(16 tests).

- [ ] **2-5: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/features/game/lib/krx-tick.ts mobile/src/features/game/lib/krx-tick.test.ts mobile/src/features/game/lib/close-action.ts mobile/src/features/game/lib/close-action.test.ts
git commit -m "feat(mobile): 호가 단위·손익 청산 버튼 문구 순수 함수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 3: 앱 — 지지·저항 고르기 순수 함수

**파일:**
- 생성: `mobile/src/features/game/lib/sr-levels.ts`
- 테스트: `mobile/src/features/game/lib/sr-levels.test.ts`

- [ ] **3-1: 실패하는 테스트 작성** — `mobile/src/features/game/lib/sr-levels.test.ts`

```ts
import {
  BB_LINE_COLOR,
  pickSrLevels,
  POC_RESIST_COLOR,
  POC_SUPPORT_COLOR,
  srAxisTitle,
  srCandidates,
  srName,
  srSignature,
  type SrCandidate,
  type SrLevel,
} from './sr-levels';

const MA = [5, 20, 60] as const;
const COLORS = ['#a', '#b', '#c'] as const;
const c = (key: SrCandidate['key'], price: number): SrCandidate => ({ key, price, color: '#x' });

describe('pickSrLevels', () => {
  test('현재가 위로 가까운 저항 2개, 아래로 가까운 지지 2개', () => {
    const got = pickSrLevels(
      [c('ma5', 101), c('ma20', 103), c('ma60', 99), c('bbUpper', 110), c('bbLower', 90), c('poc', 98)],
      100,
    );
    expect(got.map((l) => [l.key, l.role])).toEqual([
      ['ma5', 'resistance'],
      ['ma20', 'resistance'],
      ['ma60', 'support'],
      ['poc', 'support'],
    ]);
  });
  test('현재가와 같은 값은 저항', () => {
    expect(pickSrLevels([c('ma5', 100)], 100)[0].role).toBe('resistance');
  });
  test('같은 가격은 앞 순서(ma5→…→poc) 하나만', () => {
    const got = pickSrLevels([c('poc', 105), c('ma20', 105)], 100);
    expect(got.map((l) => l.key)).toEqual(['ma20']);
  });
  test('NaN·0 이하는 버림', () => {
    expect(pickSrLevels([c('ma5', Number.NaN), c('ma20', 0), c('ma60', -1)], 100)).toEqual([]);
  });
});

describe('srCandidates', () => {
  const values = { ma5: 101, ma20: 102, ma60: 103, bbUpper: 110, bbLower: 90 };
  test('켜진 지표만', () => {
    const got = srCandidates({ values, ma: false, bb: true, poc: null, maColors: COLORS }, 100);
    expect(got.map((x) => x.key)).toEqual(['bbUpper', 'bbLower']);
    expect(got[0].color).toBe(BB_LINE_COLOR);
  });
  test('이평 색은 칸 순서대로', () => {
    const got = srCandidates({ values, ma: true, bb: false, poc: null, maColors: COLORS }, 100);
    expect(got.map((x) => [x.key, x.color])).toEqual([
      ['ma5', '#a'],
      ['ma20', '#b'],
      ['ma60', '#c'],
    ]);
  });
  test('값 없는 이평은 빠짐', () => {
    const got = srCandidates({ values: { ma5: 101 }, ma: true, bb: false, poc: null, maColors: COLORS }, 100);
    expect(got.map((x) => x.key)).toEqual(['ma5']);
  });
  test('POC 색은 현재가 위(저항) 주황, 아래(지지) 보라', () => {
    const up = srCandidates({ values: {}, ma: false, bb: false, poc: 105, maColors: COLORS }, 100);
    const down = srCandidates({ values: {}, ma: false, bb: false, poc: 95, maColors: COLORS }, 100);
    expect(up[0]).toEqual({ key: 'poc', price: 105, color: POC_RESIST_COLOR });
    expect(down[0].color).toBe(POC_SUPPORT_COLOR);
  });
});

describe('이름·라벨', () => {
  const lv = (key: SrLevel['key'], role: SrLevel['role']): SrLevel => ({ key, role, price: 1, color: '#x' });
  test('srName', () => {
    expect(srName('ma20', MA, false)).toBe('20선');
    expect(srName('ma20', MA, true)).toBe('20');
    expect(srName('bbUpper', MA, false)).toBe('BB상단');
    expect(srName('bbLower', MA, true)).toBe('BB-');
    expect(srName('poc', MA, false)).toBe('매물대');
    expect(srName('poc', MA, true)).toBe('POC');
  });
  test('srAxisTitle', () => {
    expect(srAxisTitle(lv('ma20', 'resistance'), MA, false)).toBe('[저항] 20선');
    expect(srAxisTitle(lv('poc', 'support'), MA, true)).toBe('지지 POC');
  });
});

describe('srSignature', () => {
  test('호가 안의 작은 변화는 같은 서명', () => {
    const a: SrLevel[] = [{ key: 'ma5', role: 'resistance', price: 71_210, color: '#x' }];
    const b: SrLevel[] = [{ key: 'ma5', role: 'resistance', price: 71_240, color: '#x' }];
    expect(srSignature(a)).toBe(srSignature(b));
  });
  test('역할이 바뀌면 다른 서명', () => {
    const a: SrLevel[] = [{ key: 'ma5', role: 'resistance', price: 100, color: '#x' }];
    const b: SrLevel[] = [{ key: 'ma5', role: 'support', price: 100, color: '#x' }];
    expect(srSignature(a)).not.toBe(srSignature(b));
  });
});
```

- [ ] **3-2: 실패 확인**

```bash
cd mobile && npx jest src/features/game/lib/sr-levels.test.ts
```
예상: `Cannot find module './sr-levels'` 로 FAIL.

- [ ] **3-3: 구현** — `mobile/src/features/game/lib/sr-levels.ts`

```ts
// 차트 게임 지지·저항 목록 — 켜진 지표의 마지막 값 중 현재가 위·아래로 가까운 2개씩(설계 2026-10-27 §3).
// 웹 web_client/src/lib/srLevels.ts 와 같은 규칙(웹은 lastSrValues 를 더 가진다).
import { roundToTick } from './krx-tick';

export type SrKey = 'ma5' | 'ma20' | 'ma60' | 'bbUpper' | 'bbLower' | 'poc';
export type SrRole = 'support' | 'resistance';

export interface SrCandidate {
  key: SrKey;
  price: number;
  color: string;
}

export interface SrLevel extends SrCandidate {
  role: SrRole;
}

/** 지표 마지막 값(이평 첫째·둘째·셋째 칸, 볼린저 상·하단) */
export type SrValues = Partial<Record<'ma5' | 'ma20' | 'ma60' | 'bbUpper' | 'bbLower', number>>;

/** 같은 가격이면 앞 순서 하나만 남긴다 */
export const SR_ORDER: readonly SrKey[] = ['ma5', 'ma20', 'ma60', 'bbUpper', 'bbLower', 'poc'];
export const SR_PER_SIDE = 2;
export const BB_LINE_COLOR = '#6366f1';
export const POC_RESIST_COLOR = '#f59e0b';
export const POC_SUPPORT_COLOR = '#8b5cf6';

const MA_KEYS = ['ma5', 'ma20', 'ma60'] as const;
const MA_SLOT: Record<(typeof MA_KEYS)[number], number> = { ma5: 0, ma20: 1, ma60: 2 };

export interface SrInputs {
  values: SrValues;
  /** 이동평균 칩 */
  ma: boolean;
  /** 볼린저 칩 */
  bb: boolean;
  /** 매물대 POC(매물대 칩이 꺼졌거나 아직 모르면 null) */
  poc: number | null;
  /** 이평 칸별 선 색 [첫째, 둘째, 셋째] */
  maColors: readonly string[];
}

/** 켜진 지표의 마지막 값 → 후보. POC 색은 현재가 위(저항)면 주황, 아래(지지)면 보라 */
export function srCandidates({ values, ma, bb, poc, maColors }: SrInputs, lastPrice: number): SrCandidate[] {
  const out: SrCandidate[] = [];
  if (ma) {
    MA_KEYS.forEach((key, i) => {
      const v = values[key];
      if (v !== undefined) out.push({ key, price: v, color: maColors[i] });
    });
  }
  if (bb) {
    if (values.bbUpper !== undefined) out.push({ key: 'bbUpper', price: values.bbUpper, color: BB_LINE_COLOR });
    if (values.bbLower !== undefined) out.push({ key: 'bbLower', price: values.bbLower, color: BB_LINE_COLOR });
  }
  if (poc !== null) out.push({ key: 'poc', price: poc, color: poc >= lastPrice ? POC_RESIST_COLOR : POC_SUPPORT_COLOR });
  return out;
}

/** 현재가 이상 = 저항(가까운 순 2개), 미만 = 지지(가까운 순 2개). 저항 먼저, 그다음 지지 */
export function pickSrLevels(candidates: SrCandidate[], lastPrice: number): SrLevel[] {
  const ordered = candidates
    .filter((x) => Number.isFinite(x.price) && x.price > 0)
    .sort((a, b) => SR_ORDER.indexOf(a.key) - SR_ORDER.indexOf(b.key));
  const seen = new Set<number>();
  const uniq: SrCandidate[] = [];
  for (const x of ordered) {
    if (seen.has(x.price)) continue;
    seen.add(x.price);
    uniq.push(x);
  }
  const resist = uniq
    .filter((x) => x.price >= lastPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, SR_PER_SIDE)
    .map((x): SrLevel => ({ ...x, role: 'resistance' }));
  const support = uniq
    .filter((x) => x.price < lastPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, SR_PER_SIDE)
    .map((x): SrLevel => ({ ...x, role: 'support' }));
  return [...resist, ...support];
}

/** 지표 이름 — 넓게: 20선·BB상단·매물대 / 좁게: 20·BB+·POC */
export function srName(key: SrKey, maPeriods: readonly number[], short: boolean): string {
  switch (key) {
    case 'ma5':
    case 'ma20':
    case 'ma60': {
      const p = maPeriods[MA_SLOT[key]];
      return short ? String(p) : `${p}선`;
    }
    case 'bbUpper':
      return short ? 'BB+' : 'BB상단';
    case 'bbLower':
      return short ? 'BB-' : 'BB하단';
    case 'poc':
      return short ? 'POC' : '매물대';
  }
}

/** 가격축 라벨 — 넓게: [저항] 20선 / 좁게: 저항 20 (가격 숫자는 축 라벨에 이미 있음) */
export function srAxisTitle(level: SrLevel, maPeriods: readonly number[], short: boolean): string {
  const role = level.role === 'support' ? '지지' : '저항';
  const name = srName(level.key, maPeriods, short);
  return short ? `${role} ${name}` : `[${role}] ${name}`;
}

/** 다시 그릴지 판단용 — 키·역할·호가 반올림 가격이 같으면 같은 서명 */
export function srSignature(levels: SrLevel[]): string {
  return levels.map((l) => `${l.key}:${l.role}:${roundToTick(l.price)}`).join('|');
}
```

- [ ] **3-4: 통과 확인**

```bash
cd mobile && npx jest src/features/game/lib/sr-levels.test.ts
```
예상: PASS.

- [ ] **3-5: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/features/game/lib/sr-levels.ts mobile/src/features/game/lib/sr-levels.test.ts
git commit -m "feat(mobile): 차트 게임 지지·저항 고르기 순수 함수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 4: 앱 — 터치·돌파·이탈 감지기와 시트 문구

**파일:**
- 생성: `mobile/src/features/game/lib/sr-watch.ts`
- 테스트: `mobile/src/features/game/lib/sr-watch.test.ts`

- [ ] **4-1: 실패하는 테스트 작성** — `mobile/src/features/game/lib/sr-watch.test.ts`

```ts
import type { SrLevel } from './sr-levels';
import { SR_COOLDOWN_MS, srEps, srEventCopy, SrWatcher, zoneOf } from './sr-watch';

// 50,000원 선: 호가 100 > 0.15%(75) → 오차 100. 띠 = 49,900~50,100
const L: SrLevel = { key: 'ma20', role: 'resistance', price: 50_000, color: '#x' };
const types = (evs: { type: string }[]) => evs.map((e) => e.type);

describe('srEps·zoneOf', () => {
  test('오차 = max(호가, 0.15%)', () => {
    expect(srEps(50_000)).toBe(100);
    expect(srEps(100_000)).toBe(150);
    expect(srEps(1_000)).toBe(1.5);
  });
  test('띠 경계는 near', () => {
    expect(zoneOf(50_100, 50_000)).toBe('near');
    expect(zoneOf(50_101, 50_000)).toBe('above');
    expect(zoneOf(49_900, 50_000)).toBe('near');
    expect(zoneOf(49_899, 50_000)).toBe('below');
  });
});

describe('SrWatcher', () => {
  test('처음 보는 선은 기준만 잡고 이벤트 없음', () => {
    const w = new SrWatcher();
    expect(w.update([L], 51_000, 0)).toEqual([]);
  });
  test('위 → 띠 안 = 지지 터치, 이어서 아래 = 지지 이탈', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    expect(w.update([L], 50_050, 1)).toEqual([{ type: 'SUPPORT_TOUCH', key: 'ma20', levelPrice: 50_000, price: 50_050 }]);
    expect(types(w.update([L], 49_800, 2))).toEqual(['SUPPORT_BREAKDOWN']);
  });
  test('아래 → 띠 안 = 저항 터치, 이어서 위 = 저항 돌파', () => {
    const w = new SrWatcher();
    w.update([L], 49_000, 0);
    expect(types(w.update([L], 49_950, 1))).toEqual(['RESISTANCE_TOUCH']);
    expect(types(w.update([L], 50_200, 2))).toEqual(['RESISTANCE_BREAKOUT']);
  });
  test('위 → 아래 한 번에 = 이탈만', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    expect(types(w.update([L], 49_000, 1))).toEqual(['SUPPORT_BREAKDOWN']);
  });
  test('띠 안에서 오르내림은 이벤트 없음', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    w.update([L], 50_050, 1);
    expect(w.update([L], 49_950, 2)).toEqual([]);
    expect(w.update([L], 50_080, 3)).toEqual([]);
  });
  test('띠 안 → 원래 쪽 복귀는 이벤트 없음, 같은 이벤트는 10분 뒤 다시', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    expect(types(w.update([L], 50_050, 1))).toEqual(['SUPPORT_TOUCH']);
    expect(w.update([L], 50_500, 2)).toEqual([]);
    expect(w.update([L], 50_050, 3)).toEqual([]); // 10분 안
    w.update([L], 50_500, 4);
    expect(types(w.update([L], 50_050, 1 + SR_COOLDOWN_MS))).toEqual(['SUPPORT_TOUCH']);
  });
  test('처음이 띠 안이면 띠 밖으로 나간 뒤부터 판정', () => {
    const w = new SrWatcher();
    w.update([L], 50_000, 0);
    expect(w.update([L], 50_050, 1)).toEqual([]);
    expect(w.update([L], 49_000, 2)).toEqual([]); // 어느 쪽에서 왔는지 모름
    expect(types(w.update([L], 49_950, 3))).toEqual(['RESISTANCE_TOUCH']);
  });
  test('목록에서 빠진 선은 상태를 버리고 다시 들어오면 기준부터', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    expect(w.update([], 50_050, 1)).toEqual([]);
    expect(w.update([L], 50_050, 2)).toEqual([]);
  });
  test('reset 하면 모두 기준부터', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    w.reset();
    expect(w.update([L], 50_050, 1)).toEqual([]);
  });
});

describe('srEventCopy', () => {
  test('문구', () => {
    expect(srEventCopy('SUPPORT_BREAKDOWN', '20선', 72_000)).toEqual({
      title: '⚠️ [지지선 이탈] 20선(72,000원) 하향 이탈',
      body: '지지가 깨지면 추가 하락 위험이 커요.',
    });
    expect(srEventCopy('RESISTANCE_TOUCH', 'BB상단', 74_200).title).toBe('🔔 [저항선 도달] BB상단(74,200원) 터치');
  });
});
```

- [ ] **4-2: 실패 확인**

```bash
cd mobile && npx jest src/features/game/lib/sr-watch.test.ts
```
예상: `Cannot find module './sr-watch'` 로 FAIL.

- [ ] **4-3: 구현** — `mobile/src/features/game/lib/sr-watch.ts`

```ts
// 지지·저항 터치·돌파·이탈 감지(화면 안) — I/O 없는 상태 객체(설계 2026-10-27 §5).
// 선마다 '마지막으로 띠 밖에서 머문 쪽'을 기억해, 띠(±오차)에 들어오면 터치, 반대쪽으로 넘어가면 돌파·이탈.
// 웹 web_client/src/lib/srWatch.ts 와 같은 코드.
import { formatPrice } from './format';
import { krxTick } from './krx-tick';
import type { SrKey, SrLevel } from './sr-levels';

export const SR_COOLDOWN_MS = 600_000; // 같은 선·같은 이벤트 재알림 간격(10분)
export const SR_EPS_RATIO = 0.0015; // 오차 = max(호가 단위, 선 가격 × 0.15%)

export type SrEventType = 'SUPPORT_TOUCH' | 'SUPPORT_BREAKDOWN' | 'RESISTANCE_TOUCH' | 'RESISTANCE_BREAKOUT';

export interface SrEvent {
  type: SrEventType;
  key: SrKey;
  levelPrice: number;
  price: number;
}

export type SrZone = 'above' | 'below' | 'near';
type Side = 'above' | 'below';

export const srEps = (level: number): number => Math.max(krxTick(level), level * SR_EPS_RATIO);

export function zoneOf(price: number, level: number): SrZone {
  const eps = srEps(level);
  if (price > level + eps) return 'above';
  if (price < level - eps) return 'below';
  return 'near';
}

function classify(lastSide: Side | null, zone: SrZone): SrEventType | null {
  if (lastSide === null) return null;
  if (zone === 'near') return lastSide === 'above' ? 'SUPPORT_TOUCH' : 'RESISTANCE_TOUCH';
  if (zone === 'below' && lastSide === 'above') return 'SUPPORT_BREAKDOWN';
  if (zone === 'above' && lastSide === 'below') return 'RESISTANCE_BREAKOUT';
  return null;
}

export class SrWatcher {
  private state = new Map<SrKey, { zone: SrZone; lastSide: Side | null }>();
  private fired = new Map<string, number>(); // `${key}:${type}` → 마지막 발생 시각

  /** 틱마다 호출 — 이번 틱에 생긴 이벤트(대개 0~1개) */
  update(levels: SrLevel[], price: number, nowMs: number): SrEvent[] {
    const out: SrEvent[] = [];
    const seen = new Set<SrKey>();
    for (const lv of levels) {
      seen.add(lv.key);
      const zone = zoneOf(price, lv.price);
      const prev = this.state.get(lv.key);
      if (prev === undefined) {
        // 처음 보는 선 — 기준만(화면을 연 직후·칩을 켠 직후에 시트가 뜨지 않게)
        this.state.set(lv.key, { zone, lastSide: zone === 'near' ? null : zone });
        continue;
      }
      if (zone !== prev.zone) {
        const type = classify(prev.lastSide, zone);
        if (type !== null && this.take(`${lv.key}:${type}`, nowMs)) {
          out.push({ type, key: lv.key, levelPrice: lv.price, price });
        }
      }
      this.state.set(lv.key, { zone, lastSide: zone === 'near' ? prev.lastSide : zone });
    }
    for (const k of [...this.state.keys()]) if (!seen.has(k)) this.state.delete(k);
    return out;
  }

  /** 포지션 없음·화면 벗어남 — 다음 update 부터 기준을 새로 잡는다(재알림 간격 기록은 유지) */
  reset(): void {
    this.state.clear();
  }

  private take(id: string, nowMs: number): boolean {
    const last = this.fired.get(id);
    if (last !== undefined && nowMs - last < SR_COOLDOWN_MS) return false;
    this.fired.set(id, nowMs);
    return true;
  }
}

export interface SrCopy {
  title: string;
  body: string;
}

/** 대응 시트 문구(원 문서 03 §4 기반). name = 넓은 화면 이름(20선·BB상단·매물대) */
export function srEventCopy(type: SrEventType, name: string, levelPrice: number): SrCopy {
  const at = `${name}(${formatPrice(levelPrice)}원)`;
  switch (type) {
    case 'RESISTANCE_TOUCH':
      return { title: `🔔 [저항선 도달] ${at} 터치`, body: '매물 압박으로 단기 조정이 나올 수 있어요.' };
    case 'RESISTANCE_BREAKOUT':
      return { title: `🚀 [저항선 돌파] ${at} 상향 돌파`, body: '저항이 뚫리면 다음엔 지지선이 될 수 있어요.' };
    case 'SUPPORT_TOUCH':
      return { title: `🔔 [지지선 도달] ${at} 터치`, body: '반등이 나올 수 있는 자리예요.' };
    case 'SUPPORT_BREAKDOWN':
      return { title: `⚠️ [지지선 이탈] ${at} 하향 이탈`, body: '지지가 깨지면 추가 하락 위험이 커요.' };
  }
}
```

- [ ] **4-4: 통과 확인**

```bash
cd mobile && npx jest src/features/game/lib/sr-watch.test.ts
```
예상: PASS.

- [ ] **4-5: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/features/game/lib/sr-watch.ts mobile/src/features/game/lib/sr-watch.test.ts
git commit -m "feat(mobile): 지지·저항 터치·돌파·이탈 감지기와 대응 시트 문구

- 선별 마지막으로 띠 밖에서 머문 쪽 기준 판정(원안 감지 코드의 지지 터치 누락 보완)
- 오차 max(호가, 0.15%), 같은 선·이벤트 10분 재알림 간격

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 5: 앱 차트 페이지 — POC 점·`poc` 메시지·가격축 라벨

**파일:**
- 수정: `mobile/src/features/game/lib/chart-bridge.ts:37-48`(`ChartLine`), `:80-81`(`PageEvent`)
- 수정: `mobile/src/features/game/chart-web/page/chart-page-script.ts`(매물대 클래스·`applyVis`·`applyLines`)
- 재생성: `mobile/src/features/game/chart-web/page-script.generated.ts`
- 수정: `mobile/src/features/game/components/tv-chart.tsx`

- [ ] **5-1: 브리지 타입 수정** — `mobile/src/features/game/lib/chart-bridge.ts`

`ChartLine` 의 `fit?: ...` 줄 다음(인터페이스 닫는 `}` 앞)에 추가:
```ts
  /** 가격축 라벨 옆 이름(지지·저항 선만, 예: '저항 20'). 없으면 이름 없음 — 다른 선 이름은 RN 범례(title) */
  axisTitle?: string;
```
`PageEvent` 를 아래로 바꾼다:
```ts
/** 페이지 → RN 메시지 — 준비됨 / 일봉 왼쪽 끝(과거 요청) / 보이는 구간 매물대 POC 변경(끄면 null) / 처리 중 오류 */
export type PageEvent =
  | { type: 'ready' }
  | { type: 'needOlder' }
  | { type: 'poc'; price: number | null }
  | { type: 'error'; message: string };
```

- [ ] **5-2: 페이지 스크립트 수정** — `mobile/src/features/game/chart-web/page/chart-page-script.ts`

(1) `const VP_COLOR = ...;` 줄 아래에 추가:
```ts
const POC_RESIST = '#f59e0b'; // POC 가 현재가 위(저항)
const POC_SUPPORT = '#8b5cf6'; // POC 가 현재가 아래(지지)

/** 거래량 가장 큰 칸의 가운데 가격(같으면 아래 칸). 칸이 없으면 null */
function pocOf(bins: { low: number; high: number; volume: number }[]): number | null {
  let best: { low: number; high: number; volume: number } | null = null;
  for (const b of bins) if (b.volume > 0 && (best === null || b.volume > best.volume)) best = b;
  return best === null ? null : (best.low + best.high) / 2;
}
```

(2) `class VolumeProfile` 의 필드 `visible = false;` 아래에 추가:
```ts
  /** 마지막으로 RN 에 알린 POC(undefined = 아직 안 알림) — 바뀔 때만 보낸다 */
  sentPoc: number | null | undefined = undefined;
  /** POC 를 RN 에 알림(바뀐 경우만) */
  reportPoc(poc: number | null) {
    if (poc === this.sentPoc) return;
    this.sentPoc = poc;
    post({ type: 'poc', price: poc });
  }
```

(3) `draw` 의 `target.useMediaCoordinateSpace(({ context: c, mediaSize }) => { ... });` 블록을 아래로 바꾼다(막대는 그대로, 끝에 POC 점 추가):
```ts
    const poc = pocOf(bins);
    const last = this.points[this.points.length - 1].close;
    target.useMediaCoordinateSpace(({ context: c, mediaSize }) => {
      c.fillStyle = VP_COLOR;
      bins.forEach((b) => {
        const yh = p.series.priceToCoordinate(b.high);
        const yl = p.series.priceToCoordinate(b.low);
        if (yh === null || yl === null || b.volume === 0) return;
        c.fillRect(0, Math.min(yh, yl), (b.volume / maxVol) * mediaSize.width * VP_MAX_WIDTH, Math.max(1, Math.abs(yl - yh) - 1));
      });
      // POC 칸 막대 오른쪽 끝(= 최대 폭)에 점 — 현재가 위면 주황(저항), 아래면 보라(지지)
      const y = poc === null ? null : p.series.priceToCoordinate(poc);
      if (poc !== null && y !== null) {
        c.fillStyle = poc >= last ? POC_RESIST : POC_SUPPORT;
        c.beginPath();
        c.arc(mediaSize.width * VP_MAX_WIDTH, y, 3, 0, Math.PI * 2);
        c.fill();
      }
    });
    this.reportPoc(poc);
```
같은 `draw` 안 `if (bins.length === 0) return;` 를 아래로 바꾼다:
```ts
    if (bins.length === 0) {
      this.reportPoc(null);
      return;
    }
```

(4) `applyVis` 의 `vpPrim.visible = vis.vp;` 아래에 추가:
```ts
  if (!vis.vp) vpPrim.reportPoc(null); // 끄면 RN 의 지지·저항 후보에서 POC 를 뺀다
```

(5) `applyLines` 의 `createPriceLine` 인자 중 `lineStyle: spec.dashed ? ... axisLabelVisible: true, title: '', // 이름은 RN 범례에 …` 줄 전체를 아래로 바꾼다:
```ts
      lineStyle: spec.dashed ? LW.LineStyle.Dashed : LW.LineStyle.Solid, axisLabelVisible: true, title: spec.axisTitle ?? '', // 지지·저항 선만 축 이름 — 다른 선 이름은 RN 범례(가까운 선끼리 겹침)
```

(6) `create()` 안 `vpPrim = new VolumeProfile();` 는 새 객체라 `sentPoc` 가 `undefined` 로 시작한다 — 차트를 다시 만들면 첫 그리기에서 POC 를 다시 알린다(추가 수정 없음).

- [ ] **5-3: 생성 파일 다시 만들기와 타입 검사**

```bash
cd mobile && npm run gen:chart-page && npx tsc --noEmit -p src/features/game/chart-web/page/tsconfig.json && npx jest src/features/game/chart-web
```
예상: `생성: src/features/game/chart-web/page-script.generated.ts`, 타입 오류 없음, 테스트 PASS.

- [ ] **5-4: TvChart 가 `poc` 를 받게** — `mobile/src/features/game/components/tv-chart.tsx`

`TvChartProps` 의 `onNeedOlder?: ...;` 아래에 추가:
```ts
  /** 매물대가 켜져 있을 때 보이는 구간 POC 가 바뀌면(끄면 null) — 지지·저항 후보용 */
  onPoc?: (price: number | null) => void;
```
함수 인자 구조 분해 `onNeedOlder,` 아래에 `onPoc,` 를 추가하고, `onMessage` 의 `} else if (msg.type === 'error' && __DEV__) {` 바로 앞에 추가:
```ts
    } else if (msg.type === 'poc') {
      onPoc?.(msg.price);
```

- [ ] **5-5: 확인과 커밋**

```bash
cd mobile && npx tsc --noEmit && npx jest src/features/game
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/features/game/lib/chart-bridge.ts mobile/src/features/game/chart-web/page/chart-page-script.ts mobile/src/features/game/chart-web/page-script.generated.ts mobile/src/features/game/components/tv-chart.tsx
git commit -m "feat(mobile): 앱 차트 매물대 POC 점·poc 메시지, 지지·저항 선 가격축 이름(axisTitle)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 6: 앱 게임 차트 — 지지·저항 선 그리기와 목록 올리기

**파일:**
- 수정: `mobile/src/features/game/components/candle-chart.tsx`(`DailyChart`)

- [ ] **6-1: import 추가** — 파일 위

`import { mergeOlder, priceLines, type ChartColors } from '../lib/chart-bridge';` 를
```ts
import { lastIndicatorValues, mergeOlder, priceLines, toBars, type ChartColors, type ChartLine } from '../lib/chart-bridge';
```
로 바꾸고, 그 아래에 추가:
```ts
import { pickSrLevels, srAxisTitle, srCandidates, srName, srSignature, type SrLevel } from '../lib/sr-levels';
```

- [ ] **6-2: props 추가** — `DailyChartProps` 의 `position: Position | null;` 아래에

```ts
  /** 차트에 그린 지지·저항 목록(바뀔 때만) — 게임 화면이 터치·돌파 감지에 쓴다 */
  onSrLevels?: (levels: SrLevel[]) => void;
```
함수 시그니처를 `export function DailyChart({ ticker, lastPrice, coach, position, onSrLevels }: DailyChartProps) {` 로 바꾼다.

- [ ] **6-3: 지지·저항 계산** — `const chartView = useMemo<TvChartData | null>(...)` 블록 **바로 아래**에 추가

```ts
  // 지지·저항(설계 2026-10-27 §3) — 켜진 지표의 마지막 값 + 보이는 구간 POC 중 현재가 위·아래 2개씩.
  // 틱마다 다시 계산하되, 키·역할·호가 반올림 가격이 같으면 이전 배열을 유지(WebView·부모에 다시 보내지 않게)
  const [poc, setPoc] = useState<number | null>(null);
  const rawSr = useMemo<SrLevel[]>(() => {
    if (chartView === null || shown === null || !sameSeries(shown.series, ticker, interval)) return [];
    const bars = toBars(chartView.data);
    const price = lastPrice ?? bars[bars.length - 1]?.close;
    if (price === undefined) return [];
    const cands = srCandidates(
      {
        values: lastIndicatorValues(bars),
        ma: showMa,
        bb: showBb,
        poc: showVp ? poc : null,
        maColors: MA_PERIODS.map((p) => MA_COLORS[p]),
      },
      price,
    );
    return pickSrLevels(cands, price);
  }, [chartView, shown, ticker, interval, lastPrice, showMa, showBb, showVp, poc]);
  const [srLevels, setSrLevels] = useState<SrLevel[]>([]);
  useEffect(() => {
    setSrLevels((prev) => (srSignature(prev) === srSignature(rawSr) ? prev : rawSr));
  }, [rawSr]);
  useEffect(() => {
    onSrLevels?.(srLevels);
  }, [srLevels, onSrLevels]);
  // 지지·저항 선 — 이름은 가격축에(짧게), 범례에는 넣지 않는다(아래 lines 범례는 그대로)
  const chartLines = useMemo<ChartLine[]>(
    () => [
      ...lines,
      ...srLevels.map((l) => ({
        price: l.price,
        color: l.color,
        width: 1 as const,
        dashed: true,
        title: srName(l.key, MA_PERIODS, false),
        axisTitle: srAxisTitle(l, MA_PERIODS, true),
      })),
    ],
    [lines, srLevels],
  );
```

- [ ] **6-4: TvChart 에 연결** — JSX 의 `<TvChart` 에서 `lines={lines}` 를 `lines={chartLines}` 로 바꾸고, `onNeedOlder={...}` 아래에 `onPoc={setPoc}` 를 추가한다.

- [ ] **6-5: 확인과 커밋**

```bash
cd mobile && npx tsc --noEmit && npx jest src/features/game && npx expo lint src/features/game/components/candle-chart.tsx
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/features/game/components/candle-chart.tsx
git commit -m "feat(mobile): 게임 차트에 가까운 지지·저항 4개 점선·가격축 이름, 목록을 화면에 올림

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```
예상: 타입·테스트 통과, 린트 오류 없음(경고는 기존 수준).

---

### 작업 7: 앱 — 손익 청산 버튼

**파일:**
- 수정: `mobile/src/ui/button.tsx`
- 수정: `mobile/src/features/game/components/position-card.tsx`

- [ ] **7-1: Button 에 `labelColor` 추가** — `mobile/src/ui/button.tsx`

`Props` 의 `accessibilityLabel?: string;` 아래에:
```ts
  /** 글자 색 덮어쓰기(예: 손익 버튼의 상승·하락 색). 없으면 variant 기본색 */
  labelColor?: string;
```
구조 분해에 `accessibilityLabel,` 아래 `labelColor,` 추가, 라벨 Text 를
```tsx
        <Text style={[styles.label, styles[`${variant}Label`], labelColor ? { color: labelColor } : null]}>{label}</Text>
```
로 바꾼다.

- [ ] **7-2: PositionCard 버튼 교체** — `mobile/src/features/game/components/position-card.tsx`

import 줄 `import { StyleSheet } from 'react-native-unistyles';` 를
```ts
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
```
로, `import { formatPrice } from '../lib/format';` 위에 추가:
```ts
import { closeActionOf } from '../lib/close-action';
```
함수 본문 첫 줄(`const long = ...`) 위에 추가:
```ts
  const { theme } = useUnistyles();
  // 손익에 따라 익절/손절 — 색은 손익 글자와 같은 상승·하락 색(사유는 서버가 체결 가격으로 정함)
  const action = closeActionOf(position.pnl_amount);
  const actionColor = action.kind === 'tp' ? theme.colors.up : action.kind === 'sl' ? theme.colors.down : undefined;
```
버튼 줄을
```tsx
        <Button label={action.label} labelColor={actionColor} variant="secondary" loading={closing} onPress={onClose} />
```
로 바꾸고, 파일 주석 `원클릭 전액 청산` 을 `손익에 따라 익절/손절 원클릭 전액 청산` 으로 바꾼다.

- [ ] **7-3: 확인과 커밋**

```bash
cd mobile && npx tsc --noEmit && npx jest
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/ui/button.tsx mobile/src/features/game/components/position-card.tsx
git commit -m "feat(mobile): 포지션 카드 청산 버튼을 손익에 따라 익절하기·손절하기로

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 8: 앱 — 대응 시트와 게임 화면 감지 연결

**파일:**
- 생성: `mobile/src/features/game/components/sr-action-sheet.tsx`
- 수정: `mobile/src/app/(tabs)/game.tsx`

- [ ] **8-1: 시트 컴포넌트** — `mobile/src/features/game/components/sr-action-sheet.tsx`

```tsx
import { Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { AmountText, BottomSheet, Button } from '@/ui';

import { closeActionOf } from '../lib/close-action';
import { srEventCopy, type SrEvent } from '../lib/sr-watch';
import type { Position } from '../types';

type Props = {
  event: SrEvent;
  /** 넓은 화면 이름(20선·BB상단·매물대) */
  name: string;
  position: Position;
  closing: boolean;
  onClosePosition: () => void;
  onHold: () => void;
  onDismiss: () => void;
};

/**
 * 지지·저항 대응 시트 — [💰 익절하기 / 🛡️ 손절하기] vs [✊ 홀딩](설계 2026-10-27 §7).
 * 이벤트 데이터만 받는다(나중에 푸시를 눌러 들어올 때도 같은 시트).
 */
export function SrActionSheet({ event, name, position, closing, onClosePosition, onHold, onDismiss }: Props) {
  const { theme } = useUnistyles();
  const copy = srEventCopy(event.type, name, event.levelPrice);
  const action = closeActionOf(position.pnl_amount);
  const actionColor = action.kind === 'tp' ? theme.colors.up : action.kind === 'sl' ? theme.colors.down : undefined;
  return (
    <BottomSheet title={copy.title} onClose={onDismiss}>
      <Text style={styles.body}>{copy.body}</Text>
      <View style={styles.pnl}>
        <Text style={styles.muted}>현재 평가손익</Text>
        {position.pnl_amount !== null ? (
          <AmountText value={position.pnl_amount} kind="won" signed size={17} />
        ) : (
          <Text style={styles.muted}>—</Text>
        )}
        {position.roi_pct !== null ? <AmountText value={position.roi_pct} kind="pct" size={14} weight="600" /> : null}
      </View>
      <Button label={action.label} labelColor={actionColor} variant="secondary" loading={closing} onPress={onClosePosition} />
      <Button label="✊ 홀딩" variant="secondary" onPress={onHold} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { fontSize: 15, color: theme.colors.text, marginBottom: theme.gap(1) },
  pnl: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75), marginBottom: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
}));
```

- [ ] **8-2: 게임 화면 연결** — `mobile/src/app/(tabs)/game.tsx`

(1) `import { DailyChart } from '@/features/game/components/candle-chart';` 아래에 추가:
```ts
import { SrActionSheet } from '@/features/game/components/sr-action-sheet';
import { MA_PERIODS } from '@/features/game/lib/indicators';
import { srName, type SrLevel } from '@/features/game/lib/sr-levels';
import { SrWatcher, type SrEvent } from '@/features/game/lib/sr-watch';
```

(2) `const focused = useIsFocused();` 아래에 추가(이 줄은 `activeModal`·`loginPrompt` 선언보다 아래에 있으므로 두 값을 쓸 수 있다):
```ts
  const pushToast = useTradingGameStore((s) => s.pushToast);

  // 지지·저항 대응(설계 2026-10-27 §7) — 포지션 보유 + 이 화면을 보는 중일 때만 틱마다 감지.
  // 조건이 빠지면 reset(돌아왔을 때 그사이 움직임으로 시트가 바로 뜨지 않게 기준부터)
  const [srLevels, setSrLevels] = useState<SrLevel[]>([]);
  const [srEvent, setSrEvent] = useState<SrEvent | null>(null);
  const watcherRef = useRef(new SrWatcher());
  const hasPosition = position !== null;
  useEffect(() => {
    const w = watcherRef.current;
    if (!loggedIn || !hasPosition || !focused || lastPrice === null) {
      w.reset();
      return;
    }
    const events = w.update(srLevels, lastPrice, Date.now());
    // 다른 시트가 열려 있으면 버린다(재알림 간격은 이미 적용됨)
    if (events.length > 0 && activeModal === null && !loginPrompt) setSrEvent((cur) => cur ?? events[0]);
  }, [lastPrice, srLevels, hasPosition, focused, loggedIn, activeModal, loginPrompt]);
  useEffect(() => {
    if (!hasPosition) setSrEvent(null);
  }, [hasPosition]);
```

(3) JSX `<DailyChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />` 를
```tsx
        <DailyChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} onSrLevels={setSrLevels} />
```
로 바꾼다.

(4) `{loginPrompt ? (` 블록 바로 앞에 추가:
```tsx
      {srEvent !== null && position !== null ? (
        <SrActionSheet
          event={srEvent}
          name={srName(srEvent.key, MA_PERIODS, false)}
          position={position}
          closing={closing}
          onClosePosition={() => {
            setSrEvent(null);
            void closePosition();
          }}
          onHold={() => {
            setSrEvent(null);
            pushToast({ kind: 'info', icon: '✊', message: '홀딩을 선택했어요. 다음 지지·저항에서 다시 알려 드릴게요.' });
          }}
          onDismiss={() => setSrEvent(null)}
        />
      ) : null}
```

- [ ] **8-3: 확인과 커밋**

```bash
cd mobile && npx tsc --noEmit && npx jest && npx expo lint "src/app/(tabs)/game.tsx" src/features/game/components/sr-action-sheet.tsx
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add mobile/src/features/game/components/sr-action-sheet.tsx "mobile/src/app/(tabs)/game.tsx"
git commit -m "feat(mobile): 지지·저항 도달 시 대응 시트 — 익절·손절 vs 홀딩

- 포지션 보유·게임 탭을 보는 중일 때만 틱마다 감지, 다른 시트가 열려 있으면 버림
- 홀딩은 토스트만(서버 기록 없음)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 9: 웹 — 순수 함수 옮기기

**파일:**
- 생성: `web_client/src/lib/krxTick.ts`, `web_client/src/lib/closeAction.ts`, `web_client/src/lib/srLevels.ts`, `web_client/src/lib/srWatch.ts`

웹은 세미콜론을 쓰지 않는다. 내용은 앱 함수와 같고, `srLevels.ts` 에 `lastSrValues`, `closeAction.ts` 에 `closeActionClass` 가 더 있다.

- [ ] **9-1: `web_client/src/lib/krxTick.ts`**

```ts
// KRX 호가 단위(2023-01 KOSPI·KOSDAQ 통합) — 백엔드 sr_levels.krx_tick·앱 features/game/lib/krx-tick.ts 와 같은 표.
const TABLE: readonly (readonly [number, number])[] = [
  [2_000, 1],
  [5_000, 5],
  [20_000, 10],
  [50_000, 50],
  [200_000, 100],
  [500_000, 500],
]

/** 가격의 호가 단위(원) */
export function krxTick(price: number): number {
  for (const [limit, tick] of TABLE) if (price < limit) return tick
  return 1_000
}

/** 가장 가까운 호가로 반올림 */
export function roundToTick(price: number): number {
  const tick = krxTick(price)
  return Math.floor(price / tick + 0.5) * tick
}
```

- [ ] **9-2: `web_client/src/lib/closeAction.ts`**

```ts
// 청산 버튼 문구 — 평가손익이 0 이상이면 익절, 음수면 손절(설계 2026-10-27 §6.1). 앱 close-action.ts 와 같은 코드.
// 사유 기록은 서버가 체결 가격으로 정한다(이 함수는 화면 표시만).
export type CloseKind = 'tp' | 'sl' | 'neutral'

export interface CloseAction {
  kind: CloseKind
  label: string
}

export function closeActionOf(pnl: number | null): CloseAction {
  if (pnl === null) return { kind: 'neutral', label: '청산하기' }
  return pnl >= 0 ? { kind: 'tp', label: '💰 익절하기' } : { kind: 'sl', label: '🛡️ 손절하기' }
}

/** 손익 버튼 글자색(Tailwind) — 손익 글자와 같은 상승·하락 색 */
export const closeActionClass = (kind: CloseKind): string => (kind === 'tp' ? 'text-up' : kind === 'sl' ? 'text-down' : '')
```

- [ ] **9-3: `web_client/src/lib/srLevels.ts`**

```ts
// 차트 게임 지지·저항 목록 — 켜진 지표의 마지막 값 중 현재가 위·아래로 가까운 2개씩(설계 2026-10-27 §3).
// 앱 features/game/lib/sr-levels.ts 와 같은 규칙(웹은 종가로 지표 마지막 값을 구하는 lastSrValues 를 더 가진다).
import { bollinger, MA_PERIODS, sma } from './indicators'
import { roundToTick } from './krxTick'

export type SrKey = 'ma5' | 'ma20' | 'ma60' | 'bbUpper' | 'bbLower' | 'poc'
export type SrRole = 'support' | 'resistance'

export interface SrCandidate {
  key: SrKey
  price: number
  color: string
}

export interface SrLevel extends SrCandidate {
  role: SrRole
}

/** 지표 마지막 값(이평 첫째·둘째·셋째 칸, 볼린저 상·하단) */
export type SrValues = Partial<Record<'ma5' | 'ma20' | 'ma60' | 'bbUpper' | 'bbLower', number>>

/** 같은 가격이면 앞 순서 하나만 남긴다 */
export const SR_ORDER: readonly SrKey[] = ['ma5', 'ma20', 'ma60', 'bbUpper', 'bbLower', 'poc']
export const SR_PER_SIDE = 2
export const BB_LINE_COLOR = '#6366f1'
export const POC_RESIST_COLOR = '#f59e0b'
export const POC_SUPPORT_COLOR = '#8b5cf6'

const MA_KEYS = ['ma5', 'ma20', 'ma60'] as const
const MA_SLOT: Record<(typeof MA_KEYS)[number], number> = { ma5: 0, ma20: 1, ma60: 2 }

/** 종가 배열(오래된 → 최신)로 지표 마지막 값 */
export function lastSrValues(closes: number[]): SrValues {
  const n = closes.length
  if (n === 0) return {}
  const out: SrValues = {}
  MA_PERIODS.forEach((p, i) => {
    const v = sma(closes, p)[n - 1]
    if (v !== null) out[MA_KEYS[i]] = v
  })
  const band = bollinger(closes)[n - 1]
  if (band) {
    out.bbUpper = band.upper
    out.bbLower = band.lower
  }
  return out
}

export interface SrInputs {
  values: SrValues
  /** 이동평균 칩 */
  ma: boolean
  /** 볼린저 칩 */
  bb: boolean
  /** 매물대 POC(매물대 칩이 꺼졌거나 아직 모르면 null) */
  poc: number | null
  /** 이평 칸별 선 색 [첫째, 둘째, 셋째] */
  maColors: readonly string[]
}

/** 켜진 지표의 마지막 값 → 후보. POC 색은 현재가 위(저항)면 주황, 아래(지지)면 보라 */
export function srCandidates({ values, ma, bb, poc, maColors }: SrInputs, lastPrice: number): SrCandidate[] {
  const out: SrCandidate[] = []
  if (ma) {
    MA_KEYS.forEach((key, i) => {
      const v = values[key]
      if (v !== undefined) out.push({ key, price: v, color: maColors[i] })
    })
  }
  if (bb) {
    if (values.bbUpper !== undefined) out.push({ key: 'bbUpper', price: values.bbUpper, color: BB_LINE_COLOR })
    if (values.bbLower !== undefined) out.push({ key: 'bbLower', price: values.bbLower, color: BB_LINE_COLOR })
  }
  if (poc !== null) out.push({ key: 'poc', price: poc, color: poc >= lastPrice ? POC_RESIST_COLOR : POC_SUPPORT_COLOR })
  return out
}

/** 현재가 이상 = 저항(가까운 순 2개), 미만 = 지지(가까운 순 2개). 저항 먼저, 그다음 지지 */
export function pickSrLevels(candidates: SrCandidate[], lastPrice: number): SrLevel[] {
  const ordered = candidates
    .filter((x) => Number.isFinite(x.price) && x.price > 0)
    .sort((a, b) => SR_ORDER.indexOf(a.key) - SR_ORDER.indexOf(b.key))
  const seen = new Set<number>()
  const uniq: SrCandidate[] = []
  for (const x of ordered) {
    if (seen.has(x.price)) continue
    seen.add(x.price)
    uniq.push(x)
  }
  const resist = uniq
    .filter((x) => x.price >= lastPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, SR_PER_SIDE)
    .map((x): SrLevel => ({ ...x, role: 'resistance' }))
  const support = uniq
    .filter((x) => x.price < lastPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, SR_PER_SIDE)
    .map((x): SrLevel => ({ ...x, role: 'support' }))
  return [...resist, ...support]
}

/** 지표 이름 — 넓게: 20선·BB상단·매물대 / 좁게: 20·BB+·POC */
export function srName(key: SrKey, maPeriods: readonly number[], short: boolean): string {
  switch (key) {
    case 'ma5':
    case 'ma20':
    case 'ma60': {
      const p = maPeriods[MA_SLOT[key]]
      return short ? String(p) : `${p}선`
    }
    case 'bbUpper':
      return short ? 'BB+' : 'BB상단'
    case 'bbLower':
      return short ? 'BB-' : 'BB하단'
    case 'poc':
      return short ? 'POC' : '매물대'
  }
}

/** 가격축 라벨 — 넓게: [저항] 20선 / 좁게: 저항 20 (가격 숫자는 축 라벨에 이미 있음) */
export function srAxisTitle(level: SrLevel, maPeriods: readonly number[], short: boolean): string {
  const role = level.role === 'support' ? '지지' : '저항'
  const name = srName(level.key, maPeriods, short)
  return short ? `${role} ${name}` : `[${role}] ${name}`
}

/** 다시 그릴지 판단용 — 키·역할·호가 반올림 가격이 같으면 같은 서명 */
export function srSignature(levels: SrLevel[]): string {
  return levels.map((l) => `${l.key}:${l.role}:${roundToTick(l.price)}`).join('|')
}
```

- [ ] **9-4: `web_client/src/lib/srWatch.ts`**

```ts
// 지지·저항 터치·돌파·이탈 감지(화면 안) — I/O 없는 상태 객체(설계 2026-10-27 §5). 앱 sr-watch.ts 와 같은 코드.
// 선마다 '마지막으로 띠 밖에서 머문 쪽'을 기억해, 띠(±오차)에 들어오면 터치, 반대쪽으로 넘어가면 돌파·이탈.
import { formatPrice } from './format'
import { krxTick } from './krxTick'
import type { SrKey, SrLevel } from './srLevels'

export const SR_COOLDOWN_MS = 600_000 // 같은 선·같은 이벤트 재알림 간격(10분)
export const SR_EPS_RATIO = 0.0015 // 오차 = max(호가 단위, 선 가격 × 0.15%)

export type SrEventType = 'SUPPORT_TOUCH' | 'SUPPORT_BREAKDOWN' | 'RESISTANCE_TOUCH' | 'RESISTANCE_BREAKOUT'

export interface SrEvent {
  type: SrEventType
  key: SrKey
  levelPrice: number
  price: number
}

export type SrZone = 'above' | 'below' | 'near'
type Side = 'above' | 'below'

export const srEps = (level: number): number => Math.max(krxTick(level), level * SR_EPS_RATIO)

export function zoneOf(price: number, level: number): SrZone {
  const eps = srEps(level)
  if (price > level + eps) return 'above'
  if (price < level - eps) return 'below'
  return 'near'
}

function classify(lastSide: Side | null, zone: SrZone): SrEventType | null {
  if (lastSide === null) return null
  if (zone === 'near') return lastSide === 'above' ? 'SUPPORT_TOUCH' : 'RESISTANCE_TOUCH'
  if (zone === 'below' && lastSide === 'above') return 'SUPPORT_BREAKDOWN'
  if (zone === 'above' && lastSide === 'below') return 'RESISTANCE_BREAKOUT'
  return null
}

export class SrWatcher {
  private state = new Map<SrKey, { zone: SrZone; lastSide: Side | null }>()
  private fired = new Map<string, number>() // `${key}:${type}` → 마지막 발생 시각

  /** 틱마다 호출 — 이번 틱에 생긴 이벤트(대개 0~1개) */
  update(levels: SrLevel[], price: number, nowMs: number): SrEvent[] {
    const out: SrEvent[] = []
    const seen = new Set<SrKey>()
    for (const lv of levels) {
      seen.add(lv.key)
      const zone = zoneOf(price, lv.price)
      const prev = this.state.get(lv.key)
      if (prev === undefined) {
        // 처음 보는 선 — 기준만(화면을 연 직후·칩을 켠 직후에 모달이 뜨지 않게)
        this.state.set(lv.key, { zone, lastSide: zone === 'near' ? null : zone })
        continue
      }
      if (zone !== prev.zone) {
        const type = classify(prev.lastSide, zone)
        if (type !== null && this.take(`${lv.key}:${type}`, nowMs)) {
          out.push({ type, key: lv.key, levelPrice: lv.price, price })
        }
      }
      this.state.set(lv.key, { zone, lastSide: zone === 'near' ? prev.lastSide : zone })
    }
    for (const k of [...this.state.keys()]) if (!seen.has(k)) this.state.delete(k)
    return out
  }

  /** 포지션 없음·화면 벗어남 — 다음 update 부터 기준을 새로 잡는다(재알림 간격 기록은 유지) */
  reset(): void {
    this.state.clear()
  }

  private take(id: string, nowMs: number): boolean {
    const last = this.fired.get(id)
    if (last !== undefined && nowMs - last < SR_COOLDOWN_MS) return false
    this.fired.set(id, nowMs)
    return true
  }
}

export interface SrCopy {
  title: string
  body: string
}

/** 대응 모달 문구(원 문서 03 §4 기반). name = 넓은 화면 이름(20선·BB상단·매물대) */
export function srEventCopy(type: SrEventType, name: string, levelPrice: number): SrCopy {
  const at = `${name}(${formatPrice(Math.round(levelPrice))}원)`
  switch (type) {
    case 'RESISTANCE_TOUCH':
      return { title: `🔔 [저항선 도달] ${at} 터치`, body: '매물 압박으로 단기 조정이 나올 수 있어요.' }
    case 'RESISTANCE_BREAKOUT':
      return { title: `🚀 [저항선 돌파] ${at} 상향 돌파`, body: '저항이 뚫리면 다음엔 지지선이 될 수 있어요.' }
    case 'SUPPORT_TOUCH':
      return { title: `🔔 [지지선 도달] ${at} 터치`, body: '반등이 나올 수 있는 자리예요.' }
    case 'SUPPORT_BREAKDOWN':
      return { title: `⚠️ [지지선 이탈] ${at} 하향 이탈`, body: '지지가 깨지면 추가 하락 위험이 커요.' }
  }
}
```

- [ ] **9-5: 확인과 커밋**

```bash
cd web_client && npx tsc --noEmit -p tsconfig.json && npx eslint src/lib/krxTick.ts src/lib/closeAction.ts src/lib/srLevels.ts src/lib/srWatch.ts
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/lib/krxTick.ts web_client/src/lib/closeAction.ts web_client/src/lib/srLevels.ts web_client/src/lib/srWatch.ts
git commit -m "feat(web): 지지·저항 고르기·감지기·손익 버튼 순수 함수(앱과 같은 규칙)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```
예상: 타입·린트 오류 없음.

---

### 작업 10: 웹 매물대 — POC 점과 `onPocChange`

**파일:**
- 수정: `web_client/src/lib/volumeProfile.ts`

- [ ] **10-1: `pocPrice` 추가** — `volumeProfile` 함수 바로 아래에

```ts

/** 거래량 가장 큰 칸의 가운데 가격(같으면 아래 칸). 칸이 없으면 null — 지지·저항 후보(POC) */
export function pocPrice(bins: VolumeBin[]): number | null {
  let best: VolumeBin | null = null
  for (const b of bins) if (b.volume > 0 && (best === null || b.volume > best.volume)) best = b
  return best === null ? null : (best.low + best.high) / 2
}

const POC_RESIST = '#f59e0b' // POC 가 현재가 위(저항)
const POC_SUPPORT = '#8b5cf6' // POC 가 현재가 아래(지지)
```

- [ ] **10-2: 프리미티브에 콜백과 점 추가** — `class VolumeProfilePrimitive`

필드 `private visible = true` 아래에:
```ts
  /** 보이는 구간 POC 가 바뀌면(끄면 null) — 그리기 중 React 상태를 바꾸지 않게 다음 프레임에 부른다 */
  onPocChange: ((price: number | null) => void) | null = null
  private sentPoc: number | null | undefined = undefined

  private reportPoc(poc: number | null) {
    if (poc === this.sentPoc) return
    this.sentPoc = poc
    const cb = this.onPocChange
    if (cb) requestAnimationFrame(() => cb(poc))
  }
```
`setVisible` 본문을
```ts
  setVisible(visible: boolean) {
    this.visible = visible
    if (!visible) this.reportPoc(null)
    this.param?.requestUpdate()
  }
```
로 바꾼다. `draw` 의 `if (bins.length === 0) return` 을
```ts
    if (bins.length === 0) {
      this.reportPoc(null)
      return
    }
```
로 바꾸고, `target.useMediaCoordinateSpace(({ context, mediaSize }) => { ... })` 블록을 아래로 바꾼다(막대는 그대로, 끝에 POC 점):
```ts
    const poc = pocPrice(bins)
    const last = this.points[this.points.length - 1].close
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const style = mediaSize.width < VP_NARROW_PX ? VP_NARROW : VP_WIDE
      context.fillStyle = style.color
      for (const b of bins) {
        const yHigh = p.series.priceToCoordinate(b.high)
        const yLow = p.series.priceToCoordinate(b.low)
        if (yHigh === null || yLow === null || b.volume === 0) continue
        const w = (b.volume / maxVol) * mediaSize.width * style.maxWidth
        context.fillRect(0, Math.min(yHigh, yLow), w, Math.max(1, Math.abs(yLow - yHigh) - 1))
      }
      // POC 칸 막대 오른쪽 끝(= 최대 폭)에 점 — 현재가 위면 주황(저항), 아래면 보라(지지)
      const y = poc === null ? null : p.series.priceToCoordinate(poc)
      if (poc !== null && y !== null) {
        context.fillStyle = poc >= last ? POC_RESIST : POC_SUPPORT
        context.beginPath()
        context.arc(mediaSize.width * style.maxWidth, y, 3, 0, Math.PI * 2)
        context.fill()
      }
    })
    this.reportPoc(poc)
```

- [ ] **10-3: 확인과 커밋**

```bash
cd web_client && npx tsc --noEmit -p tsconfig.json && npx eslint src/lib/volumeProfile.ts
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/lib/volumeProfile.ts
git commit -m "feat(web): 매물대 POC 점과 POC 변경 콜백

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 11: 웹 게임 차트 — 지지·저항 선과 목록 올리기

**파일:**
- 수정: `web_client/src/components/game/TradingChart.tsx`

- [ ] **11-1: import·상수** — 파일 위

`import { VolumeProfilePrimitive } from '../../lib/volumeProfile'` 아래에 추가:
```ts
import { lastSrValues, pickSrLevels, srAxisTitle, srCandidates, srSignature, type SrLevel } from '../../lib/srLevels'
```
`const BB_FILL = ...` 줄 아래에 추가:
```ts
const SR_NARROW_PX = 640 // 차트 폭이 이보다 좁으면 지지·저항 라벨을 짧게(매물대 좁은 화면 기준과 같은 값)
```

- [ ] **11-2: props** — `TradingChartProps` 인터페이스의 `position` 아래에 추가

```ts
  /** 차트에 그린 지지·저항 목록(바뀔 때만) — 게임 화면이 터치·돌파 감지에 쓴다 */
  onSrLevels?: (levels: SrLevel[]) => void
```
함수 시그니처를 `export default function TradingChart({ ticker, lastPrice, coach, position, onSrLevels }: TradingChartProps) {` 로 바꾼다.

- [ ] **11-3: ref·상태** — `const vpRef = ...` 줄 아래에 추가

```ts
  const srLinesRef = useRef<IPriceLine[]>([]) // 지지·저항 라벨선
  const srSigRef = useRef('') // 마지막으로 그린 지지·저항 서명(같으면 다시 그리지 않음)
  const [poc, setPoc] = useState<number | null>(null) // 보이는 구간 매물대 POC(매물대 켜짐일 때)
```

- [ ] **11-4: 차트 생성에 콜백 연결** — 1) effect 의 `vpRef.current = vp` 아래에

```ts
    vp.onPocChange = setPoc
```
같은 effect 의 cleanup(`return () => { ... }`)에서 `linesRef.current = []` 아래에 추가:
```ts
      srLinesRef.current = []
      srSigRef.current = ''
```

- [ ] **11-5: 지지·저항 선 effect** — 3) 가격선 effect(`}, [support, resistance, entry, side, stopLoss, takeProfit, loaded, interval])`) 바로 아래에 추가

```ts
  // 3-1) 지지·저항(설계 2026-10-27 §3·§4) — 켜진 지표의 마지막 값 + 보이는 구간 POC 중 현재가 위·아래 2개씩.
  // 키·역할·호가 반올림 가격(+좁은 화면 여부)이 같으면 다시 그리지 않는다(틱마다 가격선을 지웠다 만들지 않게)
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !loaded) return
    const closes = barsRef.current.map((b) => b.close)
    const price = lastPrice ?? closes[closes.length - 1]
    const levels = price === undefined
      ? []
      : pickSrLevels(srCandidates({
          values: lastSrValues(closes),
          ma: showMa,
          bb: showBb,
          poc: showVp ? poc : null,
          maColors: MA_PERIODS.map((p) => MA_COLORS[p]),
        }, price), price)
    const narrow = (boxRef.current?.clientWidth ?? 0) < SR_NARROW_PX
    const sig = `${srSignature(levels)}#${narrow}`
    if (sig === srSigRef.current) return
    srSigRef.current = sig
    for (const l of srLinesRef.current) series.removePriceLine(l)
    srLinesRef.current = levels.map((l) => series.createPriceLine({
      price: l.price, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,
      title: srAxisTitle(l, MA_PERIODS, narrow),
    }))
    onSrLevels?.(levels)
  }, [lastPrice, loaded, showMa, showBb, showVp, poc, interval, ticker, onSrLevels])
```

- [ ] **11-6: 확인과 커밋**

```bash
cd web_client && npx tsc --noEmit -p tsconfig.json && npx eslint src/components/game/TradingChart.tsx
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/components/game/TradingChart.tsx
git commit -m "feat(web): 게임 차트에 가까운 지지·저항 4개 점선·가격축 라벨, 목록을 화면에 올림

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```
예상: 타입 오류 없음. 린트는 경고(`set-state-in-effect` 등) 이하.

---

### 작업 12: 웹 — 손익 버튼·대응 모달·게임 페이지 연결

**파일:**
- 수정: `web_client/src/components/game/ActivePositionCard.tsx`
- 생성: `web_client/src/components/game/SrActionModal.tsx`
- 수정: `web_client/src/pages/GamePage.tsx`

- [ ] **12-1: 손익 버튼** — `ActivePositionCard.tsx`

import 에 추가:
```ts
import { closeActionClass, closeActionOf } from '../../lib/closeAction'
```
함수 본문 `const slTp = ...` 아래에:
```ts
  // 손익에 따라 익절/손절 — 색은 손익 글자와 같은 상승·하락 색(사유는 서버가 체결 가격으로 정함)
  const action = closeActionOf(position.pnl_amount)
```
버튼 안 글자 `즉시 전액 청산하기` 를
```tsx
        <span className={closeActionClass(action.kind)}>{action.label}</span>
```
로 바꾸고, 파일 주석 `원클릭 전액 청산.` 을 `손익에 따라 익절/손절 원클릭 전액 청산.` 으로 바꾼다.

- [ ] **12-2: 대응 모달** — `web_client/src/components/game/SrActionModal.tsx`

```tsx
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { closeActionClass, closeActionOf } from '../../lib/closeAction'
import { formatPct, formatSignedKrw, pnlClass } from '../../lib/format'
import { srEventCopy, type SrEvent } from '../../lib/srWatch'
import type { Position } from '../../types/game'

interface SrActionModalProps {
  event: SrEvent
  /** 넓은 화면 이름(20선·BB상단·매물대) */
  name: string
  position: Position
  closing: boolean
  onClosePosition: () => void
  onHold: () => void
  onDismiss: () => void
}

// 지지·저항 대응 모달 — [💰 익절하기 / 🛡️ 손절하기] vs [✊ 홀딩](설계 2026-10-27 §7).
// 이벤트 데이터만 받는다(나중에 푸시를 눌러 들어올 때도 같은 모달).
export default function SrActionModal({ event, name, position, closing, onClosePosition, onHold, onDismiss }: SrActionModalProps) {
  const copy = srEventCopy(event.type, name, event.levelPrice)
  const action = closeActionOf(position.pnl_amount)
  return (
    <Modal title={copy.title} description={copy.body} onClose={onDismiss} narrow>
      <p className="text-sm text-ink-muted">
        현재 평가손익{' '}
        <span className={`font-bold tabular-nums ${pnlClass(position.pnl_amount)}`}>
          {position.pnl_amount !== null ? formatSignedKrw(position.pnl_amount) : '—'}
          {position.roi_pct !== null && ` (${formatPct(position.roi_pct)})`}
        </span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClosePosition} loading={closing} loadingText="청산 중…">
          <span className={closeActionClass(action.kind)}>{action.label}</span>
        </Button>
        <Button variant="secondary" onClick={onHold}>✊ 홀딩</Button>
      </div>
    </Modal>
  )
}
```

- [ ] **12-3: 게임 페이지 연결** — `web_client/src/pages/GamePage.tsx`

(1) 첫 줄 `import { useEffect, useState } from 'react'` 를 `import { useEffect, useRef, useState } from 'react'` 로 바꾸고, `import NudgeToaster from '../components/game/NudgeToaster'` 아래에 추가:
```ts
import SrActionModal from '../components/game/SrActionModal'
import { MA_PERIODS } from '../lib/indicators'
import { srName, type SrLevel } from '../lib/srLevels'
import { SrWatcher, type SrEvent } from '../lib/srWatch'
```

(2) `const [activeModal, setActiveModal] = useState<ActiveModal>(null)` 아래에 추가(`loginOpen` 은 그 바로 위 줄에서 선언된다):
```ts
  const pushToast = useTradingGameStore((s) => s.pushToast)

  // 지지·저항 대응(설계 2026-10-27 §7) — 포지션 보유 + 페이지가 보이는 중일 때만 틱마다 감지.
  // 조건이 빠지면 reset(돌아왔을 때 그사이 움직임으로 모달이 바로 뜨지 않게 기준부터)
  const [srLevels, setSrLevels] = useState<SrLevel[]>([])
  const [srEvent, setSrEvent] = useState<SrEvent | null>(null)
  const watcherRef = useRef(new SrWatcher())
  const hasPosition = position !== null
  useEffect(() => {
    const w = watcherRef.current
    if (!loggedIn || !hasPosition || lastPrice === null || document.visibilityState !== 'visible') {
      w.reset()
      return
    }
    const events = w.update(srLevels, lastPrice, Date.now())
    // 다른 모달이 열려 있으면 버린다(재알림 간격은 이미 적용됨)
    if (events.length > 0 && activeModal === null && !loginOpen) setSrEvent((cur) => cur ?? events[0])
  }, [lastPrice, srLevels, hasPosition, loggedIn, activeModal, loginOpen])
  useEffect(() => {
    if (!hasPosition) setSrEvent(null)
  }, [hasPosition])
```
(이 파일은 이미 `useTradingGameStore` 를 import 한다.)

(3) `<TradingChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />` 를
```tsx
          <TradingChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} onSrLevels={setSrLevels} />
```
로 바꾼다.

(4) `{activeModal === 'streak' && <StreakRewardModal onClose={closeModal} />}` 아래에 추가:
```tsx
      {srEvent !== null && position !== null && (
        <SrActionModal
          event={srEvent}
          name={srName(srEvent.key, MA_PERIODS, false)}
          position={position}
          closing={closing}
          onClosePosition={() => {
            setSrEvent(null)
            void closePosition()
          }}
          onHold={() => {
            setSrEvent(null)
            pushToast({ kind: 'info', icon: '✊', message: '홀딩을 선택했어요. 다음 지지·저항에서 다시 알려 드릴게요.' })
          }}
          onDismiss={() => setSrEvent(null)}
        />
      )}
```

- [ ] **12-4: 확인과 커밋**

```bash
cd web_client && npx tsc --noEmit -p tsconfig.json && npx eslint src/pages/GamePage.tsx src/components/game/SrActionModal.tsx src/components/game/ActivePositionCard.tsx && npx vite build --mode development
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add web_client/src/components/game/ActivePositionCard.tsx web_client/src/components/game/SrActionModal.tsx web_client/src/pages/GamePage.tsx
git commit -m "feat(web): 손익 청산 버튼과 지지·저항 도달 대응 모달 — 익절·손절 vs 홀딩

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```
예상: 빌드 성공(`npm run build` 는 로컬 `.env.production` 이 없어 필수 env 검사로 실패하는 것이 정상 — `--mode development` 로 확인).

---

### 작업 13: 화면 확인·전체 회귀·머지

- [ ] **13-1: 전체 테스트**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app/backend && uv run pytest -q
cd ../mobile && npx tsc --noEmit && npx jest
cd ../web_client && npx tsc --noEmit -p tsconfig.json && npx vite build --mode development
```
예상: 모두 통과.

- [ ] **13-2: 앱 차트 페이지 화면 확인(헤드리스)**

스크래치패드의 `vp/build-page.mjs`(생성 파일로 HTML 조립)와 `vp/shot-vp.mjs`(360×260 캡처)를 쓴다. `shot-vp.mjs` 의 `vis` 메시지 뒤에 지지·저항 선을 보낸다:
```js
await msg({ type: 'lines', lines: [
  { price: bars[bars.length - 1].close * 1.03, color: '#f97316', width: 1, dashed: true, title: '20선', axisTitle: '저항 20' },
  { price: bars[bars.length - 1].close * 0.97, color: '#8b5cf6', width: 1, dashed: true, title: '매물대', axisTitle: '지지 POC' },
] })
```
그리고 `window.__posts`(페이지 → RN 메시지 기록)를 `Page.addScriptToEvaluateOnNewDocument` 로 심어 `{type:'poc', price:<숫자>}` 가 왔는지 출력한다. 확인할 것: 가격축에 `저항 20`·`지지 POC` 이름, 매물대 POC 점, `poc` 메시지 1회 이상.

- [ ] **13-3: 웹 화면 확인(헤드리스)**

로컬 웹(3000)의 `/game` 이 게임 서버 연결 실패로 열리지 않으면(로컬 DB 터널 끊김), 임시 하네스 페이지(커밋하지 않음)에 `VolumeProfilePrimitive` + `pickSrLevels` 결과 가격선을 그려 폭 360·900 에서 라벨(짧게/길게)과 POC 점을 찍어 확인하고, 하네스는 지운다. 대응 모달은 하네스에서 `SrActionModal` 에 가짜 `SrEvent`·`Position` 을 넣어 띄워 본다.

- [ ] **13-4: dev 에 머지**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git switch dev
git merge --no-ff ui/game-sr-actions -m "Merge ui/game-sr-actions: [UI] 차트 게임 지지·저항 라벨·POC, 손익 청산 버튼, 대응 시트"
git branch -d ui/game-sr-actions
```

- [ ] **13-5: 사용자 확인 요청** — 실기기·운영 확인은 사용자 몫: 장중 게임 화면에서 포지션을 잡고 지지·저항 근처에서 시트가 뜨는지, [홀딩] 토스트, [익절하기/손절하기] 청산 뒤 거래 기록 사유. main 머지·배포·OTA 는 사용자가 "머지해줘"·"배포해줘" 할 때.
