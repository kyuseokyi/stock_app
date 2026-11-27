# 프론트엔드 현대화 Phase 1 — 관리자 웹 Tailwind v4 + `@theme` 토큰 + shadcn/ui 코어 설계

> 작성 2026-11-27 · 원 기획: [`docs/frontend_modernization_tailwind4_shadcn_tanstack_spec.md`](../../frontend_modernization_tailwind4_shadcn_tanstack_spec.md)
> 이 문서가 원 기획과 다르면 **이 문서가 우선**. Phase 2~6 은 단계마다 따로 설계한다.

## 0. 원 기획에서 바꾼 것 (사용자 결정 2026-11-27)

| 원 기획 | 이 설계 | 이유 |
|---|---|---|
| Phase 1 에서 `web_client`·`admin_web` 동시 v4 | **`admin_web` 만.** `web_client` 의 v4 전환은 Phase 2~6 을 다 마친 뒤 별도 단계(옛 안드로이드 웹뷰 확인 후) | Tailwind v4 는 Safari 16.4·Chrome 111·Firefox 128 이상만 지원. 사용자 웹은 카카오톡 인앱 브라우저로도 들어옴 |
| 토큰 통합과 함께 화면이 바뀔 수 있음 | **화면 모양 그대로(픽셀 비교로 증명).** shadcn 부품은 만들어 두기만, 기존 화면 교체·파스텔 통일은 Phase 6 | 관리자 대부분 화면은 slate·indigo 기본 팔레트, 파스텔은 주도주·급등락·AI Lab 만 |
| `@theme` 예시에 `kakao`·`naver`·`sky` 없음 | **기존 토큰 전부 유지**(같은 이름·같은 값) + shadcn 시맨틱 이름을 같은 변수로 연결 | 빠뜨리면 소셜 로그인 버튼 색이 사라짐 |
| `.dark` 토큰 | 값만 정의, 켜는 스위치·`dark` 클래스 적용은 Phase 6 | 지금 화면 변화 없음 |

## 1. 범위
- 대상: `admin_web` 만. `web_client`·`mobile`·백엔드는 손대지 않는다.
- 하는 것: Tailwind v3 → v4 전환, 토큰을 `@theme` 로 이전, shadcn/ui 코어 부품·`cn()`·`@/` 경로 별칭, vitest 테스트 환경.
- 하지 않는 것: 기존 화면의 부품 교체, 색 변경, 다크 모드 켜기, Zustand·TanStack 작업(Phase 2~4).

## 2. 전환 방법 (A안 — 공식 변환 도구 + 화면 사진 비교)
1. **기준 사진(v3)**: 전환 전 코드로 대표 화면을 가짜 API 로 띄워 1440px·390px 전체 화면 사진을 찍어 둔다.
2. **변환**: `npx @tailwindcss/upgrade` 실행. 하는 일 — `tailwind.config.js` 를 CSS `@theme` 로 이전, 이름이 바뀐 클래스 변경(`shadow-sm→shadow-xs`, `shadow→shadow-sm`, `rounded-sm→rounded-xs`, `rounded→rounded-sm`, `ring→ring-3`, `outline-none→outline-hidden` 등), v3 테두리 기본색(gray-200)을 유지하는 호환 CSS 추가. 이 결과를 **커밋 하나로 따로** 남긴다(검토·되돌리기 쉽게).
3. **빌드 경로**: PostCSS 의 tailwind·autoprefixer 대신 `@tailwindcss/vite` 플러그인. `@tailwindcss/typography` 는 CSS `@plugin` 으로.
4. **비교(v4)**: 같은 화면을 같은 가짜 데이터로 다시 찍어 픽셀 비교. 기준 — 차이 0 이 목표, 차이가 나면 원인을 찾아 고치거나(호환 CSS·클래스) 설명 가능한 차이(글꼴 렌더링 1px 등)만 남기고 보고서에 적는다.
   - 대상 화면(10개 안팎): 로그인, 대시보드, 회원 목록, 게시판·게시글 편집(RichTextEditor·typography), 주도주, 5·20 정배열, 조건검색, 차트 패턴, 급등락·테마 분석, AI Lab, 사이드바 펼침(390px).
   - 도구: vite dev 서버 + 가짜 API 서버(작업 임시 폴더) + 브라우저 자동화 스크린샷, 픽셀 비교 스크립트. 사진·스크립트는 커밋하지 않는다.

