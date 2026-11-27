# 프론트엔드 현대화 Phase 1 (관리자 웹) 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬 — superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans 로 작업 단위마다 실행한다. 단계는 체크박스(`- [ ]`)로 추적한다.

**목표:** `admin_web` 을 Tailwind v3 → v4(`@theme` 토큰)로 바꾸고 shadcn/ui 코어 부품을 만들어 두되, 기존 화면 모양은 픽셀 단위로 그대로 유지한다.

**구조:** 공식 변환 도구(`@tailwindcss/upgrade`)로 설정·클래스를 옮기고, 전환 전후 대표 화면을 같은 가짜 API 데이터로 찍어 픽셀 비교로 회귀가 없음을 증명한다. shadcn 부품은 `src/components/ui/` 에 새로 두고 기존 화면은 이번에 import 하지 않는다.

**기술:** Tailwind CSS 4.3.5 + `@tailwindcss/vite`, Radix UI, class-variance-authority, tailwind-merge, clsx, lucide-react, Vitest 2.1.9 + Testing Library + jsdom, 사진 비교는 playwright-core(시스템 Chrome) + pixelmatch.

설계: [`docs/superpowers/specs/2026-11-27-frontend-modernization-phase1-admin-design.md`](../specs/2026-11-27-frontend-modernization-phase1-admin-design.md)

---

## 공통 규칙 (모든 작업)
- 작업 폴더 `/Users/kyuseok/Documents/private/projects/ivyro/work_space/wt-fe-p1`, 브랜치 `feature/fe-phase1-admin-tw4`. 명령은 특별히 적지 않으면 `admin_web/` 에서.
- `admin_web/node_modules` 는 **독립 설치**(링크 아님). 메인 폴더(`../stock_app`)에서 npm 명령을 돌리지 않는다.
- 금지: merge·push, env 파일 읽기·수정, `git add -A`·`git add .`·`git stash`(목록 포함)·`git reset`·`git checkout --`·`rm -rf`, 실제 백엔드·외부 API 호출.
- 빌드는 필수 env 가 없으면 실패하므로 항상 가짜 값으로:
  `export VITE_API_BASE_URL=http://localhost:4010 VITE_AUTH_BASE_URL=http://localhost:4010 VITE_STOCK_API_URL=http://localhost:4010`
- 임시 도구·사진은 `T=/Users/kyuseok/.claude/jobs/cfc9cd18/tmp/fe-p1` 에 두고 커밋하지 않는다.
- 커밋 메시지는 한국어, 끝에 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```

## 파일 구조
| 파일 | 역할 |
|---|---|
| `admin_web/package.json`·`package-lock.json` | 의존성(정확한 버전), `test` 스크립트 |
| `admin_web/vite.config.js` | `@tailwindcss/vite` 플러그인, `@/` 별칭, vitest 설정 |
| `admin_web/tsconfig.json` | `@/*` 경로 |
| `admin_web/postcss.config.js` | 삭제(v4 는 vite 플러그인) |
| `admin_web/tailwind.config.js` | 삭제(토큰은 CSS `@theme` 로) |
| `admin_web/src/index.css` | `@import "tailwindcss"`, 호환 CSS, `:root`·`.dark` 변수, `@theme inline` |
| `admin_web/src/lib/utils.ts` (+ `.test.ts`) | `cn()` |
| `admin_web/src/components/ui/*.tsx` (+ 테스트) | shadcn 코어 부품 12개 |
| `admin_web/src/test/setup.ts` | jest-dom 매처, jsdom 보충 |
| 그 밖의 `src/**/*.tsx` | 변환 도구가 바꾼 클래스 이름만(작업 5의 보정 제외) |

---

### 작업 1: 사진 비교 도구와 v3 기준 사진 (코드 변경·커밋 없음)

**파일(임시):** `$T/package.json`, `$T/fake-api.mjs`, `$T/fixtures.mjs`, `$T/shoot.mjs`, `$T/diff.mjs`

- [ ] **1단계: 도구 폴더**
```bash
T=/Users/kyuseok/.claude/jobs/cfc9cd18/tmp/fe-p1; mkdir -p $T/shots/v3 $T/shots/v3b $T/shots/v4 $T/shots/diff && cd $T
cat > package.json <<'EOF'
{ "name": "fe-p1-tools", "private": true, "type": "module",
  "dependencies": { "playwright-core": "1.58.0", "pixelmatch": "7.1.0", "pngjs": "7.0.0" } }
EOF
npm install --no-audit --no-fund
```
버전이 없다고 나오면 `npm view <패키지> time` 으로 2주 이상 지난 정식 버전으로 바꾼다. 브라우저는 내려받지 않고 시스템 Chrome(`channel: 'chrome'`)을 쓴다.

- [ ] **2단계: 가짜 API 서버** `$T/fake-api.mjs` — 세 API 주소를 모두 `http://localhost:4010` 로 받는다. 없는 경로는 `{}` 를 주고 로그에 남긴다.
```js
import http from 'node:http'
import { fixtures } from './fixtures.mjs'

const miss = new Set()
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const key = `${req.method} ${url.pathname}`
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', '*')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
  const hit = Object.entries(fixtures).find(([k]) => new RegExp(`^${k}$`).test(key))
  if (!hit && !miss.has(key)) { miss.add(key); console.log('MISS', key) }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(hit ? (typeof hit[1] === 'function' ? hit[1](url) : hit[1]) : {}))
}).listen(4010, () => console.log('fake api :4010'))
```

