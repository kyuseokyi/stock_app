# 트레이딩 게임 지지·저항 손절·익절·홀딩 경량화 기술 명세 및 구현 플랜

> **목적**: 실시간 트레이딩 게임(`GamePage.tsx`, `game.tsx`)에서 지지·저항선 도달 시 반복적으로 팝업(모달/바텀시트)이 떠서 차트 관람을 방해하고 계속 화면을 지켜보게 만드는 피로감을 해소합니다.  
> **핵심 방향 ([추천 2 + 추천 1 결합])**:
> 1. **중요한 지지·저항선(`20일선 · 매물대 POC · 볼린저 상/하단 · 전고점/전저점`)의 확실한 `돌파(BREAKOUT) / 이탈(BREAKDOWN)` 시에만 딱 1번** 대응 시트를 띄웁니다 (`5일선` 및 단순 `터치(TOUCH)`는 팝업 제외).
> 2. 사용자가 시트에서 **`[✊ 홀딩]`을 한 번 누르면 해당 포지션이 종료될 때까지 추가 팝업을 완전 차단(Mute)**합니다.
> 3. 팝업이 차단된 이후의 이벤트나 자잘한 터치(`TOUCH` / `5일선`)는 **보유 포지션 카드(`ActivePositionCard` / `PositionCard`) 내부의 1줄 텍스트 배너**로만 조용히 표시하여 화면 방해 없이 언제든 원할 때만 익절·손절할 수 있게 합니다.

---

## 0. 기존 코드 보존 원칙 (Zero Deletion & Regression Prevention)

1. **기존 `SrWatcher`, `SrActionModal`, `SrActionSheet`, `touchLevels` 코드 100% 보존**:
   - [`web_client/src/lib/srWatch.ts`](../web_client/src/lib/srWatch.ts) 및 [`mobile/src/features/game/lib/sr-watch.ts`](../mobile/src/features/game/lib/sr-watch.ts)의 기존 감지 알고리즘(`SrWatcher`)과 상수, 그리고 기존 단위 테스트는 **삭제하거나 깨뜨리지 않고 그대로 유지**합니다.
   - 차트 위에 그려지는 가로선(5일선 포함 7종) 역시 기존과 100% 동일하게 그려집니다.
2. **주문 패널(`OrderPanel`) 설정 유지**:
   - 주문 패널의 손절/익절(SL/TP) 입력 방식은 현재 상태를 그대로 유지합니다.

---

## 1. 세부 동작 및 필터링 명세

### 1-1. 팝업(모달/시트) 노출 대상 vs 인라인 1줄 배너 대상 구분

[`srWatch.ts`](../web_client/src/lib/srWatch.ts)(웹) 및 [`sr-watch.ts`](../mobile/src/features/game/lib/sr-watch.ts)(모바일)에 순수 판별 함수 `isMajorSrBreakEvent(event: SrEvent): boolean`을 추가합니다:

| 구분 | 선 종류 (`event.key`) | 이벤트 타입 (`event.type`) | `isMajorSrBreakEvent` 반환값 | 화면 처리 방식 |
| :--- | :--- | :--- | :---: | :--- |
| **핵심 돌파·이탈** | • `20일선` (`ind:ma20`)<br>• `매물대 POC` (`ind:poc`)<br>• `BB 상/하단` (`ind:bbUpper`, `ind:bbLower`)<br>• `전고점/전저점` (`lvl:*`) | `RESISTANCE_BREAKOUT` (상향 돌파)<br>`SUPPORT_BREAKDOWN` (하향 이탈) | **`true`** | **포지션당 최초 1회 팝업 시트 노출**<br>*(이미 `홀딩`을 눌렀다면 포지션 카드 1줄 텍스트로만 표시)* |
| **단순 도달(터치)** | 모든 지지·저항선 | `RESISTANCE_TOUCH` (저항 도달)<br>`SUPPORT_TOUCH` (지지 도달) | **`false`** | 팝업 띄우지 않음 → **보유 포지션 카드 안 1줄 텍스트 배너**로만 조용히 표시 |
| **단기 노이즈 선** | `5일선` (`ind:ma5`) | 모든 이벤트 (`TOUCH` · `BREAKOUT` · `BREAKDOWN`) | **`false`** | 팝업 띄우지 않음 → **보유 포지션 카드 안 1줄 텍스트 배너**로만 조용히 표시 |

