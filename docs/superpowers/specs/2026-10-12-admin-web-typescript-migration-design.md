# admin_web TypeScript 전환 — 설계 스펙

> 작성일: 2026-10-12 · 상태: 승인됨 · 선행 작업: 트레이딩 게임 서브페이즈 5a(코치 UI를 `.tsx`로 작성하기 위함)

## 1. 배경 / 목표

- 프론트엔드 3개 중 `mobile/`만 TS이고, `admin_web/`·`web_client/`는 JS(JSX)다(tsconfig·typescript 의존성 없음).
- 트레이딩 게임 서브페이즈 5a에서 admin_web에 코치 발행 페이지를 추가하기 전에, admin_web을 **`strict: true` TypeScript로 완전 전환**한다.
- **불변 조건: 런타임 동작 변화 0.** API 호출·응답 처리·UI 레이아웃·스타일이 전환 전과 동일해야 한다.

### 범위
- 포함: `admin_web/src/` 전 코드 파일(24개, 약 2,430줄. `index.css`는 그대로) `.js/.jsx` → `.ts/.tsx`, 빌드 설정, 타입 정의.
- 제외: `web_client/` 전환(서브페이즈 6 직전 별도 사이클, ROADMAP 기록), Vitest 등 테스트 프레임워크 도입, ESLint 도입.
- 루트 설정 파일 `vite.config.js`·`postcss.config.js`·`tailwind.config.js`는 **JS 유지**(`tsconfig.node.json` 추가하지 않음).

## 2. 전환 방식 — `allowJs` 점진 전환

`strict: true`로 한 번에 전부 바꾸면 마지막 파일이 끝날 때까지 빌드가 깨진다. 대신 기반 단계에서 `allowJs: true` + `strict: true`를 켜고, **하위 레이어부터 파일 단위로** 전환한다. 각 태스크 종료 시 `tsc --noEmit`와 빌드가 모두 통과해야 한다.

전환 순서(각 단계에서 import하는 하위 레이어는 이미 타입이 있음):

1. **기반**: `typescript`·`@types/react`·`@types/react-dom` devDependency 추가(`package-lock.json` 함께 커밋), `tsconfig.json`, `src/vite-env.d.ts`, Tailwind `content` glob 확장, `src/types/` 골격, `build` 스크립트를 `tsc --noEmit && vite build`로 변경.
2. `config` · `lib/toast` · `store/ui`
3. `api/` 6개(`client`, `auth`, `boards`, `blogs`, `comments`, `stockClient`)
4. `hooks/useChartDrawings`
5. 소형 컴포넌트: `Layout`, `Sidebar`, `RequireAuth`, `NotificationToaster`, `RichTextEditor`
6. 페이지 7개: `LoginPage`, `BoardsPage`, `BlogListPage`, `BlogDetailPage`, `BlogEditorPage`, `MembersPage`, `StatsPage`
7. **`ChartSnapshotModal`(897줄) 단독 태스크** — echarts 콜백·DOM ref·드로잉 좌표 변환이 몰려 있어 분리한다.
8. `main` · `App` + `index.html`의 `/src/main.jsx` → `/src/main.tsx`, `allowJs` 제거(이 시점에 `src/`에 `.js/.jsx`가 남아 있으면 실패해야 함).

### 필수 설정 세부
- **Tailwind**: `content: ['./index.html', './src/**/*.{js,jsx}']` → `'./src/**/*.{js,jsx,ts,tsx}'`. 누락하면 `.tsx`로 바뀐 파일의 클래스가 퍼지되어 **빌드는 성공하나 UI가 무스타일**이 된다(가장 유력한 조용한 회귀).
- **`src/vite-env.d.ts`**: `/// <reference types="vite/client" />` + `ImportMetaEnv`에 `VITE_API_BASE_URL`·`VITE_AUTH_BASE_URL`·`VITE_STOCK_API_URL`(readonly string | undefined) 선언. `config`의 `import.meta.env[name]` 접근을 이 키 유니온으로 타입화한다.
- **tsconfig 핵심 옵션**: `target ES2020`, `lib [ES2020, DOM, DOM.Iterable]`, `module ESNext`, `moduleResolution bundler`, `jsx react-jsx`, `strict true`, `noEmit true`, `isolatedModules true`, `skipLibCheck true`, `allowJs true`(8단계에서 제거), `include ["src"]`.
- **서드파티 타입**: axios, zustand(v4), react-router-dom(v6), @tiptap/react(v2), echarts, echarts-for-react, graphql-request(v7)는 자체 타입 동봉 확인됨 → `@types/*` 추가 불필요.
- 확장자를 명시한 import(`'./x.jsx'`)는 현재 없음(확인됨) → 리네임만으로 해석 유지.

