# 차트 게임 지지·저항 표시와 손절·익절·홀딩 대응 설계 (A+B)

- 날짜: 2026-10-27
- 출발 문서: `docs/chart_game/README.md`, `01`~`04` (특히 `04_claude_code_implementation_guide.md`)
- 범위: 원 문서의 네 덩어리 중 **A(차트 지지·저항 표시)** + **B(손익 청산 버튼·청산 사유·화면 안 대응 시트)**
- 뒤로 미룬 것: **C(서버 지표 계산·터치 감지·푸시·`game_notice`)**, **D(칭호·퀘스트)** — 각각 별도 설계

## 1. 목표

포지션을 연 뒤에도 사용자가 "지지·저항에 닿았을 때 어떻게 대응할지"를 고르게 한다.

- 차트에 지금 가격 기준으로 가까운 지지선 2개·저항선 2개를 라벨로 보여 준다.
- 청산 버튼을 손익에 따라 **[💰 익절하기]** / **[🛡️ 손절하기]** 로 바꾸고, 서버에 청산 사유를 나눠 남긴다.
- 게임 화면을 보고 있을 때 가격이 그 선에 닿거나 뚫으면 **대응 시트**를 띄워 [익절·손절] 과 [✊ 홀딩] 중 고르게 한다.

## 2. 원 문서와 달라진 점 (코드 대조 결과)

| 원 문서 | 실제 코드·이번 결정 |
|---|---|
| 손절·익절·홀딩 3버튼 | 손익 부호로 이름·색이 바뀌는 버튼 1개. 홀딩은 대응 시트에만 |
| 화면이 `reason: MANUAL_SL/TP` 를 보냄 | 요청 형식 그대로, **서버가 체결 가격으로 사유 결정**(옛 앱 호환·조작 불가) |
| `HOLD_ACTION` 청산 사유 | 홀딩은 청산이 아니므로 사유로 쓰지 않음. 서버 기록 없음 |
| 감지 코드: 현재가가 선 위/아래인지로 지지·저항 분류 | 선 바로 아래(오차 안)에 닿으면 지지 터치를 놓치는 빈틈 → **선별 "마지막으로 머문 쪽"** 상태로 판정(5절) |
| 오차 `max(1원, 0.15%)` | `max(KRX 호가 단위, 0.15%)` — 원 문서 02 의 정의 |
| 청산 버튼 위치 `OrderPanel` / `order-panel` | 실제는 웹 `ActivePositionCard.tsx`, 앱 `position-card.tsx` |
| 서버가 이평·볼린저·POC 로 감지 | 서버에는 그 계산이 없음 → 이번엔 화면에서 감지, 서버 감지는 C |

## 3. 지지·저항 목록 (A)

### 3.1 후보

차트에서 **켜져 있는 지표**만 후보로 쓴다(지표 칩과 같은 기준).

| 키 | 지표 | 켜짐 조건 | 이름(넓은 / 좁은) |
|---|---|---|---|
| `ma5`·`ma20`·`ma60` | 이동평균(첫째·둘째·셋째 칸) | 이동평균 칩 | `5선` / `5` 등 기간 숫자 |
| `bbUpper`·`bbLower` | 볼린저 상단·하단 | 볼린저 칩 | `BB상단`·`BB하단` / `BB+`·`BB-` |
| `poc` | 매물대 최대 거래량 칸의 가운데 가격(보이는 구간) | 매물대 칩 | `매물대` / `POC` |

- 볼린저 중심선은 20선과 같은 값이라 뺀다.
- 지표 값은 **마지막 캔들의 값**(분봉이면 진행 중인 봉 포함)이다.
- 이평 기간 숫자는 화면이 쓰는 기간(`MA_PERIODS` 또는 `maPeriods`)에서 가져온다.

### 3.2 고르기 — 순수 함수 `pickSrLevels`

```
입력: candidates[{ key, price, color }], lastPrice
출력: [{ key, price, color, role: 'support' | 'resistance' }]  (최대 4개)
```

