# 트레이딩 게임 지지·저항 경량화 · 수평추세선 · POC 시인성 개선 · 관리자 ON/OFF 기술 명세 및 구현 플랜

> **목적**: 실시간 트레이딩 게임(`GamePage.tsx`, `game.tsx`)의 차트 지지·저항선 표시 및 손절·익절·홀딩 대응 경험을 깔끔하고 직관적으로 개선합니다.
>
> **핵심 요구사항 5가지**:
> 1. **매물대 POC 시인성 개선**: 캔들 뒤에 가려져 안 보이던 최대 매물대(POC)를 한눈에 알아볼 수 있도록 **POC 막대 전체 색상 강조 + 상단 레이어(`zOrder: 'top'`) 마커/라벨**로 개선합니다.
> 2. **지지·저항선 모양 변경 (단일 색상 · 차트 전체 폭 긴 수평 추세선)**: 현재 캔들 주변에만 알록달록 짧은 선분으로 생기던 방식 대신, **색상 구분 없이 단일 색상의 긴 수평 추세선(차트 왼쪽 끝 ~ 오른쪽 끝 전체 폭)**으로 그립니다.
> 3. **지지·저항선 ON/OFF 기본값 및 관리자(`admin_web`) 원격 제어**:
>    - 차트 상단 `[지지·저항]` 칩으로 ON/OFF 할 수 있으며, 클라이언트 코드의 순수 폴백 기본값은 `OFF(안 보임)`로 둡니다.
>    - 단, **관리자 웹(`admin_web` → `게임 설정 /game/settings`)에서 지지·저항선 기본 표시 여부(`SR_DEFAULT`)를 ON/OFF로 변경**할 수 있게 하고, **현재는 테스트를 위해 관리자 초기 설정값을 `ON(보임)`으로 세팅**합니다.
> 4. **중요 지지·저항 돌파/이탈 시에만 1회 대응 시트 노출**: 노이즈가 심한 `5일선`과 단순 `터치(TOUCH)`는 팝업에서 제외하고, **`20일선 · 매물대 POC · 볼린저 상/하단 · 전고점/전저점`의 확실한 `돌파/이탈` 시에만 1회** 시트를 띄웁니다.
> 5. **`[✊ 홀딩]` 클릭 시 포지션 종료까지 팝업 차단 + 포지션 카드 1줄 안내**: 한 번 `홀딩`을 누르면 해당 포지션 종료 시까지 추가 팝업을 차단하고, 이후 상태는 **보유 포지션 카드 내부 1줄 배너**로만 조용히 표시합니다.

---

## 0. 기존 코드 보존 원칙 (Zero Deletion & Regression Prevention)

1. **기존 `SrSegmentsPrimitive`, `SrWatcher`, `SrActionModal`, `SrActionSheet` 코드 100% 보존**:
   - [`web_client/src/lib/srSegments.ts`](../web_client/src/lib/srSegments.ts), [`srWatch.ts`](../web_client/src/lib/srWatch.ts) 및 모바일 대응 파일들의 기존 클래스·함수와 단위 테스트는 **삭제하지 않고 그대로 보존**합니다.
2. **주문 패널(`OrderPanel`) 설정 유지**:
   - 주문 패널의 손절/익절(SL/TP) 입력 방식은 현재 상태를 그대로 유지합니다.

---

## 1. 차트 시각 요소 개선 명세 (POC 시인성 · 긴 단일색 수평 추세선 · 관리자 ON/OFF)

### 1-1. 매물대 POC 시인성 대폭 개선 (`VolumeProfilePrimitive`)
- **대상 파일**:
  - 웹: [`web_client/src/lib/volumeProfile.ts`](../web_client/src/lib/volumeProfile.ts) (및 `admin_web/src/leaders/lib/volumeProfile.ts`)
  - 모바일: 앱 차트 WebView 스크립트(`chart-page-script.ts`)의 `VolumeProfile` 렌더러
- **기존 문제점**:
  - 20개 매물대 막대가 모두 흐린 회색(`rgba(100, 116, 139, 0.22)`)이고 `zOrder: 'bottom'`(캔들 뒤 바닥)에 그려지며, POC 표시도 막대 오른쪽 끝에 반지름 `3px` 작은 점 하나뿐이라 캔들과 겹치면 전혀 보이지 않았음.