## 3. 토큰 (`src/index.css`)
- `@import "tailwindcss";` + `@plugin "@tailwindcss/typography";`
- `:root` 에 shadcn 시맨틱 변수(원 기획 2.1-A 의 Light 값)와 반경(`--radius-card/btn/field`).
- `.dark` 에 원 기획의 Dark 값(정의만).
- `@theme inline` 에서:
  - **기존 이름 그대로**: `brand`(DEFAULT·soft·strong), `up`/`down`(DEFAULT·soft), `ink`(DEFAULT·muted), `canvas`, `surface`, `fill`, `sky-soft`, `accent`, `danger`(DEFAULT·soft), `line`, `kakao`, `naver`, `radius card/btn/field` — 값은 지금 `tailwind.config.js` 와 같아야 한다(라이트 기준).
  - **shadcn 이름**: `background`, `foreground`, `card(-foreground)`, `popover(-foreground)`, `primary(-foreground)`, `secondary(-foreground)`, `muted(-foreground)`, `accent-foreground`, `destructive`, `border`, `input`, `ring` 을 같은 변수로.
  - Tailwind 기본 팔레트(slate·indigo 등)는 그대로 둔다(관리자 기존 화면이 씀). `sky` 는 기본 `sky` 와 합쳐지는 지금 동작을 유지(`sky-soft` 만 추가).
- `primary` = `brand-strong`(#4963c1, 흰 글자 대비 AA 통과). 기존 CTA(`bg-brand` + `text-ink`)는 그대로 두고, shadcn Button 기본 변형만 `primary` 를 쓴다.

## 4. shadcn/ui 코어 (`src/components/ui/`, `src/lib/utils.ts`)
- 의존성: `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `@radix-ui/react-{dialog,tabs,select,popover,tooltip,switch,slot}`. 모두 정확한 버전으로 고정(2주 이상 지난 버전).
- `@/` 별칭: `vite.config.js` 의 `resolve.alias` + `tsconfig.json` 의 `paths`. 기존 상대 경로 import 는 바꾸지 않는다.
- 부품: `Button`, `Card`, `Badge`, `Chip`, `Dialog`, `Sheet`, `Tabs`, `Select`, `Switch`, `Table`, `Skeleton`, `EmptyState`. shadcn 표준 코드를 기준으로 파스텔 토큰 이름을 쓰고, 한국어 기본 문구(닫기 버튼 `aria-label="닫기"` 등). 숫자 표시용 부품은 `tabular-nums`.
- 이번 단계에서 기존 화면은 이 부품을 import 하지 않는다(교체는 Phase 6). 따라서 사진 비교 대상에 영향 없음.

## 5. 테스트 환경
- `vitest` + `@testing-library/react` + `@testing-library/user-event` + `jsdom`, `package.json` 에 `"test": "vitest run"`.
- 테스트: `cn()` 병합 규칙, `Button` 변형·크기 클래스, `Dialog` 열기·ESC 닫기·포커스 복귀, `Tabs` 키보드 이동, `Switch` 토글.
- 배포 워크플로(`deploy-prod.yml` 의 Web unit tests)에 admin_web 테스트를 넣을지는 이번에 바꾸지 않는다(워크플로 변경은 별도).

## 6. 작업 환경 주의
- 작업 폴더 `../wt-fe-p1`(브랜치 `feature/fe-phase1-admin-tw4`). **`admin_web/node_modules` 는 링크가 아닌 독립 설치**(메인 폴더 node_modules 가 v4 로 바뀌지 않게).
- Docker 빌드는 `node:20-alpine` — Tailwind v4·`@tailwindcss/vite`(oxide 네이티브 바이너리, musl 포함)가 alpine 에서 설치·빌드되는지 `docker build` 로 확인한다.
- 빌드는 필수 `VITE_*` 가 없으면 실패(기존 규칙) — 검증 때는 셸에서 가짜 값을 넣는다. env 파일은 읽지 않는다.

## 7. 완료 기준
- `npx tsc --noEmit`, `npm run build`, `npm test` 통과.
- 2절 대상 화면의 v3↔v4 픽셀 비교 보고서(차이 0, 또는 원인과 판단이 적힌 차이 목록).
- alpine Docker 빌드 통과.
- `README.md` 의 admin_web 부분에 테스트 명령·Tailwind v4 한 줄.
