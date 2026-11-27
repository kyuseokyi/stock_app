# 프론트엔드 현대화 Phase 2 (Zustand Selector) 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬 — superpowers:executing-plans 로 작업 단위마다 실행한다. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** web_client·admin_web 을 Zustand 5.1.0 으로 올리고, 세 앱의 스토어 전체 구독 9곳을 선택자·`useShallow` 로 바꾸며, 재발 방지 규칙을 건다.

**구조:** 동작은 그대로 두고 구독 방식만 바꾼다. eslint 가 있는 앱은 `no-restricted-syntax`, 없는 앱은 정적 테스트로 막는다.

**기술:** zustand 5.1.0(`zustand/react/shallow`), eslint flat config, vitest 2.1.9 + jsdom 25.0.1 + Testing Library, jest(mobile).

설계: [`../specs/2026-11-27-frontend-modernization-phase2-zustand-design.md`](../specs/2026-11-27-frontend-modernization-phase2-zustand-design.md)

## 공통 규칙
- 작업 폴더 `/Users/kyuseok/Documents/private/projects/ivyro/work_space/wt-fe-p2`, 브랜치 `feature/fe-phase2-zustand-selectors`.
- `web_client`·`admin_web` 은 node_modules 를 **작업 폴더에 독립 설치**(`npm ci`) — 메인 폴더에서 npm 명령 금지. `mobile/node_modules` 는 메인 폴더 링크(의존성 변경 없음, mobile 에서 npm install 금지).
- 금지: merge·push, env 읽기·수정, `git add -A`·`git add .`·`git stash`(목록 포함)·`git reset`·`git checkout --`·`rm -rf`, 실서버·외부 API 호출. 임시 파일은 `/Users/kyuseok/.claude/jobs/cfc9cd18/tmp/fe-p2/`.
- 커밋 메시지 한국어 + 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```

### 작업 1: 재발 방지 규칙 먼저(실패 확인)
- [ ] `web_client/eslint.config.js`·`mobile/eslint.config.js` 에 규칙 추가(기존 설정 배열에 객체 하나, 테스트 파일 `**/*.test.{ts,tsx}` 는 `ignores`):
```js
{
  files: ['**/*.{ts,tsx}'],
  ignores: ['**/*.test.{ts,tsx}'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: 'CallExpression[callee.name=/^use[A-Z][A-Za-z]*(Store|Sheet)$/][arguments.length=0]',
      message: '스토어 전체 구독 금지 — useX((s) => s.f) 또는 useX(useShallow((s) => ({ ... }))) 를 쓰세요',
    }],
  },
},
```
  기존 설정에 `no-restricted-syntax` 가 이미 있으면 항목을 합친다(덮어쓰기 금지).
- [ ] `admin_web/src/store/no-whole-store.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const PATTERN = /\buse[A-Z][A-Za-z]*(Store|Sheet)\(\)/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}