- **개선 설계**:
  1. **1등 매물대(POC) 막대 자체 하이라이트**:
     - 일반 19개 막대는 기존 흐린 회색(`rgba(100, 116, 139, 0.22)`)을 유지하되, 최대 거래량 칸(**POC 칸**) 막대는 눈에 잘 띄는 **앰버 골드 반투명 색상(`rgba(245, 158, 11, 0.38)`)과 테두리(`rgba(217, 119, 6, 0.75)`, `1px`)**로 채워 막대 자체만으로도 어디가 최대 매물대인지 즉시 식별되게 합니다.
  2. **캔들 위 상단 레이어(`zOrder: 'top'`)에 POC 중심선 + `'POC'` 배지 표시**:
     - `paneViews()`에 바닥 막대용 뷰(`zOrder: 'bottom'`)와 별개로 **POC 마커 전용 상단 뷰(`zOrder: 'top'`)**를 추가합니다.
     - 상단 뷰에서는 POC 가격(`y`) 높이에 막대 왼쪽 끝(`0`)부터 막대 오른쪽 끝(`w`)까지 얇은 중심 점선(`#d97706`)을 긋고, 막대 오른쪽 끝에 **반지름 `4.5px` 원형 마커(흰색 테두리 포함)와 `'POC'` 텍스트 배지**를 그려 **캔들 몸통이 그 위를 지나가도 절대 가려지지 않게** 합니다.

---

### 1-2. 지지·저항선을 '색 구분 없는 단일 색상의 긴 수평 추세선'으로 변경
- **대상 파일**:
  - 웹: [`web_client/src/components/game/TradingChart.tsx`](../web_client/src/components/game/TradingChart.tsx) (및 [`SrSegmentsPrimitive`](../web_client/src/lib/srSegments.ts))
  - 모바일: `mobile/src/features/game/components/candle-chart.tsx` 및 차트 WebView 스크립트
- **변경 설계**:
  1. **차트 전체 폭 수평 추세선 (Full-Width Horizontal Trendline)**:
     - 기존처럼 마지막 캔들 주변 8봉(`SEG_BEFORE=6`, `SEG_AFTER=2`)에만 짧게 그리는 대신, **차트 왼쪽 끝(`0`)부터 오른쪽 끝(`mediaSize.width`)까지 차트 전체 폭을 길게 가로지르는 수평 추세선**으로 그립니다 (`SrSegmentsPrimitive`에 `fullWidth = true` 모드를 지원하거나 `series.createPriceLine` / 전체 폭 캔버스 라인으로 렌더링).
  2. **색상으로 구분하지 않고 단일 색상으로 통일**:
     - 기존에는 5일선(청록), 20일선(주황), 볼린저(남보라), 지지(보라), 저항(주황) 등 선마다 색이 달라 복잡했습니다.
     - 변경 후에는 지지선·저항선·지표 종류를 **색으로 구분하지 않고**, 모든 지지·저항 수평 추세선을 **단 하나의 깔끔한 통일 색상(`SR_LINE_COLOR = '#64748b'` 슬레이트 실선, 다크모드 시 `'#94a3b8'`, 두께 `1.5px` 실선)**으로 그려서 트레이더가 직접 그어 놓은 수평 추세선처럼 일관되고 차분하게 표시합니다.
     - 상단 범례(Legend)도 여러 색깔 조각 대신 지지·저항이 켜져 있을 때 단일 수평선 아이콘과 함께 깔끔하게 표시합니다.

---

### 1-3. 지지·저항선 ON/OFF 기본값(`안 보임`) + 관리자(`admin_web`) 제어 (테스트용 초기값 `ON`)
- **동작 구조**:
  1. **클라이언트 로컬 폴백 기본값 = `false` (안 보임)**:
     - [`web_client/src/lib/chartPrefs.ts`](../web_client/src/lib/chartPrefs.ts) 및 모바일 `chart-prefs.ts`에서 `DEFAULT_CHART_PREFS.sr`의 코드 기본값은 **`false`(안 보임)**로 설정합니다.
     - 사용자가 차트 상단 `[지지·저항]` 칩을 직접 눌러 변경한 적이 있는지 구분하기 위해 `sr: boolean | null` (또는 `srTouched: boolean`)을 지원하여, **사용자가 직접 건드리기 전에는 서버(관리자)가 지정한 기본값(`SR_DEFAULT` 플래그 / 규칙 API `sr_default`)을 그대로 따릅니다.**
  2. **백엔드 & 관리자 웹(`admin_web`) 스위치 추가 (`SR_DEFAULT`)**:
     - [`backend/apps/trading_game/services/feature_flag_service.py`](../backend/apps/trading_game/services/feature_flag_service.py)의 `KNOWN_FLAGS`에 **`"SR_DEFAULT"`** 추가:
       - `KNOWN_FLAGS = ("QUIZ", "STREAK", "SR_DEFAULT")`
       - **초기 시드 / 행이 없을 때의 기본값은 테스트를 위해 `True (ON)`**으로 설정합니다!
       - 시즌/규칙 응답(`GET /api/game/seasons/active`의 `features` 및 `GET /api/game/rules`의 `sr_default`)에 이 값을 포함해 웹·앱 클라이언트에 전달합니다.
     - [`admin_web/src/pages/TradingGameSettings.tsx`](../admin_web/src/pages/TradingGameSettings.tsx)의 **`기능 on/off`** 목록에 아래 항목을 추가합니다:
       - **제목**: `📏 차트 지지·저항 수평선 기본 표시` (`SR_DEFAULT`)
       - **설명**: `'켜면 게임 차트 진입 시 지지·저항 수평 추세선이 기본으로 켜져 보이고(테스트용 기본 ON), 끄면 기본값으로 숨겨집니다(사용자가 차트의 [지지·저항] 칩으로 직접 켜고 끌 수 있음).'`

