# 트레이딩 게임 서브페이즈 6c — 모바일(Expo) 게임 화면 설계 스펙

> 작성일: 2026-10-13 · 상태: 승인됨(사용자 위임: "특별한 일이 없다면 6c까지 진행" — 아래 결정은 추천안으로 확정)
> 선행: 6a(web 코어)·6b(web 모달). 기준 스펙: `2026-10-13-trading-game-phase6a-web-trading-core-design.md`, `2026-10-13-trading-game-phase6b-web-modals-design.md` — **기능·계약·문구는 web과 동일**, 이 문서는 모바일 차이만 정한다.
> 모바일 규칙: Expo SDK 57 · RN 0.86 · **Unistyles v3**(NativeWind 아님) · zustand v5 · 토스 디자인(`docs/mobile_design_language.md`) · Metro 8082 · 에뮬레이터는 `adb reverse` 필요.

## 1. 범위

`mobile/src/app/(tabs)/game.tsx`(시즌 준비 중 스켈레톤)를 web 6a+6b와 동등한 게임 화면으로 교체한다. **백엔드 변경 없음.**

- 코어: 헤더(시즌·D-day·내 순위·자본금·Streak 칩) · 코치 배너(펼침) · 심리 바 · 일봉+실시간 차트(지지/저항/진입가) · 포지션 카드(원클릭 청산) · 주문 패널(비중·배율·5x 🔒) · 넛지/오류 토스트.
- 모달: 랭킹(시즌 Top 100 / 명예의 전당 MBTI) · 퀘스트(진행·보상 수령·뱃지) · 아카데미(5x 해금) · 야간 10초 차트 퀴즈(항상 열림 + KST 15:30 이후·주말 배너).
- 제외: 지인 리그, MBTI 공유 이미지, 푸시(FCM)·햅틱·카운팅 애니메이션.

## 2. 핵심 결정 (모바일 차이)

1. **차트 = 순수 View 캔들 차트(신규 네이티브 의존성 0)**. `react-native-echarts`/svg/skia는 설치돼 있지 않고, 네이티브 모듈 추가는 dev build 재생성이 필요하다. 캔들은 `View`(몸통·꼬리)를 절대 배치, 가격선은 1px `View`+라벨. 좌표 계산은 순수 함수 `layoutCandles(candles, width, height, extraPrices)`로 분리해 jest로 검증. 일봉은 최근 **60개**만 표시, 퀴즈 차트도 같은 컴포넌트 재사용(가격 라벨 숨김).
2. **모달 = RN `Modal`(`animationType="slide"`, `presentationStyle="pageSheet"`, Android `onRequestClose`로 뒤로가기 닫기)**. expo-router 모달 라우트는 쓰지 않는다(탭 화면 상태·WS 유지).
3. **HTTP = 기존 `createHttpClient`(fetch 래퍼) 재사용** — `ENV.gameApiUrl` 인스턴스. 401 시 기존 동작(`notifyUnauthorized` → 로그아웃)을 따른다(모바일 공통 정책 우선).
4. **로그인 = 기존 내정보 탭**. 비로그인에서 주문/퀘스트/퀴즈/아카데미 시도 시 토스트 + `router.push('/(tabs)/profile')`.
5. **WS = RN 내장 `WebSocket`**. 재연결/4401/25초 ping/재연결 시 재조회 규칙은 web과 동일. `AppState`가 active가 아니면 연결을 닫고, 복귀 시 재연결 + 재조회.
6. **환경변수**: `EXPO_PUBLIC_GAME_API_URL`(선택). 미설정 시 dev(`appEnv !== 'production'`)는 `http://localhost:8003`, production이면 `undefined` → "시즌을 준비하고 있어요". 일봉은 기존 `ENV.stockGraphqlUrl`(graphql-request 클라이언트 재사용).
7. **코드 공유 없음(복제)**: 모노레포 공유 패키지가 없으므로 순수 로직(Decimal 변환·WS 파서·오류 문구·캔들 병합·퀴즈 시간·D-day)을 `mobile/src/features/game/lib/`에 **web과 같은 시그니처·문구로 복제**하고 jest 테스트를 붙인다.
8. **상태 = zustand v5 스토어 `features/game/store.ts`** — web과 같은 상태/액션/경쟁 가드(privateGen·refreshSeq). 모달 데이터는 모달 로컬 state.

