# web_client TypeScript 전환 — 설계 스펙

> 작성일: 2026-10-13 · 상태: 승인됨 · 선행 작업: 트레이딩 게임 서브페이즈 6(게임 화면을 `.tsx`로 작성하기 위함)
> 기준 스펙: `docs/superpowers/specs/2026-10-12-admin-web-typescript-migration-design.md`(admin_web 전환). 이 문서는 그 방식을 web_client에 적용하며, 차이점만 구체화한다.

## 1. 배경 / 목표

- admin_web은 2026-10-12 `strict` TS로 전환 완료. web_client만 JS(JSX)로 남아 있다.
- 서브페이즈 6에서 web_client에 실시간 트레이딩 화면(WS 메시지 `tick`/`position_pnl`/`nudge` 등)을 추가하기 전에 **`strict: true` TypeScript로 완전 전환**한다.
- **불변 조건: 런타임 동작 변화 0.** API 호출·응답 처리·UI 레이아웃·스타일이 전환 전과 동일해야 한다.

### 범위
- 포함: `web_client/src/` 코드 파일 19개(약 700줄, `index.css`는 그대로) `.js/.jsx` → `.ts/.tsx`, 빌드 설정, 타입 정의.
- 제외: 게임 API 클라이언트/타입(서브페이즈 6), Vitest 등 테스트 프레임워크, ESLint.
- 루트 설정 파일 `vite.config.js`·`postcss.config.js`·`tailwind.config.js`는 **JS 유지**(`tsconfig.node.json` 추가하지 않음).

## 2. 전환 방식 — `allowJs` 점진 전환

기반 단계에서 `allowJs: true` + `strict: true`를 켜고 **하위 레이어부터 파일 단위로** 전환한다. 각 태스크 종료 시 `tsc --noEmit`와 빌드가 모두 통과해야 한다.

1. **기반**: `typescript`·`@types/react`·`@types/react-dom` devDependency 추가(`package-lock.json` 함께 커밋), `tsconfig.json`, `src/vite-env.d.ts`, Tailwind `content` glob 확장, `src/types/` 골격, `build` 스크립트를 `tsc --noEmit && vite build`로 변경.
2. **데이터 레이어**: `config` · `store/auth` · `store/boards` · `api/client` · `api/auth` · `api/blog`
3. **컴포넌트**: `components/ui/`(Button, Card, Chip, EmptyState) · `Layout` · `LoginModal` · `NotificationToaster`
4. **페이지**: `HomePage` · `PostListPage` · `PostDetailPage` · `GamePage`
5. **진입점**: `main` · `App` + `index.html`의 `/src/main.jsx` → `/src/main.tsx`, `allowJs` 제거(이 시점에 `src/`에 `.js/.jsx`가 남아 있으면 실패해야 함).

### 필수 설정 세부
- **Tailwind**: `content: ['./index.html', './src/**/*.{js,jsx}']` → `'./src/**/*.{js,jsx,ts,tsx}'`. 누락 시 빌드는 성공하나 UI가 무스타일이 된다(가장 유력한 조용한 회귀).
- **`src/vite-env.d.ts`**: `/// <reference types="vite/client" />` + `ImportMetaEnv`에 `VITE_API_BASE_URL`·`VITE_AUTH_BASE_URL`(readonly string | undefined). `config`의 `readEnv(name)`과 `DEV_FALLBACK`을 이 키 유니온으로 타입화한다.
- **tsconfig 핵심 옵션**: admin_web과 동일 — `target ES2020`, `lib [ES2020, DOM, DOM.Iterable]`, `module ESNext`, `moduleResolution bundler`, `jsx react-jsx`, `strict true`, `noEmit true`, `isolatedModules true`, `skipLibCheck true`, `allowJs true`(5단계에서 제거), `include ["src"]`.
- **서드파티 타입**: axios, zustand(v4), react-router-dom(v6)는 자체 타입 동봉 → `@types/*` 추가 불필요.
- 확장자를 명시한 import(`'./x.jsx'`)가 있으면 리네임 시 함께 수정한다(구현 시 grep으로 확인).

## 3. 타입 정책 (리뷰에서 강제)

1. **로직 무변경**: 타입 표기·선언·단언 외의 코드 변경 금지. strict 때문에 null 가드·기본값·분기가 필요해지면 **추가하지 말고 보고**(DONE_WITH_CONCERNS). 타입만을 위한 non-null 단언(`!`)은 근거 주석과 함께 허용.
2. **API 타입의 출처는 백엔드 스키마**: blog/auth 응답은 `backend/apps/blog`·`backend/apps/auth`의 pydantic 응답 스키마를 기준으로 `src/types/`에 정의한다. 알림 SSE 이벤트 페이로드는 blog의 발행 코드를 기준으로 한다. 프론트 사용 방식에서 역추론하지 않는다.
3. **탈출구 제한**: 기본은 `unknown` + 좁히기. `as`는 axios 응답·SSE `MessageEvent.data` 파싱 같은 **경계**에서만. `@ts-expect-error`는 서드파티 타입 공백에만(사유 주석 필수). `@ts-ignore`·명시적 `any` 금지. 최종 리뷰에서 `as`/`@ts-expect-error`/`!` 개수를 집계해 보고한다.
4. **이력 보존**: 리네임은 반드시 `git mv`. 스테이징은 명시 경로만(`git add -A`/`git add .` 금지).

## 4. 검증

### 태스크별 (공통 종료 조건)
`vite.config.js`가 build 시 VITE_* 누락이면 throw하므로 더미 값을 인라인으로 준다:

```bash
cd web_client
npx tsc --noEmit
VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
```

### 최종 브라우저 스모크
- 기동: blog(8000)·auth(8001) + `npm run dev`(3000). PG는 dev 터널(15432)이 내려가 있으면 로컬 docker PG로 대체. 자격증명은 채팅에 출력하지 않음.
- 체크리스트:
  1. 홈 렌더 + **Tailwind 스타일 적용**(무스타일 아님)
  2. 2단 네비(데스크톱/모바일 폭) 동작
  3. 게시판 목록 → 글 상세 → 댓글 표시
  4. 임시 로그인 모달 → 로그인 후 댓글 작성
  5. 알림 토스트(SSE) 수신
  6. 게임 탭 "시즌 준비 중" 스켈레톤
  7. 콘솔 에러 없음

### 머지 전 (배포 보호)
`main` 푸시 시 `deploy-web.yml`이 web_client Docker 빌드(`npm ci && npm run build`)를 실행한다. 머지 전에 `npm ci` 후 위 build 명령으로 클린 빌드를 재확인한다(설치 디렉터리 삭제가 필요하면 사용자 확인 후).

## 5. 산출물 / 문서

- `web_client/tsconfig.json`, `web_client/src/vite-env.d.ts`, `web_client/src/types/*.ts`, 전환된 `src/**/*.{ts,tsx}`, 수정된 `package.json`·`package-lock.json`·`tailwind.config.js`·`index.html`.
- README: web_client 빌드가 타입 검사를 포함함(`npm run build` = `tsc --noEmit && vite build`)을 명시.
- ROADMAP: 상시 백로그의 "web_client TypeScript 전환" 체크.

## 6. 이후 단계
main 머지 후 트레이딩 게임 서브페이즈 6(web_client·mobile 실시간 트레이딩 화면) 브레인스토밍을 시작한다.