---

## 2. 지지·저항 도달 시 손절·익절·홀딩 대응 경량화 명세

### 2-1. 팝업(모달/시트) 노출 대상 vs 인라인 1줄 배너 대상 구분

[`srWatch.ts`](../web_client/src/lib/srWatch.ts)(웹) 및 [`sr-watch.ts`](../mobile/src/features/game/lib/sr-watch.ts)(모바일)에 순수 판별 함수 `isMajorSrBreakEvent(event: SrEvent): boolean`을 추가합니다:

| 구분 | 선 종류 (`event.key`) | 이벤트 타입 (`event.type`) | `isMajorSrBreakEvent` 반환값 | 화면 처리 방식 |
| :--- | :--- | :--- | :---: | :--- |
| **핵심 돌파·이탈** | • `20일선` (`ind:ma20`)<br>• `매물대 POC` (`ind:poc`)<br>• `BB 상/하단` (`ind:bbUpper`, `ind:bbLower`)<br>• `전고점/전저점` (`lvl:*`) | `RESISTANCE_BREAKOUT` (상향 돌파)<br>`SUPPORT_BREAKDOWN` (하향 이탈) | **`true`** | **포지션당 최초 1회 팝업 시트 노출**<br>*(이미 `홀딩`을 눌렀다면 포지션 카드 1줄 텍스트로만 표시)* |
| **단순 도달(터치)** | 모든 지지·저항선 | `RESISTANCE_TOUCH` (저항 도달)<br>`SUPPORT_TOUCH` (지지 도달) | **`false`** | 팝업 띄우지 않음 → **보유 포지션 카드 안 1줄 텍스트 배너**로만 조용히 표시 |
| **단기 노이즈 선** | `5일선` (`ind:ma5`) | 모든 이벤트 (`TOUCH` · `BREAKOUT` · `BREAKDOWN`) | **`false`** | 팝업 띄우지 않음 → **보유 포지션 카드 안 1줄 텍스트 배너**로만 조용히 표시 |

```typescript
export function isMajorSrBreakEvent(event: SrEvent): boolean {
  if (event.key === 'ind:ma5') return false
  return event.type === 'RESISTANCE_BREAKOUT' || event.type === 'SUPPORT_BREAKDOWN'
}
```

### 2-2. `[✊ 홀딩]` 클릭 시 포지션 단위 팝업 차단 (`mutedPositionId`) & 포지션 카드 1줄 배너
- 사용자가 시트(`SrActionModal` / `SrActionSheet`)에서 **`[✊ 홀딩]`**을 한 번 누르면 `setMutedPositionId(position.id)`로 기록하여 **이번 포지션이 청산될 때까지 추가 팝업을 더 이상 띄우지 않습니다.**
- 이후 발생하는 모든 지지·저항 이벤트(및 단순 터치/5일선 이벤트)는 아래 **보유 포지션 카드(`ActivePositionCard.tsx` / `position-card.tsx`) 내부의 1줄 상태 배너(`srNotice`)**로만 조용히 표시됩니다.

---

## 3. 단계별 구현 로드맵 (Claude Code 작업 플랜)

Claude Code에서 아래 순서대로 Micro-Step 단위로 구현하고 테스트를 통과시킵니다.