## 3. 파일 구조

```
mobile/src/
  lib/env.ts                                  # + gameApiUrl (선택)
  features/game/
    types.ts                                  # web types/game.ts 와 동일 계약(6a+6b)
    api.ts                                    # REST(createHttpClient) + 일봉 GraphQL(graphql-request) + Dec→number
    lib/decimal.ts  lib/format.ts  lib/candles.ts  lib/ws.ts  lib/errors.ts  lib/quiz.ts  lib/chart-layout.ts
    lib/*.test.ts                             # jest 순수 로직 테스트(TDD)
    store.ts  use-game-socket.ts
    components/
      game-header.tsx  coach-banner.tsx  sentiment-bar.tsx  candle-chart.tsx  position-card.tsx
      order-panel.tsx  game-toaster.tsx  quiz-banner.tsx
      sheet.tsx                               # 공용 RN Modal 래퍼(제목·닫기·안전영역)
      leaderboard-sheet.tsx  quest-sheet.tsx  academy-sheet.tsx  quiz-sheet.tsx
  app/(tabs)/game.tsx                         # 교체: 상태 분기 + 조립
```

- 금액/퍼센트는 기존 `@/ui`의 `formatWon/formatSignedWon/formatPct`·`AmountText` 재사용. 가격(콤마)·KST 날짜·D-day만 `features/game/lib/format.ts`.
- 색은 테마 토큰(`theme.colors.up/down/primary/...`, 다크 모드 자동). 지지선 보라 `#8b5cf6`·저항선 주황 `#f59e0b` 상수.

## 4. 화면 상태 / 동작

web 6a §4.5·6b와 동일:
1. `gameApiUrl` 미설정 → 준비 중 ListState. 2. 연결 실패 → 오류 ListState + 다시 시도. 3. 시즌 없음 → 준비 중. 4. 정상 → `ScrollView`(당겨서 새로고침 `RefreshControl` → 시즌·개인 데이터 재조회) 안에 세로 스택.
- 퀴즈 모달 단계·시간 초과 규칙·보상 문구·오류 매핑·Streak·퀴즈 비활성(503) 처리 = 6b 그대로(정답·미지급 문구는 6b 최종 구현과 동일하게 원인을 단정하지 않음).
- 토스트: 화면 상단(안전영역 아래) 오버레이, 5초 자동 닫힘, 탭하여 닫기.

## 5. 검증

1. `cd mobile && npx tsc --noEmit` + `npm test`(jest — 기존 테스트 포함 전부 통과) + `npx expo-doctor`(회귀 없음).
2. 순수 로직 jest(TDD): decimal·ws 파서·errors 매핑·candles 병합(시계 오차 포함)·quiz 시간·chart-layout(가격→y 좌표, 패딩, 가격선 포함 범위, 빈 입력).
3. 스모크: 로컬 스모크 DB/Redis(6a·6b 절차) + `npx expo start --web --port 8082`로 react-native-web 렌더를 브라우저로 확인 — 내정보 로그인 → 게임 탭 헤더·차트·틱 반영·주문/청산·모달 4종. 네이티브 전용 동작(pageSheet·Android 뒤로가기·AppState)은 에뮬레이터 가능 시 확인, 불가 시 미검증으로 보고.
4. 에뮬레이터 사용 시 `adb reverse tcp:8003 tcp:8003` 추가 필요.

## 6. 문서

- README 모바일 섹션: 게임 탭 필요 서비스(8003·8002), `EXPO_PUBLIC_GAME_API_URL`, 에뮬레이터 `adb reverse tcp:8003`.
- `mobile/.env.development`에 `EXPO_PUBLIC_GAME_API_URL=http://localhost:8003` 추가(비밀값 아님).
- ROADMAP 6c 체크.