describe('스토어 전체 구독 금지', () => {
  it('인자 없는 스토어 훅 호출이 없다', () => {
    const hits = files(SRC).filter((f) => PATTERN.test(readFileSync(f, 'utf8')))
    expect(hits.map((f) => f.slice(SRC.length + 1))).toEqual([])
  })
})
```
- [ ] 실행해 **실패를 확인**: `cd web_client && npx eslint src` → Layout·MyPage·CommunityPage·GamePage 오류, `cd mobile && npx eslint src` → community·use-app-update 오류, `cd admin_web && npx vitest run src/store/no-whole-store.test.ts` → `components/Sidebar.tsx` 로 실패.
- [ ] 커밋하지 않고 작업 2~3 에서 고친 뒤 함께 커밋.

### 작업 2: zustand 5.1.0 (web_client·admin_web)
- [ ] `cd web_client && npm ci && npm install --save-exact zustand@5.1.0`, `cd admin_web && npm ci && npm install --save-exact zustand@5.1.0`.
- [ ] 두 앱 `npx tsc --noEmit` — v5 타입 변화로 오류가 나면(예: `create<T>()(…)` 커리 형태, `persist` 타입) 해당 스토어 파일만 최소 수정.

### 작업 3: 9곳 교체
각 파일에서 `import { useShallow } from 'zustand/react/shallow'` 를 추가하고 바꾼다. 꺼내는 변수 이름·이후 코드는 그대로.
- [ ] `web_client/src/components/Layout.tsx:23-26`
```tsx
const { boards, fetchBoards, boardName } = useBoardStore(useShallow((s) => ({ boards: s.boards, fetchBoards: s.fetchBoards, boardName: s.boardName })))
const { user, token, logout } = useAuthStore(useShallow((s) => ({ user: s.user, token: s.token, logout: s.logout })))
```
  `const loginPrompt = useLoginPromptStore()` 는 파일에서 `loginPrompt.` 로 쓰는 필드를 모두 찾아 그 필드만 `useShallow` 로 고른다(객체 이름 `loginPrompt` 유지).
- [ ] `web_client/src/pages/MyPage.tsx:18` — `useAuthStore(useShallow((s) => ({ user: s.user, logout: s.logout })))`
- [ ] `web_client/src/pages/CommunityPage.tsx:6` — `useBoardStore(useShallow((s) => ({ boards: s.boards, loaded: s.loaded, error: s.error })))`
- [ ] `web_client/src/pages/GamePage.tsx:~86` — 구조 분해로 꺼내는 이름 목록을 그대로 `useShallow((s) => ({ a: s.a, … }))` 로. 이름이 20개 넘게 많으면 성격별(시즌·내 상태 / 실시간 시세·차트 / 주문 함수)로 2~3개 `useShallow` 호출로 나눠 시세 틱이 주문 영역 값에 섞이지 않게 한다 — 단 같은 컴포넌트 안이면 재렌더는 줄지 않으므로, 이번에는 **동작 보존이 우선**이고 하위 컴포넌트 분리는 하지 않는다.
- [ ] `admin_web/src/components/Sidebar.tsx:132` — `useUiStore(useShallow((s) => ({ sidebarOpen: s.sidebarOpen, closeSidebar: s.closeSidebar })))`
- [ ] `mobile/src/app/(tabs)/community.tsx:22` — `useBoardStore(useShallow((s) => ({ boards: s.boards, loaded: s.loaded, error: s.error, load: s.load })))` 뒤 기존 별칭(`loaded: boardsLoaded` 등) 구조 분해 유지.
- [ ] `mobile/src/features/app-update/use-app-update.ts:20` — `state.` 로 쓰는 필드만 `useShallow` 로 골라 `const state = …`(반환 모양 유지).
- [ ] 작업 1 의 규칙이 이제 통과: `web_client: npx eslint src`, `mobile: npx eslint src`, `admin_web: npx vitest run`.
- [ ] 커밋: `refactor: 스토어 전체 구독 9곳을 선택자·useShallow 로 + 재발 방지 규칙(eslint·정적 테스트), web·관리자 zustand 5.1.0`

### 작업 4: 재렌더 테스트(web_client)
- [ ] `cd web_client && npm install --save-exact -D jsdom@25.0.1 @testing-library/react@16.3.3`. `vite.config` 의 `test.include` 에 `src/**/*.test.tsx` 추가(환경은 기본 node 유지, 화면 테스트 파일 첫 줄에 `// @vitest-environment jsdom`).
- [ ] `web_client/src/store/subscription.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

type S = { price: number; season: string; setPrice: (p: number) => void }
const useT = create<S>()((set) => ({ price: 0, season: 's1', setPrice: (price) => set({ price }) }))

describe('스토어 구독 방식', () => {
  it('useShallow 로 고른 패널은 시세만 바뀌면 다시 그려지지 않는다', () => {
    let panel = 0
    function Panel() {
      const { season, setPrice } = useT(useShallow((s) => ({ season: s.season, setPrice: s.setPrice })))
      panel++
      return <span>{season}{typeof setPrice}</span>
    }
    render(<Panel />)
    act(() => useT.getState().setPrice(100))
    act(() => useT.getState().setPrice(101))
    expect(panel).toBe(1)
  })
  it('전체 구독은 시세마다 다시 그려진다(금지 이유)', () => {
    let whole = 0
    function Whole() {
      // eslint-disable-next-line no-restricted-syntax
      const { season } = useT()
      whole++
      return <span>{season}</span>
    }
    render(<Whole />)
    act(() => useT.getState().setPrice(200))
    expect(whole).toBe(2)
  })
})
```
- [ ] 실제 `useTradingGameStore` 로도 한 번: `GamePage` 를 통째로 그리지 말고, 작업 3 에서 GamePage 가 고른 필드 목록과 같은 `useShallow` 선택자를 쓰는 시험 컴포넌트를 만들어 스토어의 시세 필드(스토어 정의에서 틱으로 바뀌는 필드 이름 확인)만 `setState` 했을 때 — 그 필드가 목록에 있으면 재렌더 1회, 없으면 0회 — 를 확인하는 테스트를 같은 파일에 추가한다.
- [ ] `npm test` 통과(기존 node 테스트 포함).
- [ ] 커밋: `test: 스토어 구독 방식 재렌더 테스트(useShallow 는 무관한 변경에 재렌더 안 함)`

### 작업 5: 전체 검증·보고
- [ ] web_client `npx tsc --noEmit && npm test && npm run lint`
- [ ] admin_web `npx tsc --noEmit && npm test && (export VITE_API_BASE_URL=http://localhost:4010 VITE_AUTH_BASE_URL=http://localhost:4010 VITE_STOCK_API_URL=http://localhost:4010; npm run build)`
- [ ] mobile `npx tsc --noEmit && npx jest && npm run lint`
- [ ] web_client vite dev 를 띄워(가짜 `VITE_*` 를 로컬 미사용 포트로) 게임 페이지가 콘솔 오류 없이 그려지는지(백엔드 없음 → 빈·오류 상태 화면까지) 브라우저로 확인 후 서버 종료.
- [ ] 보고: 각 검증 결과, 바꾼 파일, 커밋 목록, 계획과 다르게 한 점, 확신 없는 점.
