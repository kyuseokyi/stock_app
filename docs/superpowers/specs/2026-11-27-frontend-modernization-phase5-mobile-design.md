# 프론트엔드 현대화 Phase 5 — 모바일(OTA 가능 범위) 설계

원 명세 `docs/frontend_modernization_tailwind4_shadcn_tanstack_spec.md` 의 Phase 5(NativeWind·FlashList·NetInfo·TanStack Query)를
이 프로젝트 사정에 맞게 좁힌 설계다.

## 사용자 결정 (2026-11-27)

> "A안으로 진행해줘"

A안: 스타일은 Unistyles 유지, 네이티브 모듈 없이 **OTA 로 보낼 수 있는 것만** — Zustand selector 점검, TanStack Query 적용, 목록 성능 조정.

- NativeWind 제외: Unistyles v3 와 babel 설정이 충돌한다.
- FlashList·NetInfo 제외: 네이티브 모듈이라 APK 재빌드가 필요하고 OTA 로 못 보낸다.

## OTA 가능 확인 (게이트)

앱은 `runtimeVersion: { policy: 'fingerprint' }`. 지문이 바뀌면 설치된 앱이 새 OTA 를 받지 않는다.
`require('expo/fingerprint').createFingerprintAsync('.')` 로 작업 전·후를 비교한다.

| 시점 | 지문 |
|---|---|
| 작업 전(dev 1cb6308b) | `b54858cd40ac595db9be191af38264e423b17e5d` |
| `@tanstack/react-query@5.107.1` 추가 후 | 같음 |
| `@testing-library/react-native@14.1.0`·`test-renderer@1.3.1`(개발용) 추가 후 | 같음 |

JS 전용 패키지는 지문에 들어가지 않는다(`fingerprint.config.js` 는 scripts·라이브러리 매니페스트만 뺌). 마지막에 다시 확인한다.

## 1. TanStack Query 기반

- `src/lib/query-client.ts`: `makeQueryClient()`·`getQueryClient()`(앱 하나 — RN 은 서버 렌더가 없다).
  - 재시도 0 — `lib/api/retry.ts` 가 이미 조회를 3번(합 10초) 재시도한다(웹과 같은 이유).
  - `refetchOnWindowFocus`·`refetchOnReconnect` false — 복귀 재조회(`useReturnRefresh`)·자동 갱신은 앱이 따로 한다.
  - `networkMode: 'always'` — NetInfo 가 없으니 온라인 판정에 기대지 않고 요청을 보내 실패하게 둔다(도입 전 fetch 와 같음).
  - staleTime 30초, mutation 재시도 없음. 401 은 `lib/api/http.ts` 가 처리.
- `src/app/_layout.tsx`: `QueryClientProvider` 를 가장 바깥에 둔다(시트·모달 포함). gorhom 시트·Portal 은 쓰지 않음.

## 2. 공용 훅 `useRestResource` — 내부만 Query (웹 Phase 3 의 A 방식)

시황 5개 훅(movers·investor-flow·heatmap·morning-brief·featured)과 홈 2곳이 쓴다. 반환값·동작 그대로.
웹 훅과 다른 점을 그대로 지킨다: `refresh`·`silentRefresh` 는 실패하면 throw, `error` 는 오류 코드 문자열, 실패해도 이전 data 유지.
`refresh`·`silentRefresh` 는 Query 재조회 대신 fetcher 를 직접 불러 성공 때만 `setQueryData` — 재조회하면 실패 시 query 가 error 가 되어
"실패해도 오류 표시는 그대로"가 깨진다.

검증: 동작 고정 테스트 8개(`use-rest-resource.test.ts`)를 **전환 전 코드에서 먼저 통과**시키고 전환 후에도 그대로 통과.
Query 는 변경 알림을 setTimeout 0 으로 늦추므로 테스트는 `waitFor`(바뀌길 기대)·`flush`(안 바뀌어야 함)로 확인 시점만 맞춘다.

## 3. 화면 훅 — 내부만 Query (웹 Phase 3 의 B 범위)

화면 파일은 그대로, 훅 내부만 바꾼다(모바일은 화면이 이미 훅으로만 데이터를 받는다).
- 시황: `use-calendar`·`use-group-ranking`·`use-group-detail`
- 목록: `use-blog-list`·`use-finder-screen`·`use-pattern-screen` — 이어 붙이기·필터가 얽혀 그대로 옮기기 위험하면 바꾸지 않는다.

훅마다 동작 고정 테스트를 먼저 쓰고 전환 전·후 모두 통과. 의도적으로 허용하는 차이만:
(a) 같은 조건으로 30초 안에 돌아오면 저장된 결과를 바로 보여 줌, (b) 쪽 번호 페이징이면 다음 쪽을 받는 동안 이전 쪽 표시.
게임(WS)·펀드(기기 저장)는 웹과 같이 제외.

## 4. 목록 성능 — 점검 결과 변경 없음

- `FlatList` 6곳(홈·커뮤니티·스크리너 3섹션·테마/업종)은 모두 화면 최상위 스크롤이라 가상화가 살아 있다(바깥 `ScrollView` 는 가로 칩 줄뿐).
  `keyExtractor`·`ListHeaderComponent`·`onEndReached` 갖춤.
- 게임 랭킹 시트(Top 100)는 공용 `Sheet` 가 내용을 `ScrollView` 로 감싸고 탭·내 순위 블록이 위에 얹혀 있다.
  `FlatList` 로 바꾸려면 게임 시트 공용 구조를 바꿔야 해 위험 대비 이득(단순한 줄 100개)이 작다 → 이번에 바꾸지 않음.

## 5. Zustand selector 점검

Phase 2 의 eslint 규칙(`no-restricted-syntax`: 인자 없는 `useXStore()`/`useXSheet()` 금지)으로 `src` 전체 검사 → 위반 0.
zustand 버전(5.0.15)은 그대로(웹 5.1.0 과 맞출 이득 없음).

## 검증

- `npx tsc --noEmit`, `npx jest` 전체, 바꾼 파일 eslint 오류 0(기존 React Compiler 규칙 오류는 손대지 않음).
- `npx expo export --platform android` 로 Metro 번들 생성 확인.
- 지문이 작업 전과 같은지 최종 확인.
- 실기기·에뮬레이터: 이번 확인 때 `adb devices` 에 연결된 기기 없음 → 배포 전 사용자가 dev 빌드에서 시황 탭·일정·테마·커뮤니티 목록을 확인.