- `price > lastPrice` 면 저항, `price < lastPrice` 면 지지, 같으면 저항으로 본다.
- 저항은 가격 오름차순 앞 2개, 지지는 내림차순 앞 2개를 고른다(현재가에서 가까운 순).
- 가격이 같은 후보(예: 5선과 POC 가 같은 값)는 앞 순서(`ma5`→`ma20`→`ma60`→`bbUpper`→`bbLower`→`poc`) 하나만 남긴다.
- `NaN`, 0 이하 값은 버린다.

위치: 웹 `web_client/src/lib/srLevels.ts`, 앱 `mobile/src/features/game/lib/sr-levels.ts`.
지금 지표 코드가 웹·앱에 같은 규칙으로 따로 있는 방식을 따른다.

### 3.3 POC 찾기

- 웹 `lib/volumeProfile.ts` 에 `pocPrice(bins)` 를 추가한다. 거래량이 가장 큰 칸의 `(low+high)/2` 를 돌려주고, 칸이 없으면 `null` 이다.
- 같은 거래량이면 아래 칸을 고른다.
- 앱은 매물대를 차트 페이지(WebView)가 계산하므로, 페이지에 같은 함수를 둔다(4.2).

## 4. 차트 표시 (A)

### 4.1 웹 `TradingChart.tsx`

- 기존 가격선 effect(`linesRef`, 코치 지지·저항, 진입·손절·익절)는 그대로 둔다.
- 지지·저항 라벨선은 **따로 관리하는 가격선 묶음**으로 추가한다.
  - `createPriceLine({ price, color: 지표색, lineWidth: 1, lineStyle: Dotted, axisLabelVisible: true, title })`
  - `title` 예: `[저항] 20선`, `[지지] 매물대`
  - 차트 폭 640px 미만이면 짧은 형식(`저항 20`, `지지 POC`)을 쓴다. 매물대의 좁은 화면 기준과 같은 값이다.
- 다시 그리는 때: 지표 칩 상태, 새 캔들·틱(마지막 지표 값), 보이는 구간 변경(POC)이 바뀔 때.
  - 틱마다 다시 만들지 않는다. 고른 결과(키·역할·호가 반올림 가격)가 바뀔 때만 교체한다.
- `VolumeProfilePrimitive`:
  - POC 칸 막대 오른쪽 끝에 지름 6px 점을 찍는다. 색은 POC 가 현재가 위면 `#f59e0b`, 아래면 `#8b5cf6` 이다(원 문서 01 §3.1).
  - 보이는 구간 POC 가 바뀌면 `onPocChange(price | null)` 콜백으로 알린다. 그리기 중에는 값만 기록하고, 콜백은 `requestAnimationFrame` 으로 미뤄 그리기 루프 안에서 React 상태를 바꾸지 않는다.

### 4.2 앱 차트 페이지 (`chart-page-script.ts`)

- 새 메시지(페이지 → 앱): `{ type: 'poc', price: number | null }`.
  - 매물대가 켜져 있고 보이는 구간 POC 가 바뀔 때만 보낸다. 끄면 `null` 을 한 번 보낸다.
  - `PageEvent` 타입(`lib/chart-bridge.ts`)에 추가한다.
- POC 점 그리기는 웹과 같다. 현재가는 페이지가 가진 마지막 봉 종가를 쓴다.
- 지지·저항 라벨선은 기존 `lines` 메시지로 그린다.
  - `ChartLine` 에 선택 필드 `title?: string`, `dotted?: boolean` 을 추가한다. 지금 페이지는 `title: ''` 고정이므로 `spec.title ?? ''` 로 바꾼다.
  - 앱 화면(`candle-chart.tsx`)이 `priceLines(...)` 결과 뒤에 지지·저항 선을 붙여 보낸다. 지지·저항 선은 `fit` 없음(자동 범위에 넣지 않음).
- 원본 수정 뒤 `npm run gen:chart-page` 로 `page-script.generated.ts` 를 다시 만든다(생성 일치 테스트가 잡음).

### 4.3 라벨 문구

