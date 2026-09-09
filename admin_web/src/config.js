// 프론트 공개 설정 — 빌드 타임에 VITE_* 로 주입된다(번들에 그대로 실림).
//
// 환경 3단계:
//   local  : `npm run dev`(vite serve). VITE_* 없으면 아래 DEV_FALLBACK(localhost) 사용.
//   develop: 미니PC 배포. docker build args(VITE_*)로 haezean 터널 URL 주입.
//   product: 실서버. 별도 build args 로 product URL 주입(도메인 확정 시).
//
// ⚠️ 배포 빌드(vite build)에서 VITE_* 가 비면 localhost 로 폴백하지 않고 즉시 throw 한다.
//    (localhost 가 조용히 구워져 'green-but-broken' 배포가 되는 것을 차단 — 백엔드
//     deploy.yml 의 env fail-fast 와 동일한 원리. 빌드 타임 방어는 vite.config.js 참조.)
const DEV_FALLBACK = {
  VITE_API_BASE_URL: 'http://localhost:8000/api/v1', // blog(8000)
  VITE_AUTH_BASE_URL: 'http://localhost:8001/api/v1', // auth(8001)
  VITE_STOCK_API_URL: 'http://localhost:8002/graphql', // stock(8002)
}

function readEnv(name) {
  const v = import.meta.env[name]
  if (v) return v
  if (import.meta.env.DEV) return DEV_FALLBACK[name] // vite dev(serve)에서만 폴백 허용
  throw new Error(
    `[config] ${name} 이(가) 빌드에 주입되지 않았습니다. ` +
      `docker build args(VITE_*) 또는 .env 를 확인하세요.`,
  )
}

// blog 서비스(게시판/게시글/댓글)
export const API_BASE_URL = readEnv('VITE_API_BASE_URL')
// auth 서비스(로그인/JWT)
export const AUTH_BASE_URL = readEnv('VITE_AUTH_BASE_URL')
// stock 서비스(GraphQL — 차트/검색)
export const STOCK_API_URL = readEnv('VITE_STOCK_API_URL')