- [ ] **3단계: fixture** `$T/fixtures.mjs` — `export const fixtures = { 'GET /auth/me': {...}, 'GET /api/v1/admin/...': {...} }`(키는 정규식, 값은 JSON 또는 `(url) => JSON`). 경로와 응답 타입은 `admin_web/src/api/*.ts`·`src/types/api.ts` 에서 찾는다.
  - 로그인 사용자: 최고 관리자(모든 권한), `UserOut` 모양. 사이드바 메뉴가 전부 보여야 한다.
  - 목록은 3~5행 고정 데이터(숫자·한글·긴 이름 1개 포함). 날짜·시각은 고정 문자열(`2026-11-26`).
  - 대상 화면: `/login`, `/`, `/members`, `/boards`, `/blogs/new`, `/market/leaders`, `/market/ma-screener`, `/market/finder`, `/market/patterns`, `/market/daily-surge`, `/market/ai-lab?ticker=005930`, `/market/status`.
  - 4단계 촬영을 돌려 보며 `MISS` 로그에 대상 화면용 경로가 남지 않을 때까지 채운다(화면이 오류 문구만 보이면 그 경로는 채워야 한다).

- [ ] **4단계: 촬영** `$T/shoot.mjs` (`node shoot.mjs <폴더> <포트>`)
```js
import { chromium } from 'playwright-core'
const [, , tag, port] = process.argv
const ROUTES = ['/login', '/', '/members', '/boards', '/blogs/new', '/market/leaders', '/market/ma-screener',
  '/market/finder', '/market/patterns', '/market/daily-surge', '/market/ai-lab?ticker=005930', '/market/status']
const SIZES = [{ w: 1440, h: 900, n: 'w' }, { w: 390, h: 844, n: 'm' }]
const USER = JSON.parse(process.env.FAKE_USER_JSON)
const browser = await chromium.launch({ channel: 'chrome' })
for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await ctx.addInitScript((u) => {
    if (location.pathname !== '/login') { localStorage.setItem('token', 'fake'); localStorage.setItem('user', JSON.stringify(u)) }
    else localStorage.clear()
  }, USER)
  const page = await ctx.newPage()
  for (const r of ROUTES) {
    await page.goto(`http://localhost:${port}${r}`, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '*{caret-color:transparent!important;animation:none!important;transition:none!important}' })
    await page.waitForTimeout(500)
    const name = r.replace(/[/?=]/g, '_') || '_root'
    await page.screenshot({ path: `shots/${tag}/${s.n}${name}.png`, fullPage: true })
  }
  await ctx.close()
}
await browser.close()
```
`FAKE_USER_JSON` 은 `node -e "import('./fixtures.mjs').then(m=>console.log(JSON.stringify(m.fixtures['GET /auth/me'])))"` 로 만든다(키가 다르면 맞춘다).

- [ ] **5단계: 비교** `$T/diff.mjs` (`node diff.mjs <기준> <비교>`, 기본 v3 v4)
```js
import fs from 'node:fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
const [, , A = 'v3', B = 'v4'] = process.argv
let bad = 0
for (const f of fs.readdirSync(`shots/${A}`)) {
  const a = PNG.sync.read(fs.readFileSync(`shots/${A}/${f}`))
  const p = `shots/${B}/${f}`
  if (!fs.existsSync(p)) { console.log('없음', f); bad++; continue }
  const b = PNG.sync.read(fs.readFileSync(p))
  if (a.width !== b.width || a.height !== b.height) { console.log(`크기 다름 ${f} ${A}=${a.width}x${a.height} ${B}=${b.width}x${b.height}`); bad++; continue }
  const out = new PNG({ width: a.width, height: a.height })
  const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 })
  if (n) { fs.writeFileSync(`shots/diff/${f}`, PNG.sync.write(out)); bad++ }
  console.log(n ? `차이 ${n}px (${((n / (a.width * a.height)) * 100).toFixed(3)}%) ${f}` : `같음 ${f}`)
}
process.exit(bad ? 1 : 0)
```

- [ ] **6단계: v3 기준 촬영** (작업 폴더 코드는 아직 dev 그대로)
```bash
cd $T && (node fake-api.mjs > fake.log 2>&1 &)
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/wt-fe-p1/admin_web
(VITE_API_BASE_URL=http://localhost:4010 VITE_AUTH_BASE_URL=http://localhost:4010 VITE_STOCK_API_URL=http://localhost:4010 npx vite --port 5181 --strictPort > $T/vite3.log 2>&1 &)
cd $T && FAKE_USER_JSON="$(node -e "import('./fixtures.mjs').then(m=>console.log(JSON.stringify(m.fixtures['GET /auth/me'])))")" node shoot.mjs v3 5181 && ls shots/v3 | wc -l
```
기대 24장. 한 번 더 `shoot.mjs v3b 5181` 로 찍고 `node diff.mjs v3 v3b` 가 **모두 같음**인지 확인(촬영이 흔들리면 원인 — 시계·애니메이션·무작위 — 을 fixture·스타일로 고정하고 다시). 확인 뒤 5181 vite 서버를 끈다(가짜 API 는 계속 둬도 됨).

---

### 작업 2: Tailwind v4 변환 도구 실행

- [ ] **1단계:** `git status --short` 가 비어 있는지 확인(도구 요구).
- [ ] **2단계: 실행**
```bash
cd admin_web && npx @tailwindcss/upgrade@4.3.5 --force 2>&1 | tee $T/upgrade.log
```
- [ ] **3단계: 결과 확인**
  - `package.json` 의 `tailwindcss` 가 정확히 `4.3.5` 인지(범위면 정확한 값으로 고친다).
  - `src/index.css` 첫 줄 `@import 'tailwindcss';`, `@plugin '@tailwindcss/typography';`, 테두리 기본색 호환 블록(`border-color: var(--color-gray-200, currentcolor)`) 유무.
  - `git diff --stat`, `git diff -U0 -- admin_web/src | grep '^[-+]' | grep -v '^[-+][-+]' | head -80` 로 바뀐 클래스 표본(`shadow-sm→shadow-xs`, `rounded→rounded-sm`, `outline-none→outline-hidden`, `ring→ring-3` 등). 클래스 외 로직이 바뀐 곳은 보고서에 적는다.
- [ ] **4단계: 커밋**(변환 결과만) — 바뀐 경로를 하나씩 `git add`(삭제된 파일은 `git add -u <경로>`):
`chore: 관리자 웹 Tailwind v4 공식 변환 도구(@tailwindcss/upgrade 4.3.5) 결과 — 설정·클래스 이름 이전, v3 테두리 호환 CSS`

---

### 작업 3: 빌드 경로를 `@tailwindcss/vite` 로

**파일:** `admin_web/vite.config.js`, `admin_web/package.json`, 삭제 `admin_web/postcss.config.js`

- [ ] **1단계: 의존성**
```bash
npm install --save-exact -D tailwindcss@4.3.5 @tailwindcss/vite@4.3.5 @tailwindcss/typography@0.5.20
npm uninstall @tailwindcss/postcss autoprefixer
```
`postcss` 를 다른 설정이 쓰지 않으면(`grep -rln postcss admin_web --include=*.js --include=*.cjs --include=*.json | grep -v node_modules`) 함께 제거.
- [ ] **2단계: `vite.config.js`** — 기존 필수 env 검사는 그대로, 플러그인만:
```js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// …(REQUIRED·검사 블록 기존 그대로)…
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, host: true },
  }