### 📍 Step 1: 백엔드 & 관리자 웹(`admin_web`) 지지·저항 기본 ON/OFF 플래그(`SR_DEFAULT`) 추가
- [ ] [`backend/apps/trading_game/services/feature_flag_service.py`](../backend/apps/trading_game/services/feature_flag_service.py)의 `KNOWN_FLAGS`에 `"SR_DEFAULT"` 추가(초기 시드/기본값 `True` — 테스트용 ON) 및 `/api/game/seasons/active` (`features.sr_default`), `/api/game/rules` (`sr_default`) 응답에 포함.
- [ ] [`admin_web/src/pages/TradingGameSettings.tsx`](../admin_web/src/pages/TradingGameSettings.tsx) 및 `admin_web/src/types/game.ts`에 `SR_DEFAULT`(`📏 차트 지지·저항 수평선 기본 표시`) 스위치 추가.
- [ ] 백엔드 `pytest` 및 `admin_web` `tsc --noEmit` 통과 확인.

### 📍 Step 2: 매물대 POC 시인성 개선 & 단일 색상 긴 수평 추세선 적용 (웹 & 모바일)
- [ ] [`web_client/src/lib/volumeProfile.ts`](../web_client/src/lib/volumeProfile.ts) (및 `admin_web`, 모바일 차트 페이지)에서 최대 거래량(POC) 막대를 앰버 골드 하이라이트 색상으로 구분하고, 상단 뷰(`zOrder: 'top'`)에 POC 중심선 + 마커 + `'POC'` 배지를 그려 캔들에 가려지지 않게 개선.
- [ ] [`web_client/src/lib/srSegments.ts`](../web_client/src/lib/srSegments.ts) 및 [`TradingChart.tsx`](../web_client/src/components/game/TradingChart.tsx), 모바일 차트에서 지지·저항선을 **색상 구분 없는 단일 색상(`#64748b`) + 차트 왼쪽 끝부터 오른쪽 끝까지 가로지르는 긴 수평 추세선**으로 변경.
- [ ] [`web_client/src/lib/chartPrefs.ts`](../web_client/src/lib/chartPrefs.ts) 및 모바일 `chart-prefs.ts`에서 로컬 폴백 기본값은 `false`(안 보임)로 두되, 사용자가 직접 토글하기 전에는 서버 `sr_default`(초기값 `true` ON)를 따르도록 연결.

### 📍 Step 3: 홀딩 음소거(`mutedPositionId`) & 중요 돌파/이탈 필터(`isMajorSrBreakEvent`) & 포지션 카드 1줄 배너 연동
- [ ] 웹(`srWatch.ts`, `GamePage.tsx`, `ActivePositionCard.tsx`, `SrActionModal.tsx`) 및 모바일(`sr-watch.ts`, `game.tsx`, `position-card.tsx`, `sr-action-sheet.tsx`)에 `isMajorSrBreakEvent` 필터링, `[✊ 홀딩]` 클릭 시 포지션 종료까지 팝업 차단, 보유 포지션 카드 1줄 상태 배너 적용.
- [ ] 웹(`npm run build && npm test`) 및 모바일(`npm run typecheck && npm test`) 전체 검증 통과.

---

## 4. Claude Code 실행용 프롬프트 템플릿

Claude Code에 아래 명령어를 그대로 복사해 입력하면 Step 1부터 Step 3까지 안전하게 구현됩니다:

```text
docs/game_lightweight_sr_action_spec_and_plan.md 문서를 읽고, Step 1부터 Step 3까지 순서대로 Micro-Step 단위로 구현해줘.
특히:
1. 관리자 웹(/game/settings)에서 차트 지지·저항선 기본 표시(SR_DEFAULT)를 ON/OFF 할 수 있게 추가하고(클라이언트 폴백 기본값은 안 보임(false)이나, 현재 테스트를 위해 서버 초기값은 ON(true)으로 설정),
2. 매물대 POC가 캔들에 가려지지 않도록 POC 막대 색상 강조 + 상단 레이어(top) 마커/라벨로 시인성을 개선하며,
3. 지지·저항선은 색으로 구분하지 말고 단일 색상의 차트 전체 폭 긴 수평 추세선으로 그리도록 변경하고,
4. 중요 선 돌파/이탈 시에만 1회 시트를 띄우고 '홀딩' 클릭 시 포지션 종료까지 팝업 차단(이후 포지션 카드 1줄 배너 표시)을 웹과 모바일에 반영해줘.
각 단계 완료 시 테스트(pytest / vitest / jest / tsc --noEmit) 실행 후 한국어로 요약 보고해줘.
```
