# 8. 웹 — web_client(사용자) · admin_web(관리자)

> 목표: React 웹 화면이 어떻게 구성되고, 어디서 API 를 부르는지 알고, "댓글 달기" 버튼부터 서버까지 코드로 따라갈 수 있다.

## 8-1. 기술 한 줄 요약

| 기술 | 역할 | 비유 |
|---|---|---|
| **React** | 화면을 부품(컴포넌트)으로 나눠 만든다 | 레고 블록 |
| **TypeScript** | 자바스크립트 + 타입 검사 (`.ts`, `.tsx`) | 파이썬 타입 힌트의 엄격한 버전 |
| **Vite** | 개발 서버 실행·배포 파일 빌드 | `uvicorn` 같은 역할 (웹 쪽) |
| **TailwindCSS** | `className="text-sm text-ink-muted"` 처럼 클래스로 스타일 | |
| **react-router** | 주소(`/posts/12`)별로 어떤 페이지를 보여줄지 | FastAPI 라우터의 화면 버전 |
| **axios** | 서버 API 호출 | `curl` 의 코드 버전 |
| **zustand** | 여러 화면이 같이 쓰는 상태(로그인 정보 등) 저장 | 전역 메모장 |
| **lightweight-charts** | 주식 차트 (web_client) | |

두 웹 모두 **TypeScript strict** 다. `npm run build` 가 `tsc --noEmit && vite build` 라서 **타입 에러가 하나라도 있으면 배포 빌드가 실패**한다.

## 8-2. 두 웹의 차이

| | web_client | admin_web |
|---|---|---|
| 사용자 | 일반 회원 (비로그인 조회 가능) | 관리자만 (`admin@stock.app` 등) |
| 로컬 주소 | `http://localhost:3000` | `http://localhost:5173` |
| 운영 주소 | `app.haezean.com` | `admin.haezean.com` |
| 하는 일 | 홈·마켓·스크리너·커뮤니티·게임·내정보·펀드 | 게시판/글 관리, 푸시·펀드 알림, 앱 버전, 시장 데이터 관리, 게임 운영(코치·퀴즈·아카데미·설정), 회원·통계 |
| API 호출 방식(운영) | 같은 도메인 프록시 `/_api/{blog,auth,stock,game}/…` | 각 서브도메인 직접 호출 |

## 8-3. 폴더 구조 (web_client 기준, admin_web 도 거의 같다)

```
web_client/
├── index.html, vite.config.js, tailwind.config.js, tsconfig.json
├── server.cjs          운영 서버: 정적 파일 + /_api 프록시 (Docker 에서만 사용)
├── Dockerfile
└── src/
    ├── main.tsx        시작점 (React 를 index.html 에 붙임)
    ├── App.tsx         주소 → 페이지 연결표 (react-router)
    ├── config.ts       API 주소 (VITE_* 환경변수)
    ├── pages/          페이지 하나 = 파일 하나 (PostDetailPage.tsx …)
    ├── components/     여러 페이지가 쓰는 부품 (Layout, LoginModal, ui/Button …)
    ├── api/            서버 호출 함수 (client.ts = 공통 axios, blog.ts, auth.ts, stock.ts …)
    ├── store/          zustand 전역 상태 (auth.ts = 로그인, boards.ts, tradingGame.ts)
    ├── hooks/          재사용 로직 (useGameWebSocket 등)
    ├── lib/            순수 함수 (차트 계산, 재시도, 에러 코드) + *.test.ts
    └── types/          서버 응답 타입 (백엔드 pydantic 스키마와 맞춘다)
```

**규칙**: 화면(UI) 코드와 통신 코드를 섞지 않는다. 페이지는 `api/` 의 함수만 부르고, axios 를 직접 쓰지 않는다.

## 8-4. 코드로 따라가기 — 웹에서 댓글 달기

### ① 주소 → 페이지 (`src/App.tsx`)
```tsx
<Route path="posts/:id" element={<PostDetailPage />} />
```

### ② 페이지 (`src/pages/PostDetailPage.tsx`)
```tsx
useEffect(() => {                                     // 화면이 열리면 한 번 실행
  Promise.all([getBlog(id), listComments(id)])        // 글 + 댓글 동시에 불러오기
    .then(([p, c]) => { setPost(p); setComments(c) })
}, [id])

const submitComment = async (e) => {
  const created = await createComment(id, text)       // ③ 으로
  setComments((prev) => [...prev, created])           // 목록 끝에 추가 → 화면 자동 갱신
  // 401 → "로그인이 만료됐어요", 403 → "이 게시판은 댓글을 받지 않아요"
}
```

### ③ API 함수 (`src/api/blog.ts`)
```ts
export const createComment = async (blogId: Id, content: string): Promise<CommentOut> => {
  const { data } = await client.post<CommentOut>(`/blogs/${blogId}/comments`, { content })
  return data
}
```