| 역할 | 넓은 화면 | 좁은 화면(웹 640px 미만, 앱 항상) |
|---|---|---|
| 저항 | `[저항] 20선` | `저항 20` |
| 지지 | `[지지] 매물대` | `지지 POC` |

가격 숫자는 가격축 라벨에 이미 나오므로 `title` 에 넣지 않는다.

## 5. 화면 안 감지 — 순수 함수 `SrWatcher`

웹 `lib/srWatch.ts`, 앱 `features/game/lib/sr-watch.ts`. I/O 없는 상태 객체.

```
watcher.update(levels: SrLevel[], price: number, nowMs: number): SrEvent[]
SrEvent = { type, key, levelPrice, price }
type = 'SUPPORT_TOUCH' | 'SUPPORT_BREAKDOWN' | 'RESISTANCE_TOUCH' | 'RESISTANCE_BREAKOUT'
```

- 오차 `eps = max(krxTick(level), level × 0.0015)`. `krxTick` 은 백엔드 `sr_levels.krx_tick` 과 같은 표로 웹·앱 `lib` 에 둔다.
- 선마다 상태 `zone` 은 `'above' | 'below' | 'near'` 이고, `lastSide` 는 `'above' | 'below'`(마지막으로 띠 밖에서 머문 쪽)이다.
  - `price > level + eps` → above, `price < level - eps` → below, 그 사이 → near.
- 판정(새 zone 이 이전과 다를 때만):
  - 밖 → near: `lastSide` 가 above 면 **SUPPORT_TOUCH**, below 면 **RESISTANCE_TOUCH**.
  - near 또는 반대쪽 → below 이고 `lastSide` 가 above: **SUPPORT_BREAKDOWN**.
  - near 또는 반대쪽 → above 이고 `lastSide` 가 below: **RESISTANCE_BREAKOUT**.
  - near → 원래 쪽으로 돌아감: 이벤트 없음.
- 같은 `key` + `type` 은 **10분**(600,000ms) 안에 다시 내보내지 않는다.
- 처음 보는 선(목록에 새로 들어온 키)은 그 순간 zone 만 기록하고 이벤트를 내지 않는다. 화면을 연 직후나 칩을 켠 직후에 시트가 뜨지 않게 하기 위해서다. 처음 zone 이 near 면 `lastSide` 는 아직 없고, 띠 밖으로 나간 뒤부터 판정한다.
- 키별 레벨 가격이 바뀌어도(이평이 움직임) 상태는 키 기준으로 유지한다.
- 목록에서 빠진 키의 상태는 버린다.

## 6. 손익 청산 버튼과 청산 사유 (B)

### 6.1 화면

- 웹 `ActivePositionCard.tsx`, 앱 `position-card.tsx` 의 **[즉시 전액 청산하기]** 를 손익 버튼으로 바꾼다.
  - `pnl_amount >= 0` 이면 **💰 익절하기**, 음수면 **🛡️ 손절하기** 이다.
  - `pnl_amount` 가 `null`(아직 틱 없음)이면 **청산하기** 이다.
  - 색은 손익 글자와 같은 상승·하락 색이다(한국식: 이익 = 상승색, 손실 = 하락색). 웹은 `pnlClass` 계열, 앱은 `theme.colors.up/down`.
  - 로딩 문구(`청산 중…`)와 비활성 조건은 지금 그대로다.
- 버튼 이름·색을 정하는 순수 함수 `closeActionOf(pnl)` → `{ kind: 'tp' | 'sl' | 'neutral', label }` 를 웹·앱 `lib` 에 둔다.

### 6.2 서버 (`routers/orders.py` `close_order`)

