# 프론트엔드 현대화 Phase 2 — Zustand v5·Selector 최적화 설계

> 작성 2026-11-27 · 원 기획: [`docs/frontend_modernization_tailwind4_shadcn_tanstack_spec.md`](../../frontend_modernization_tailwind4_shadcn_tanstack_spec.md) 2.2절·Phase 2
> 이 문서가 원 기획과 다르면 **이 문서가 우선**. Phase 1 설계: [`2026-11-27-frontend-modernization-phase1-admin-design.md`](2026-11-27-frontend-modernization-phase1-admin-design.md)

## 0. 원 기획에서 바꾼 것 (사용자 결정 2026-11-27)
| 원 기획 | 이 설계 | 이유 |
|---|---|---|
| `createStore` 팩토리 + `StoreProvider` Context + `useHydrated` + `"use client"` | **제외.** Next.js 전환이 실제로 정해질 때 따로 | 지금 웹 두 곳은 Vite SPA(서버 렌더링 없음) — 효과 없이 코드만 늘어남 |
| 구독부 전수 점검 | 그대로(전체 구독 9곳 교체 + 재발 방지 규칙) | |

## 1. 현황 (2026-11-27 조사)
- 버전: `web_client` zustand ^4.5.5, `admin_web` ^4.5.7, `mobile` ^5.0.15(이미 v5).
- v5 에서 무한 렌더를 일으키는 선택자(매번 새 객체·배열 반환): **없음**. 등식 함수 두 번째 인자 사용: 없음.
- 스토어 전체 구독(인자 없는 `useXStore()`) 9곳:
  - web_client: `components/Layout.tsx`(`useBoardStore`·`useAuthStore`·`useLoginPromptStore`), `pages/MyPage.tsx`(`useAuthStore`), `pages/CommunityPage.tsx`(`useBoardStore`), `pages/GamePage.tsx`(`useTradingGameStore` — 시세 틱마다 화면 전체 재렌더, 영향 가장 큼)
  - admin_web: `components/Sidebar.tsx`(`useUiStore`)
  - mobile: `app/(tabs)/community.tsx`(`useBoardStore`), `features/app-update/use-app-update.ts`(`useAppUpdateStore`)

## 2. 변경
1. `web_client`·`admin_web` 의 zustand 를 **5.1.0**(정확한 버전)으로. `mobile` 은 버전 그대로.
2. 9곳 교체 — 한 필드는 `useX((s) => s.f)`, 여러 필드는 `useX(useShallow((s) => ({ … })))`(`zustand/react/shallow`). 꺼내는 이름·동작은 그대로(구조 분해 변수명 유지).
   - `use-app-update.ts` 의 `const state = useAppUpdateStore()` 는 실제로 쓰는 필드만 `useShallow` 로 고르고, 반환 모양은 그대로.
   - `Layout.tsx` 의 `const loginPrompt = useLoginPromptStore()` 도 쓰는 필드만.
3. 재발 방지 — 인자 없는 스토어 훅 호출 금지:
   - `web_client`·`mobile` 의 `eslint.config.js` 에 `no-restricted-syntax`: `CallExpression[callee.name=/^use[A-Z][A-Za-z]*(Store|Sheet)$/][arguments.length=0]`, 메시지 "스토어 전체 구독 금지 — 선택자나 useShallow 를 쓰세요". 테스트 파일은 예외.
   - `admin_web` 은 eslint 가 없으므로 vitest 정적 테스트(`src/store/no-whole-store.test.ts`)가 `src/**/*.tsx?` 에서 같은 패턴을 찾으면 실패.
4. GamePage 재렌더 테스트 — `web_client` vitest 에 jsdom·Testing Library 를 더해(기존 node 환경 테스트는 그대로, 화면 테스트만 `// @vitest-environment jsdom`), 게임 스토어의 시세 필드만 바꿀 때 시세를 쓰지 않는 하위 부분이 다시 그려지지 않는지 확인. GamePage 전체 렌더가 무거우면(소켓·차트 의존) 같은 구독 방식을 쓰는 작은 시험 컴포넌트로 "구조 분해 구독은 재렌더, useShallow 는 재렌더 안 함"을 보이는 테스트로 대신하고 이유를 남긴다.

## 3. 검증
- web_client: `npx tsc --noEmit`, `npm test`, `npm run lint`(새 규칙 위반 0)
- admin_web: `npx tsc --noEmit`, `npm test`, `npm run build`(가짜 `VITE_*`)
- mobile: `npx tsc --noEmit`, `npx jest`, `npm run lint`
- 게임 화면: web_client 를 로컬에서 띄워 게임 페이지가 열리고 오류 없이 그려지는지(실서버·KIS 호출 없이, 백엔드 없으면 빈 상태 화면 확인까지).
- 배포 시 mobile JS 변경 → OTA 포함(네이티브 변경 없음).