### ④ 공통 클라이언트 (`src/api/client.ts`)
```ts
const client = axios.create({ baseURL })              // config.ts 의 API_BASE_URL (blog 서버)
client.interceptors.request.use((config) => {         // 모든 요청에 자동으로
  const token = localStorage.getItem(TOKEN_KEY)       //   저장된 로그인 토큰을
  if (token) config.headers.Authorization = `Bearer ${token}`   // 헤더에 붙인다
  return config
})
// 401 응답이 오면 자동 로그아웃 처리, 배포 순간 502~504 는 조회(GET)만 짧게 재시도
```

→ 이후는 서버 쪽 [4장](./04-server-fastapi.md) 의 흐름과 이어진다.

### 기억할 개념
- **`useState`**: 화면에 보이는 값. 값이 바뀌면 React 가 화면을 다시 그린다.
- **`useEffect`**: 화면이 열리거나 특정 값이 바뀔 때 실행할 일(데이터 불러오기 등).
- **토큰 저장 위치**: 브라우저 `localStorage` 의 `wc_token`. 개발자도구 → Application → Local Storage 에서 볼 수 있다.

## 8-5. API 주소 설정 (환경변수)

API 주소는 **빌드할 때** 파일 안에 박힌다(`VITE_*`). 실행 중에 바꿀 수 없다.

| 상황 | 주소를 어디서 정하나 |
|---|---|
| 로컬 `npm run dev` | 값이 없으면 `src/config.ts` 의 localhost 기본값 |
| 개발서버 배포 | `docker-compose.prod.yml` 의 build args (`deploy-web.yml` 이 실행) |
| 상용 배포 | `deploy-prod.yml` 의 build args |

- **안전장치**: 배포 빌드에서 필수 `VITE_*` 가 비면 빌드가 **실패**한다. 예전에 운영 관리자 웹이 localhost 를 부르던 사고를 막으려고 넣었다.
- 로컬에서 빌드만 확인할 때: `npm run build -- --mode development`.
- 전체 변수 목록: 루트 [README](../../README.md) 의 "주요 환경변수" 표.

### web_client 같은 도메인 프록시
카카오톡 인앱 브라우저에서 다른 서브도메인(blog·auth·api) 호출이 실패하는 문제가 있어, 운영 web_client 는 **자기 도메인으로만** 요청한다.
```
브라우저 → app.haezean.com/_api/blog/api/v1/...  → web 컨테이너(server.cjs) → blog_api:8003
                         /_api/auth/...                                 → auth_api:8001
                         /_api/stock/...                                → stock_api:8002
                         /_api/game/... (WebSocket 포함)                 → trading_game:8004
```

## 8-6. 자주 쓰는 명령

```bash
npm install            # 의존성 설치 (package.json 이 바뀌면 다시)
npm run dev            # 개발 서버
npx tsc --noEmit       # 타입 검사만
npm run lint           # 코드 스타일 검사 (web_client 만)
npm test               # 단위 테스트 (web_client 만: Vitest, src/**/*.test.ts)
npm run build -- --mode development   # 빌드 확인
```

## 8-7. 화면이 이상할 때 보는 순서

1. 브라우저 개발자도구(F12) → **Console** 에 빨간 에러가 있는지.
2. **Network** 탭에서 실패한 요청을 클릭 → 주소·상태 코드·응답 본문 확인 ([6장 상태 코드 표](./06-api.md#6-2-rest-기초)).
3. 화면 오류 문구 끝의 `(오류: NETWORK · app.haezean.com/_api/blog)` 는 어느 서버로 가다 실패했는지 알려 준다(`src/lib/errorCode.ts`).
4. 요청 주소가 `localhost` 로 나가고 있다면 → 빌드 시 `VITE_*` 주입 문제.
5. CORS 에러면 → `backend/shared/cors.py`.

## 8-8. 디자인 참고

- 디자인 원칙: 루트 [`DESIGN.md`](../../DESIGN.md), 제품 설명 [`PRODUCT.md`](../../PRODUCT.md)
- 색·간격 토큰(토스 스타일): [`docs/mobile_design_language.md`](../mobile_design_language.md) — 웹과 앱이 같은 토큰을 쓴다.
- 화면별 기능 보고서: [`docs/feature-report/`](../feature-report/README.md)

## 직접 해보기

1. web_client 를 켜고 개발자도구 Network 탭을 연 채로 글 상세에 들어가, `blogs/{id}` 와 `comments` 요청 2개가 동시에 나가는 걸 확인한다.
2. 로그인 후 Local Storage 의 `wc_token` 값을 복사해 [6장](./06-api.md) 의 `curl` 에 넣어 본다. 웹과 curl 이 같은 토큰을 쓴다는 걸 확인.
3. `PostDetailPage.tsx` 의 403 안내 문구를 바꿔 보고, 관리자 웹에서 그 게시판의 댓글을 끈 뒤 댓글을 달아 문구가 바뀌었는지 본다(확인 후 원복).

이전: [7. 배치 작업](./07-batch-celery.md) · 다음: [9. 모바일 앱](./09-mobile.md)