- 요청 형식은 바꾸지 않는다(본문 없음).
- **사유 계산 함수**를 둔다.
  - `manual_close_reason(side, entry_price, exit_price) -> "MANUAL_TP" | "MANUAL_SL"`: LONG 은 `exit > entry`, SHORT 는 `exit < entry` 면 TP, 아니면 SL.
  - 위치: `services/pricing.py`(기존 `liquidation_reason` 옆, 순수 함수).
  - 체결 가격(`exit_price`)은 청산 전에 이미 정해지므로(`_require_fresh_price`) 청산 전에 계산할 수 있다.
  - 수수료 때문에 아주 작은 이익이 손실이 될 수 있지만, 사용자가 본 "가격 방향"과 맞추는 쪽을 택한다.
- `close_position(..., reason=manual_close_reason(...))`, `_close_nudges(reason, roi)` 로 바꾼다.
- `nudge_engine._PRAISE_REASONS` 를 `{"STOP_LOSS", "MANUAL", "MANUAL_SL", "MANUAL_TP"}` 로 바꾼다.
  - 칭찬은 ROI −3~−1% 일 때만이라 지금과 같은 결과가 나온다.
  - 옛 `MANUAL` 은 기존 기록과 호환되도록 남긴다.
- 컬럼(`closed_reason String(20)`)·마이그레이션 변경 없음. 랭킹·정산·주문 엔진 로직 변경 없음.

## 7. 대응 시트 (B)

### 7.1 언제 뜨나

- 조건: 로그인, 보유 포지션 있음, 게임 화면이 앞에 있음(앱은 탭 포커스, 웹은 페이지 표시 중), 시트·다른 모달이 열려 있지 않음.
- `SrWatcher` 가 이벤트를 내면 가장 먼저 나온 1개만 띄운다. 시트가 열려 있는 동안 생긴 이벤트는 버린다(10분 간격은 그대로 적용).
- 감지 입력: 틱마다 `lastPrice` 와 현재 지지·저항 목록(4절과 같은 목록).

### 7.2 내용

이벤트별 문구(원 문서 03 §4 기반):

| 이벤트 | 제목 | 안내 |
|---|---|---|
| RESISTANCE_TOUCH | 🔔 [저항선 도달] {이름}({가격}원) 터치 | 매물 압박으로 단기 조정이 나올 수 있어요. |
| RESISTANCE_BREAKOUT | 🚀 [저항선 돌파] {이름}({가격}원) 상향 돌파 | 저항이 뚫리면 다음엔 지지선이 될 수 있어요. |
| SUPPORT_TOUCH | 🔔 [지지선 도달] {이름}({가격}원) 터치 | 반등이 나올 수 있는 자리예요. |
| SUPPORT_BREAKDOWN | ⚠️ [지지선 이탈] {이름}({가격}원) 하향 이탈 | 지지가 깨지면 추가 하락 위험이 커요. |

- 둘째 줄에 현재 평가손익(₩, %)을 보여 준다. 포지션 방향(LONG/SHORT)은 문구에 넣지 않는다. 같은 이벤트라도 방향에 따라 유불리가 다르므로, 판단은 손익 표시로 한다.
- {이름}은 넓은 화면 라벨 이름(`20선`, `BB상단`, `매물대`)을 쓴다.
- 버튼은 둘이다.
  - 왼쪽: 6.1 과 같은 손익 버튼(💰 익절하기 / 🛡️ 손절하기). 누르면 기존 `closePosition()` 을 부르고 시트를 닫는다.
  - 오른쪽: **✊ 홀딩**. 시트를 닫고 토스트 "홀딩을 선택했어요. 다음 지지·저항에서 다시 알려 드릴게요."를 띄운다. 서버 호출 없음.
- 청산 중 오류는 기존 청산 오류 처리(토스트)를 그대로 쓴다.
- 시트 컴포넌트는 **이벤트 데이터(`SrEvent` + 이름)만 받는다**. C 에서 푸시를 눌러 들어올 때도 같은 시트를 쓰기 위해서다.
  - 웹: `components/game/SrActionModal.tsx`(기존 모달 패턴)
  - 앱: `features/game/components/sr-action-sheet.tsx`(기존 `Sheet` 사용)

## 8. 파일 목록