```
- [ ] **3단계:** `git rm admin_web/postcss.config.js`(이미 없으면 건너뜀).
- [ ] **4단계: 검증**
```bash
npx tsc --noEmit && (export VITE_API_BASE_URL=http://localhost:4010 VITE_AUTH_BASE_URL=http://localhost:4010 VITE_STOCK_API_URL=http://localhost:4010; npm run build) 2>&1 | tail -5
for c in bg-surface text-ink prose; do grep -c "\.$c" dist/assets/*.css; done
```
기대: 빌드 성공, 세 클래스 모두 1 이상.
- [ ] **5단계: 커밋** — `feat: 관리자 웹 빌드를 @tailwindcss/vite 로(PostCSS 경로 제거)`

---

### 작업 4: `@theme inline` 토큰 — 기존 이름 + shadcn 이름 + `.dark`

**파일:** `admin_web/src/index.css`, 삭제 `admin_web/tailwind.config.js`(남아 있으면)

- [ ] **1단계: 기준값** (변환 전 dev 의 `tailwind.config.js`):
`brand #6f8ef0 / brand-soft #e2ecff / brand-strong #4963c1 / up #b6265d / up-soft #fbd6e4 / down #3c5dc1 / down-soft #d8e3fd / ink #25223a / ink-muted #6a6681 / canvas #f7f5ff / surface #ffffff / fill #efebfb / sky-soft #e2ecff / accent #aa5278 / danger #a14f09 / danger-soft #fde7d4 / line #ebe7f7 / kakao #FEE500 / naver #03C75A / radius card 20px · btn 14px · field 12px`
- [ ] **2단계: 토큰 블록** — 변환 도구가 만든 `@theme { … }` 를 아래로 교체(호환 블록·`@plugin`·`body`·`.post-content` 등 나머지 규칙은 그대로):
```css
:root {
  --background: #f7f5ff; --foreground: #25223a;
  --card: #ffffff; --card-foreground: #25223a;
  --popover: #ffffff; --popover-foreground: #25223a;
  --primary: #4963c1; --primary-soft: #e2ecff; --primary-foreground: #ffffff;
  --secondary: #efebfb; --secondary-foreground: #25223a;
  --muted: #efebfb; --muted-foreground: #6a6681;
  --accent: #aa5278; --accent-foreground: #ffffff;
  --up: #b6265d; --up-soft: #fbd6e4; --down: #3c5dc1; --down-soft: #d8e3fd;
  --destructive: #a14f09; --destructive-soft: #fde7d4;
  --border: #ebe7f7; --input: #efebfb; --ring: #6f8ef0;
}
/* 다크 값은 정의만 — dark 클래스를 붙이는 곳이 아직 없다(Phase 6) */
.dark {
  --background: #1a1826; --foreground: #f3f1fa;
  --card: #24212f; --card-foreground: #f3f1fa;
  --popover: #24212f; --popover-foreground: #f3f1fa;
  --primary: #9fb4f7; --primary-soft: #2a3150; --primary-foreground: #1a1826;
  --secondary: #2c2839; --secondary-foreground: #f3f1fa;
  --muted: #2c2839; --muted-foreground: #a6a1bd;
  --accent: #f0a0c0;
  --up: #ff7aa2; --up-soft: #3d2230; --down: #8aa4ff; --down-soft: #23305a;
  --destructive: #ff8f80; --destructive-soft: #46231f;
  --border: #322e40; --input: #2c2839; --ring: #9fb4f7;
}
@theme inline {
  /* 기존 이름(라이트 값은 v3 tailwind.config.js 와 같음) */
  --color-brand: #6f8ef0;
  --color-brand-soft: var(--primary-soft);
  --color-brand-strong: var(--primary);
  --color-up: var(--up); --color-up-soft: var(--up-soft);
  --color-down: var(--down); --color-down-soft: var(--down-soft);
  --color-ink: var(--foreground); --color-ink-muted: var(--muted-foreground);
  --color-canvas: var(--background); --color-surface: var(--card); --color-fill: var(--secondary);
  --color-sky-soft: #e2ecff;
  --color-accent: var(--accent);
  --color-danger: var(--destructive); --color-danger-soft: var(--destructive-soft);
  --color-line: var(--border);
  --color-kakao: #FEE500; --color-naver: #03C75A;
  --radius-card: 20px; --radius-btn: 14px; --radius-field: 12px;
  /* shadcn 이름(같은 변수) */
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border); --color-input: var(--input); --color-ring: var(--ring);
}
```
주의: v3 `ink.DEFAULT`·`ink.muted` → v4 `ink`·`ink-muted` 로 클래스 이름은 같다(`text-ink`, `text-ink-muted`). `sky.soft` 는 기본 `sky` 팔레트를 지우지 않도록 `--color-sky-soft` 만 추가(`--color-sky-*: initial` 금지). `index.css` 에 `@config` 줄이 있으면 지우고 `git rm admin_web/tailwind.config.js`.
- [ ] **3단계: 토큰 검사**
```bash
(export VITE_API_BASE_URL=http://localhost:4010 VITE_AUTH_BASE_URL=http://localhost:4010 VITE_STOCK_API_URL=http://localhost:4010; npm run build) >/dev/null
for c in bg-canvas bg-surface bg-fill text-ink text-ink-muted border-line text-up bg-up-soft text-down bg-danger-soft bg-brand bg-brand-soft text-brand-strong bg-kakao bg-naver bg-sky-soft rounded-card; do
  used=$(grep -rln "\b$c\b" src | wc -l | tr -d ' '); inc=$(grep -c "\.$c" dist/assets/*.css)
  echo "$c 사용=$used 생성=$inc"; done
```
기대: `사용` 이 1 이상인 클래스는 모두 `생성` 1 이상. 아니면 토큰 이름을 고친다.
- [ ] **4단계: 커밋** — `feat: 관리자 웹 토큰을 @theme inline 으로 — 기존 이름 유지 + shadcn 시맨틱 이름, 다크 값은 정의만`

---

### 작업 5: v4 촬영·픽셀 비교·차이 보정

- [ ] **1단계: 촬영과 비교**
```bash
cd admin_web && (VITE_API_BASE_URL=http://localhost:4010 VITE_AUTH_BASE_URL=http://localhost:4010 VITE_STOCK_API_URL=http://localhost:4010 npx vite --port 5182 --strictPort > $T/vite4.log 2>&1 &)
cd $T && FAKE_USER_JSON="$(node -e "import('./fixtures.mjs').then(m=>console.log(JSON.stringify(m.fixtures['GET /auth/me'])))")" node shoot.mjs v4 5182 && node diff.mjs v3 v4 | tee diff1.log
```
- [ ] **2단계: 원인 찾기** — `shots/diff/*.png` 의 빨간 영역 요소를 v4 화면에서 개발자 도구로 보고, v3 사진과 비교한다. 자주 나오는 원인:
  | 증상 | 원인 | 보정 (`src/index.css` 의 `@layer base`) |
  |---|---|---|
  | 테두리가 진해짐 | 기본 테두리색 currentColor | 호환 블록이 `*, ::after, ::before, ::backdrop, ::file-selector-button` 에 있는지 |
  | placeholder 색 | v4 기본 = 글자색 50% | `input::placeholder, textarea::placeholder { color: var(--color-gray-400); }` |
  | 버튼 커서 | v4 버튼 기본 `cursor: default` | `button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer; }` (사진엔 안 보이지만 v3 동작 유지로 넣는다) |
  | 포커스 링 | `ring` 3px→1px·색 | 변환 도구가 `ring-3` 로 바꿨는지 확인 |
  | 여백 1~2px | `space-*`·`divide-*` 선택자 변경 | 해당 화면만 원인 기록, 고치는 방법이 v4 문서 호환 설명에 있으면 적용, 없으면 보고 |
- [ ] **3단계:** 보정 후 `shoot.mjs v4` → `diff.mjs v3 v4` 를 종료 코드 0 이 될 때까지. 끝까지 남는 차이는 `$T/diff-report.md` 에 파일·픽셀 수·원인·판단. **한 화면이라도 0.1% 넘는 차이가 남으면 진행을 멈추고 보고한다.**
- [ ] **4단계: 커밋**(보정이 있을 때만) — `fix: 관리자 웹 Tailwind v4 기본값 차이 보정(사진 비교) — <요약>`

---

### 작업 6: vitest 환경, `@/` 별칭, `cn()`

**파일:** 만들기 `admin_web/src/lib/utils.ts`, `admin_web/src/lib/utils.test.ts`, `admin_web/src/test/setup.ts`; 수정 `admin_web/vite.config.js`, `admin_web/tsconfig.json`, `admin_web/package.json`

- [ ] **1단계: 의존성**
```bash
npm install --save-exact clsx@2.1.1 tailwind-merge@3.7.0 class-variance-authority@0.7.1 lucide-react@1.72.0 @radix-ui/react-slot@1.5.0
npm install --save-exact -D vitest@2.1.9 jsdom@25.0.1 @testing-library/react@16.3.3 @testing-library/user-event@14.6.10 @testing-library/jest-dom@6.6.3
```
(설치 오류가 나면 vitest 2 와 맞는 가장 가까운 정식 버전으로 바꾸고 보고.)
- [ ] **2단계: 설정** — `vite.config.js` 반환 객체에:
```js
import { fileURLToPath, URL } from 'node:url'
// …
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.test.{ts,tsx}'], css: false },
```
`tsconfig.json` `compilerOptions` 에 `"baseUrl": ".", "paths": { "@/*": ["src/*"] }`. `package.json` scripts 에 `"test": "vitest run"`.
`src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'

// jsdom 에 없는 브라우저 API — Radix 부품 테스트용 최소 대체
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
```
- [ ] **3단계: 실패하는 테스트** `src/lib/utils.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('조건부 클래스를 합친다', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })
  it('충돌하는 Tailwind 클래스는 뒤의 것을 남긴다', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })
  it('우리 토큰 색도 같은 그룹으로 병합한다', () => {
    expect(cn('bg-surface', 'bg-fill')).toBe('bg-fill')
  })
})
```
`npx vitest run src/lib/utils.test.ts` → `./utils` 없음으로 실패.
- [ ] **4단계: 구현** `src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// shadcn/ui 표준 클래스 병합 — 조건부 결합(clsx) 후 충돌하는 Tailwind 클래스를 정리(tailwind-merge)
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```
- [ ] **5단계:** `npm test`(3개 통과), `npx tsc --noEmit` 통과.
- [ ] **6단계: 커밋** — `feat: 관리자 웹 vitest 환경·@/ 별칭·cn() 도우미`

---

### 작업 7: 정적 부품 — Button, Badge, Card, Chip, Skeleton, EmptyState, Table

**파일:** 만들기 `admin_web/src/components/ui/{button,badge,card,chip,skeleton,empty-state,table}.tsx`, `button.test.tsx`, `static.test.tsx`

- [ ] **1단계: 실패하는 테스트** `button.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './button'

describe('Button', () => {
  it('기본 변형은 primary 색과 btn 모서리', () => {
    render(<Button>저장</Button>)
    const b = screen.getByRole('button', { name: '저장' })
    expect(b.className).toContain('bg-primary')
    expect(b.className).toContain('rounded-btn')
    expect(b).toHaveAttribute('type', 'button')
  })
  it('variant·size 를 바꾼다', () => {
    render(<Button variant="outline" size="sm">취소</Button>)
    const b = screen.getByRole('button', { name: '취소' })
    expect(b.className).toContain('border-line')
    expect(b.className).toContain('h-8')
  })
  it('asChild 면 자식 요소로 그린다', () => {
    render(<Button asChild><a href="/x">이동</a></Button>)
    expect(screen.getByRole('link', { name: '이동' }).className).toContain('bg-primary')
  })
  it('비활성일 때 누를 수 없다', async () => {
    const fn = vi.fn()
    render(<Button disabled onClick={fn}>보내기</Button>)
    await userEvent.click(screen.getByRole('button', { name: '보내기' }))
    expect(fn).not.toHaveBeenCalled()
  })
})
```
`static.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './badge'
import { Card, CardHeader, CardTitle, CardContent } from './card'
import { Chip } from './chip'
import { Skeleton } from './skeleton'
import { EmptyState } from './empty-state'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table'

describe('정적 부품', () => {
  it('Badge 상승·하락 변형', () => {
    render(<><Badge variant="up">+3.2%</Badge><Badge variant="down">-1.0%</Badge></>)
    expect(screen.getByText('+3.2%').className).toContain('bg-up-soft')
    expect(screen.getByText('-1.0%').className).toContain('bg-down-soft')
  })
  it('Card 는 surface 바탕과 card 모서리', () => {
    render(<Card data-testid="c"><CardHeader><CardTitle>제목</CardTitle></CardHeader><CardContent>본문</CardContent></Card>)
    expect(screen.getByTestId('c').className).toContain('bg-surface')
    expect(screen.getByTestId('c').className).toContain('rounded-card')
    expect(screen.getByText('제목')).toBeInTheDocument()
  })
  it('Chip 선택 상태는 aria-pressed 와 brand-soft', () => {
    render(<Chip selected>전체</Chip>)
    const c = screen.getByRole('button', { name: '전체' })
    expect(c).toHaveAttribute('aria-pressed', 'true')
    expect(c.className).toContain('bg-brand-soft')
  })
  it('Skeleton 은 스크린리더에서 숨긴다', () => {
    render(<Skeleton data-testid="s" />)
    expect(screen.getByTestId('s')).toHaveAttribute('aria-hidden', 'true')
  })
  it('EmptyState 제목·설명', () => {
    render(<EmptyState title="결과 없음" description="조건을 바꿔 보세요" />)
    expect(screen.getByText('결과 없음')).toBeInTheDocument()
    expect(screen.getByText('조건을 바꿔 보세요')).toBeInTheDocument()
  })
  it('Table 숫자 칸은 tabular-nums', () => {
    render(<Table><TableHeader><TableRow><TableHead>종목</TableHead></TableRow></TableHeader>
      <TableBody><TableRow><TableCell numeric>1,234</TableCell></TableRow></TableBody></Table>)
    expect(screen.getByText('1,234').className).toContain('tabular-nums')
  })
})
```
`npm test` → 모듈 없음으로 실패.

- [ ] **2단계: 구현**

`button.tsx`:
```tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        brand: 'bg-brand text-ink hover:bg-brand/90',
        outline: 'border border-line bg-surface text-ink hover:bg-fill',
        secondary: 'bg-fill text-ink hover:bg-fill/80',
        ghost: 'text-ink hover:bg-fill',
        destructive: 'bg-danger text-white hover:bg-danger/90',
        link: 'text-brand-strong underline-offset-4 hover:underline',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', lg: 'h-12 px-6 text-base', icon: 'size-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp ref={ref} type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  },
)
Button.displayName = 'Button'
```
`badge.tsx`:
```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const badgeVariants = cva('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', {
  variants: {
    variant: {
      default: 'bg-fill text-ink',
      brand: 'bg-brand-soft text-brand-strong',
      up: 'bg-up-soft text-up',
      down: 'bg-down-soft text-down',
      danger: 'bg-danger-soft text-danger',
      outline: 'border border-line text-ink-muted',
    },
  },
  defaultVariants: { variant: 'default' },
})

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
```
`card.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...p }, ref) => (
  <div ref={ref} className={cn('rounded-card bg-surface text-ink', className)} {...p} />
))
Card.displayName = 'Card'
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1 p-4 pb-2', className)} {...p} />
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn('text-base font-bold text-ink', className)} {...p} />
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => <p className={cn('text-sm text-ink-muted', className)} {...p} />
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('p-4 pt-2', className)} {...p} />
export const CardFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex items-center gap-2 p-4 pt-0', className)} {...p} />
```
`chip.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { selected?: boolean }

// 필터·정렬 선택 칩 — 선택 상태를 aria-pressed 로 알린다
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(({ className, selected = false, type, ...p }, ref) => (
  <button
    ref={ref}
    type={type ?? 'button'}
    aria-pressed={selected}
    className={cn(
      'inline-flex h-8 items-center rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50',
      selected ? 'bg-brand-soft text-brand-strong' : 'bg-fill text-ink hover:bg-fill/80',
      className,
    )}
    {...p}
  />
))
Chip.displayName = 'Chip'
```
`skeleton.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-field bg-fill', className)} {...p} />
}
```
`empty-state.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
}

export function EmptyState({ title, description, icon, action, className, ...p }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-10 text-center', className)} {...p}>
      {icon && <div className="text-ink-muted [&_svg]:size-8">{icon}</div>}
      <p className="text-base font-semibold text-ink">{title}</p>
      {description && <p className="text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
```
`table.tsx`:
```tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto"><table className={cn('w-full caption-bottom text-sm', className)} {...p} /></div>
)
export const TableHeader = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn('[&_tr]:border-b [&_tr]:border-line', className)} {...p} />
export const TableBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn('[&_tr:last-child]:border-0', className)} {...p} />
export const TableRow = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b border-line transition-colors hover:bg-fill/50 data-[state=selected]:bg-brand-soft', className)} {...p} />
export const TableHead = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn('h-10 px-3 text-left align-middle text-xs font-semibold text-ink-muted', className)} {...p} />
export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> { numeric?: boolean }
export const TableCell = ({ className, numeric = false, ...p }: TableCellProps) => (
  <td className={cn('px-3 py-2 align-middle text-ink', numeric && 'text-right tabular-nums', className)} {...p} />
)
export const TableCaption = ({ className, ...p }: React.HTMLAttributes<HTMLTableCaptionElement>) => <caption className={cn('mt-3 text-xs text-ink-muted', className)} {...p} />
```
- [ ] **3단계:** `npm test`(작업 6 포함 전부 통과), `npx tsc --noEmit`.
- [ ] **4단계: 커밋** — `feat: 관리자 웹 shadcn 정적 부품 — Button·Badge·Card·Chip·Skeleton·EmptyState·Table`

---

### 작업 8: Radix 부품 — Dialog, Sheet, Tabs, Select, Switch

**파일:** 만들기 `admin_web/src/components/ui/{dialog,sheet,tabs,select,switch}.tsx`, `radix.test.tsx`

- [ ] **1단계: 의존성**
```bash
npm install --save-exact @radix-ui/react-dialog@1.3.1 @radix-ui/react-tabs@1.2.1 @radix-ui/react-select@2.4.1 @radix-ui/react-popover@1.3.1 @radix-ui/react-tooltip@1.4.1 @radix-ui/react-switch@1.4.1
```
(popover·tooltip 은 설계 4절 목록대로 설치만, 부품은 Phase 6 에서 쓸 때 만든다.)
- [ ] **2단계: 실패하는 테스트** `radix.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from './dialog'
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from './sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'
import { Select, SelectTrigger, SelectValue } from './select'
import { Switch } from './switch'

describe('Radix 부품', () => {
  it('Dialog: 열고 ESC 로 닫으면 포커스가 버튼으로 돌아온다', async () => {
    const user = userEvent.setup()
    render(<Dialog><DialogTrigger>열기</DialogTrigger><DialogContent><DialogTitle>확인</DialogTitle><DialogDescription>설명</DialogDescription></DialogContent></Dialog>)
    const trigger = screen.getByRole('button', { name: '열기' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '확인' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it('Sheet: 아래에서 열리는 변형', async () => {
    const user = userEvent.setup()
    render(<Sheet><SheetTrigger>필터</SheetTrigger><SheetContent side="bottom"><SheetTitle>필터 설정</SheetTitle></SheetContent></Sheet>)
    await user.click(screen.getByRole('button', { name: '필터' }))
    expect(screen.getByRole('dialog', { name: '필터 설정' }).className).toContain('bottom-0')
  })
  it('Tabs: 화살표 키로 다음 탭', async () => {
    const user = userEvent.setup()
    render(<Tabs defaultValue="a"><TabsList><TabsTrigger value="a">급등</TabsTrigger><TabsTrigger value="b">급락</TabsTrigger></TabsList>
      <TabsContent value="a">급등 목록</TabsContent><TabsContent value="b">급락 목록</TabsContent></Tabs>)
    await user.click(screen.getByRole('tab', { name: '급등' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '급락' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('급락 목록')).toBeInTheDocument()
  })
  it('Select: 자리표시 문구를 보여 준다', () => {
    render(<Select><SelectTrigger aria-label="정렬"><SelectValue placeholder="정렬 선택" /></SelectTrigger></Select>)
    expect(screen.getByRole('combobox', { name: '정렬' })).toHaveTextContent('정렬 선택')
  })
  it('Switch: 누르면 켜진다', async () => {
    const user = userEvent.setup()
    render(<Switch aria-label="노출" />)
    const s = screen.getByRole('switch', { name: '노출' })
    expect(s).toHaveAttribute('aria-checked', 'false')
    await user.click(s)
    expect(s).toHaveAttribute('aria-checked', 'true')
  })
})
```
`npm test` → 모듈 없음으로 실패.
- [ ] **3단계: 구현**

`dialog.tsx`:
```tsx
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

export const DialogOverlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, ...p }, ref) => <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/40', className)} {...p} />,
)
DialogOverlay.displayName = 'DialogOverlay'

export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>(
  ({ className, children, ...p }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn('fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-3 rounded-card bg-surface p-5 text-ink shadow-lg', className)}
        {...p}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-field p-1 text-ink-muted hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring" aria-label="닫기">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  ),
)
DialogContent.displayName = 'DialogContent'

export const DialogHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1 pr-6', className)} {...p} />
export const DialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />
export const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...p }, ref) => <DialogPrimitive.Title ref={ref} className={cn('text-base font-bold text-ink', className)} {...p} />,
)
DialogTitle.displayName = 'DialogTitle'
export const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(
  ({ className, ...p }, ref) => <DialogPrimitive.Description ref={ref} className={cn('text-sm text-ink-muted', className)} {...p} />,
)
DialogDescription.displayName = 'DialogDescription'
```
`sheet.tsx`:
```tsx
import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close
export const SheetDescription = SheetPrimitive.Description

const sheetVariants = cva('fixed z-50 flex flex-col gap-3 bg-surface p-5 text-ink shadow-lg', {
  variants: {
    side: {
      top: 'inset-x-0 top-0 rounded-b-card',
      bottom: 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-card',
      left: 'inset-y-0 left-0 h-full w-3/4 max-w-sm',
      right: 'inset-y-0 right-0 h-full w-3/4 max-w-sm',
      full: 'inset-0',
    },
  },
  defaultVariants: { side: 'right' },
})

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {}

export const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side, className, children, ...p }, ref) => (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), 'overflow-y-auto', className)} {...p}>
        {children}
        <SheetPrimitive.Close className="absolute right-3 top-3 rounded-field p-1 text-ink-muted hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring" aria-label="닫기">
          <X className="size-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  ),
)
SheetContent.displayName = 'SheetContent'
export const SheetTitle = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Title>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>>(
  ({ className, ...p }, ref) => <SheetPrimitive.Title ref={ref} className={cn('pr-6 text-base font-bold text-ink', className)} {...p} />,
)
SheetTitle.displayName = 'SheetTitle'
```
`tabs.tsx`:
```tsx
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root
export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...p }, ref) => <TabsPrimitive.List ref={ref} className={cn('inline-flex items-center gap-1 rounded-btn bg-fill p-1', className)} {...p} />,
)
TabsList.displayName = 'TabsList'
export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...p }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn('inline-flex h-8 items-center rounded-field px-3 text-sm font-medium text-ink-muted transition-colors focus-visible:outline-2 focus-visible:outline-ring data-[state=active]:bg-surface data-[state=active]:text-ink', className)}
      {...p}
    />
  ),
)
TabsTrigger.displayName = 'TabsTrigger'
export const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...p }, ref) => <TabsPrimitive.Content ref={ref} className={cn('mt-3 focus-visible:outline-2 focus-visible:outline-ring', className)} {...p} />,
)
TabsContent.displayName = 'TabsContent'
```
`switch.tsx`:
```tsx
import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...p }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn('inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-fill', className)}
      {...p}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  ),
)
Switch.displayName = 'Switch'
```
`select.tsx`:
```tsx
import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

export const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(
  ({ className, children, ...p }, ref) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn('inline-flex h-10 w-full items-center justify-between gap-2 rounded-field bg-fill px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 data-[placeholder]:text-ink-muted', className)}
      {...p}
    >
      {children}
      <SelectPrimitive.Icon asChild><ChevronDown className="size-4 text-ink-muted" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  ),
)
SelectTrigger.displayName = 'SelectTrigger'

export const SelectContent = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
  ({ className, children, position = 'popper', ...p }, ref) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn('z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-field bg-popover text-popover-foreground shadow-lg', position === 'popper' && 'w-[var(--radix-select-trigger-width)] translate-y-1', className)}
        {...p}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
)
SelectContent.displayName = 'SelectContent'

export const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  ({ className, children, ...p }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn('relative flex w-full cursor-pointer select-none items-center rounded-field py-2 pl-8 pr-2 text-sm text-ink outline-hidden data-[highlighted]:bg-fill data-[disabled]:opacity-50', className)}
      {...p}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator></span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  ),
)
SelectItem.displayName = 'SelectItem'
```
- [ ] **4단계:** `npm test`, `npx tsc --noEmit` 통과.
- [ ] **5단계: 커밋** — `feat: 관리자 웹 shadcn Radix 부품 — Dialog·Sheet·Tabs·Select·Switch(한국어 닫기 라벨)`

---

### 작업 9: 마무리 — 사진 재비교·Docker·README

- [ ] **1단계: 사진 최종 비교** — 작업 6~8 뒤에도 기존 화면이 그대로인지(부품을 import 하지 않았으므로 같아야 함): `shoot.mjs v4` → `diff.mjs v3 v4` 가 종료 코드 0(또는 작업 5 보고서와 같은 차이만).
- [ ] **2단계: 전체 검증**
```bash
npx tsc --noEmit && npm test && (export VITE_API_BASE_URL=http://localhost:4010 VITE_AUTH_BASE_URL=http://localhost:4010 VITE_STOCK_API_URL=http://localhost:4010; npm run build) 2>&1 | tail -3
```
- [ ] **3단계: alpine Docker 빌드** — `admin_web/Dockerfile` 의 build arg 이름을 보고 맞춘다:
```bash
docker build -f admin_web/Dockerfile --build-arg VITE_API_BASE_URL=http://localhost:4010 --build-arg VITE_AUTH_BASE_URL=http://localhost:4010 --build-arg VITE_STOCK_API_URL=http://localhost:4010 -t admin-web-tw4-check admin_web 2>&1 | tail -5
docker image rm admin-web-tw4-check
```
기대: `@tailwindcss/oxide` linux-musl 바이너리로 빌드 성공. 실패하면 오류를 그대로 보고.
- [ ] **4단계: README** — 루트 `README.md` 의 admin_web 절에:
```
- 스타일: Tailwind CSS v4(`src/index.css` 의 `@theme inline` 토큰, 설정 파일 없음) + shadcn/ui 코어 부품(`src/components/ui/`)
- 테스트: `cd admin_web && npm test` (vitest + Testing Library)
```
- [ ] **5단계: 커밋** — `docs: README 관리자 웹 Tailwind v4·테스트 명령`
- [ ] **6단계: 보고** — tsc·test·build·Docker 결과, 사진 비교 결과(같음 수 / 차이 목록과 판단), 변환 도구가 바꾼 클래스 종류와 파일 수, 커밋 목록, 설계와 다르게 정한 점, 확신이 없는 점. 임시 서버는 모두 끄고 `$T` 는 남겨 둔다(사진 확인용).