## 3. 타입 정책 (리뷰에서 강제)

1. **로직 무변경**: 타입 표기·타입 선언·타입 단언 외의 코드 변경 금지. strict 때문에 null 가드·기본값·분기가 필요해지면 **추가하지 말고 보고**(DONE_WITH_CONCERNS)한다. 단, 타입만을 위한 non-null 단언(`!`)은 런타임 동작이 동일하므로 근거 주석과 함께 허용.
2. **API 타입의 출처는 백엔드 스키마**: blog/auth 응답은 `backend/apps/blog`·`backend/apps/auth`의 pydantic 응답 스키마를, 차트/검색은 `backend/apps/stock_api`의 Strawberry GraphQL 타입을 기준으로 `src/types/`에 정의한다. 프론트가 "쓰는 방식"에서 역추론하지 않는다.
3. **탈출구 제한**:
   - 기본은 `unknown` + 좁히기.
   - `as` 단언은 axios 응답·GraphQL 응답·`CustomEvent.detail` 같은 **경계**에서만.
   - `@ts-expect-error`는 서드파티 타입 공백에만, 사유 주석 필수. `@ts-ignore` 금지.
   - 명시적 `any` 금지.
   - 최종 리뷰에서 `as`/`@ts-expect-error`/`!` 사용 개수를 집계해 보고한다.
4. **이력 보존**: 리네임은 반드시 `git mv`. 스테이징은 명시 경로만(`git add -A`/`git add .` 금지).

## 4. 검증

### 태스크별 (모든 태스크 공통 종료 조건)
`.env.production`이 없고 `vite.config.js`가 build 시 VITE_* 누락이면 throw하므로, 더미 값을 인라인으로 준다:

```bash
cd admin_web
npx tsc --noEmit
VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x VITE_STOCK_API_URL=http://x npm run build
```

둘 다 성공해야 태스크 완료.

### 최종 브라우저 스모크
- 기동: blog(8000)·auth(8001)·stock_api(8002) + `npm run dev`(5173). PG는 dev 터널(15432)이 내려가 있으면 로컬 docker PG(5432)로 대체. 관리자는 기존 시드 계정 사용(자격증명은 채팅에 출력하지 않음).
- 체크리스트:
  1. 로그인 → 레이아웃·사이드바 렌더, **Tailwind 스타일 적용**(무스타일 아님)
  2. 모바일 폭에서 사이드바 드로어 토글
  3. 게시판 목록/생성
  4. 글 목록 → 상세(댓글 포함)
  5. 글 작성/수정(TipTap 툴바·이미지·링크)
  6. 차트 삽입 모달: 종목 검색 → 기간 → 차트 렌더 → 드로잉 4종 → 캡처 삽입
  7. 회원·통계 페이지 진입
  8. 콘솔 에러 없음
- 401 시 로그인 리다이렉트는 토큰 제거로 확인.

### 머지 전 (배포 보호)
`main` 푸시 시 `deploy-web.yml`이 Docker 빌드(`npm ci && npm run build`)를 실행한다. 머지 전에 `rm -rf node_modules && npm ci && <위 build 명령>`으로 클린 빌드를 재확인해, 타입 에러·lockfile 불일치로 운영 admin 배포가 깨지지 않게 한다.

## 5. 산출물 / 문서

- `admin_web/tsconfig.json`, `admin_web/src/vite-env.d.ts`, `admin_web/src/types/*.ts`, 전환된 `src/**/*.{ts,tsx}`, 수정된 `package.json`·`package-lock.json`·`tailwind.config.js`·`index.html`.
- README: admin_web 빌드가 타입 검사를 포함함(`npm run build` = `tsc --noEmit && vite build`)을 명시.
- ROADMAP: "admin_web TypeScript(strict) 전환" 완료 항목 추가, 상시 백로그에 "web_client TS 전환(서브페이즈 6 직전)" 추가.

## 6. 이후 단계
이 전환을 main에 머지한 뒤, 트레이딩 게임 서브페이즈 5a(코치 API + admin_web 코치 UI(`.tsx`) + 넛지 엔진) 브레인스토밍을 재개한다. 5a의 미결 질문(넛지 전달 경로: REST/WS)은 그때 다룬다.