| 영역 | 파일 | 변경 |
|---|---|---|
| 백엔드 | `apps/trading_game/services/pricing.py` | `manual_close_reason` 추가 |
| | `apps/trading_game/routers/orders.py` | 청산 사유를 위 함수로 |
| | `apps/trading_game/services/nudge_engine.py` | `_PRAISE_REASONS` 확장 |
| 웹 | `lib/srLevels.ts`, `lib/srWatch.ts`, `lib/krxTick.ts`, `lib/closeAction.ts` | 새 순수 함수 |
| | `lib/volumeProfile.ts` | `pocPrice`, POC 점, `onPocChange` |
| | `components/game/TradingChart.tsx` | 지지·저항 라벨선, 감지 연결(콜백으로 이벤트 전달) |
| | `components/game/ActivePositionCard.tsx` | 손익 버튼 |
| | `components/game/SrActionModal.tsx` | 새 대응 모달 |
| | `pages/GamePage.tsx` | 모달 열기·닫기, 홀딩 토스트 |
| 앱 | `features/game/lib/sr-levels.ts`, `sr-watch.ts`, `krx-tick.ts`, `close-action.ts` | 새 순수 함수 |
| | `features/game/lib/chart-bridge.ts` | `ChartLine.title/dotted`, `PageEvent` 에 `poc` |
| | `features/game/chart-web/page/chart-page-script.ts` (+생성 파일) | POC 계산·점·`poc` 메시지, 선 `title` |
| | `features/game/components/tv-chart.tsx`, `candle-chart.tsx` | `poc` 받기, 지지·저항 선 전달, 감지 |
| | `features/game/components/position-card.tsx` | 손익 버튼 |
| | `features/game/components/sr-action-sheet.tsx` | 새 대응 시트 |
| | `app/(tabs)/game.tsx` | 시트 열기·닫기, 홀딩 토스트 |

## 9. 테스트

- 백엔드
  - `manual_close_reason`: LONG·SHORT × 이익·손실·본전(본전 = SL).
  - 청산 API: 이익 청산이면 `closed_reason == "MANUAL_TP"`, 손실이면 `"MANUAL_SL"`. 기존 청산 테스트의 `"MANUAL"` 기대값을 고친다.
  - 넛지: `MANUAL_SL` 로 −2% 청산 시 칭찬이 나옴.
  - 회귀: `test_order_engine.py`, `test_ranking_and_settlement.py`, `test_weekly_ranking.py`, `test_coach_and_nudge.py`.
- 웹·앱 순수 함수(앱은 jest. 웹은 테스트 도구가 없어 앱과 같은 규칙의 함수를 앱 테스트로 검증하고, 웹은 타입 검사·빌드)
  - `pickSrLevels`: 위·아래 2개씩, 같은 가격 중복 제거, 꺼진 지표 제외, 현재가와 같은 값.
  - `SrWatcher`: 위→띠 안(지지 터치), 아래→띠 안(저항 터치), 위→아래 한 번에(이탈), 띠 안→아래(이탈), 띠 안 오르내림(이벤트 없음), 10분 안 반복 억제와 10분 뒤 재발, 처음 보는 선은 이벤트 없음, 호가 단위 경계(예: 50,000원 선의 eps = 100원 vs 0.15% = 75원 → 100원).
  - `krxTick` 경계값, `closeAction` 부호별 결과.
  - 페이지 스크립트 생성 일치 테스트.
- 화면 확인: 헤드리스로 웹 폰 폭·넓은 화면 게임 차트(라벨·POC 점), 앱 차트 페이지(라벨·POC 점·`poc` 메시지)를 찍어 확인. 대응 시트는 감지 함수에 가짜 틱을 넣어 띄워 본다.

## 10. 배포·되돌리기

- 백엔드(청산 사유)는 `feature/` 브랜치, 화면은 `ui/` 브랜치로 나눠 dev 에 합친다. 화면만 되돌릴 수 있게 하기 위해서다.
- 백엔드는 옛 앱과 호환(요청 형식 같음)이므로 먼저 배포해도 된다.
- 앱은 OTA 발행 뒤 사용자에게 반영된다.