```typescript
/**
 * 팝업(모달/바텀시트)을 띄울 만한 '중요 지지·저항의 돌파/이탈'인지 판정하는 순수 함수.
 * - 5일선(ind:ma5)은 현재가와 너무 가까워 장중 노이즈가 많으므로 팝업에서 제외(포지션 카드 1줄 안내로만 표시).
 * - 단순 터치(*_TOUCH)는 제외하고 실제 상향 돌파(RESISTANCE_BREAKOUT)·하향 이탈(SUPPORT_BREAKDOWN)만 팝업 허용.
 */
export function isMajorSrBreakEvent(event: SrEvent): boolean {
  if (event.key === 'ind:ma5') return false
  return event.type === 'RESISTANCE_BREAKOUT' || event.type === 'SUPPORT_BREAKDOWN'
}
```

---

### 1-2. `[✊ 홀딩]` 클릭 시 포지션 단위 팝업 차단 (`mutedPositionId`)

1. **상태 관리 (`GamePage.tsx` & `game.tsx`)**:
   - `mutedPositionId: string | null`: 사용자가 `[✊ 홀딩]`을 누른 포지션의 `position.id`를 저장합니다.
   - `srNotice: SrEvent | null`: 보유 포지션 카드 내부에 1줄로 조용히 보여줄 최신 지지·저항 이벤트입니다.
2. **틱 이벤트 발생 시 분기 로직**:
   - `events = watcher.update(srLevels, lastPrice, Date.now())`에서 이벤트가 발생하면:
     1. 항상 최신 이벤트를 `setSrNotice(events[0])`로 기록하여 **보유 포지션 카드 내부에 1줄 상태 안내**가 갱신되게 합니다.
     2. 만약 `events` 중 `isMajorSrBreakEvent(ev) === true`인 이벤트가 있고, **현재 포지션이 홀딩 음소거 상태가 아니며(`mutedPositionId !== position.id`)**, 다른 모달이 열려 있지 않을 때만 `setSrEvent(majorEvent)`로 대응 시트(`SrActionModal` / `SrActionSheet`)를 엽니다.
3. **시트에서 `[✊ 홀딩]` 클릭 시 (`onHold` 핸들러)**:
   - 기존: 단순히 `setSrEvent(null)`만 호출하여, 조금 뒤 다른 선을 돌파하면 또 시트가 떴음.
   - **변경**:
     ```typescript
     const handleHoldSr = () => {
       if (position) setMutedPositionId(position.id)
       setSrEvent(null)
     }
     ```
   - 또한 시트 내부 `[✊ 홀딩]` 버튼 아래(또는 설명란)에 *"홀딩을 누르면 이번 포지션이 끝날 때까지 알림 창을 다시 띄우지 않아요"* 안내 문구를 작게 덧붙여 사용자가 안심하고 누를 수 있게 합니다.
4. **포지션 종료/변경 시 자동 초기화**:
   - 포지션이 청산되어 `position === null`이 되면 `srEvent`, `srNotice`, `mutedPositionId`를 모두 `null`로 초기화합니다. (새 포지션에 진입하면 다시 최초 1회 중요 돌파/이탈 알림을 받을 수 있음)

---

### 1-3. 보유 포지션 카드 내부 1줄 상태 배너 (`ActivePositionCard.tsx` & `position-card.tsx`)

- **파일 경로**:
  - 웹: [`web_client/src/components/game/ActivePositionCard.tsx`](../web_client/src/components/game/ActivePositionCard.tsx)
  - 모바일: [`mobile/src/features/game/components/position-card.tsx`](../mobile/src/features/game/components/position-card.tsx)
- **추가할 선택적 Prop**:
  - `srNotice?: SrEvent | null`
  - `holdingMuted?: boolean` (`mutedPositionId === position.id` 여부)
- **UI 표시 위치 및 디자인**:
  - 포지션 카드 내부(`진입가 ...` 아래, `[💰 익절하기 / 🛡️ 손절하기]` 버튼 바로 위)에 작고 깔끔한 1줄 배너(`bg-fill` / `theme.colors.fill`, `rounded-field`)를 표시합니다:
    - 예시 1 (일반 터치/돌파 안내): `🔔 [저항선 도달] 20일선(74,500원) 터치 — 단기 조정 주의`
    - 예시 2 (`[✊ 홀딩]` 클릭 후 음소거 상태): `✊ 홀딩 유지 중 · 🚀 [저항선 돌파] 20일선(74,500원) 상향 돌파`
  - 사용자는 화면을 가리는 팝업 없이도 이 1줄 안내를 참고하여, 원할 때만 바로 아래에 있는 `[익절하기/손절하기]` · `[½ 절반 익절]` · `[원금 회수]` 버튼을 누르면 됩니다(가만히 두면 자동 홀딩 유지).

---

## 2. 단계별 구현 로드맵 (Claude Code 작업 플랜)

Claude Code에서 아래 순서대로 Micro-Step 단위로 구현하고 테스트를 통과시킵니다.

### 📍 Step 1: `isMajorSrBreakEvent` 순수 함수 추가 및 단위 테스트 (웹 & 모바일 공통)
- [ ] [`web_client/src/lib/srWatch.ts`](../web_client/src/lib/srWatch.ts) 및 [`mobile/src/features/game/lib/sr-watch.ts`](../mobile/src/features/game/lib/sr-watch.ts)에 `isMajorSrBreakEvent(event: SrEvent): boolean` 함수 추가 (기존 `SrWatcher` 동작은 100% 그대로 유지).
- [ ] 웹(Vitest) 및 모바일(Jest)의 `srWatch` 테스트 파일에 `isMajorSrBreakEvent` 검증 케이스(`ind:ma5` 제외, `*_TOUCH` 제외, `ind:ma20`·`ind:poc`·`ind:bb*`·`lvl:*`의 `BREAKOUT/BREAKDOWN`만 `true`) 추가.

### 📍 Step 2: 웹 (`web_client`) 홀딩 음소거(`mutedPositionId`) & 포지션 카드 1줄 배너 연동
- [ ] [`web_client/src/components/game/ActivePositionCard.tsx`](../web_client/src/components/game/ActivePositionCard.tsx)에 `srNotice?: SrEvent | null`, `holdingMuted?: boolean` prop을 추가하여 카드 내부에 1줄 지지·저항 상태 배너 렌더링.
- [ ] [`web_client/src/components/game/SrActionModal.tsx`](../web_client/src/components/game/SrActionModal.tsx)에 *"홀딩을 누르면 이번 포지션 종료 시까지 알림 창을 다시 띄우지 않아요"* 보조 안내 추가.
- [ ] [`web_client/src/pages/GamePage.tsx`](../web_client/src/pages/GamePage.tsx)에서:
  - 모든 지지·저항 이벤트는 `srNotice`에 저장해 `ActivePositionCard`에 전달.
  - `isMajorSrBreakEvent`가 `true`이고 `mutedPositionId !== position.id`일 때만 `SrActionModal` 오픈.
  - `onHold` 클릭 시 `setMutedPositionId(position.id)` 설정.
- [ ] `cd web_client && npm run build && npm test` 통과 확인.

### 📍 Step 3: 모바일 앱 (`mobile`) 홀딩 음소거(`mutedPositionId`) & 포지션 카드 1줄 배너 연동
- [ ] [`mobile/src/features/game/components/position-card.tsx`](../mobile/src/features/game/components/position-card.tsx)에 `srNotice?: SrEvent | null`, `holdingMuted?: boolean` prop 및 1줄 안내 배너 추가.
- [ ] [`mobile/src/features/game/components/sr-action-sheet.tsx`](../mobile/src/features/game/components/sr-action-sheet.tsx)에 홀딩 시 재알림 차단 안내 문구 추가.
- [ ] [`mobile/src/app/(tabs)/game.tsx`](../mobile/src/app/%28tabs%29/game.tsx)에서 Step 2와 동일하게 `isMajorSrBreakEvent` 필터링, `mutedPositionId` 홀딩 음소거, `srNotice` 인라인 표시 연결.
- [ ] `cd mobile && npm run typecheck && npm test` 통과 확인.

---

## 3. Claude Code 실행용 프롬프트 템플릿

Claude Code에 아래 명령어를 그대로 복사해 입력하면 Step 1부터 Step 3까지 안전하게 구현됩니다:

```text
docs/game_lightweight_sr_action_spec_and_plan.md 문서를 읽고, Step 1부터 Step 3까지 순서대로 Micro-Step 단위로 구현해줘.
기존 SrWatcher 로직과 주문 패널(OrderPanel) 설정은 절대 지우거나 바꾸지 말고(Zero Deletion), 중요 선 돌파/이탈 시 1회 시트 노출 + '홀딩' 클릭 시 해당 포지션 종료까지 팝업 차단(이후 포지션 카드 1줄 배너 표시)을 웹과 모바일에 동일하게 반영한 뒤 테스트(vitest / jest / tsc --noEmit) 결과를 한국어로 보고해줘.
```
