// web_client 운영 서버 — 정적 SPA + 같은 도메인 API 프록시.
//
// 왜: 카카오톡 인앱 브라우저(안드로이드 WebView)에서 app.haezean.com 페이지는 뜨는데
// blog·api·auth 같은 다른 서브도메인 요청만 응답 없이 실패했다(같은 폰 크롬은 정상).
// 브라우저가 늘 자기 도메인(app.haezean.com/_api/…)으로만 요청하게 하면 CORS·사전 요청(OPTIONS)이
// 사라져 인앱 브라우저 정책의 영향을 받지 않는다.
//
//   /_api/blog/*  → blog_api:8003     /_api/auth/* → auth_api:8001
//   /_api/stock/* → stock_api:8002    /_api/game/* → trading_game:8004 (WebSocket 포함)
// 그 밖의 경로는 serve-handler 가 dist/serve.json 규칙 그대로 처리한다(이전 `serve dist` 와 같은 동작:
// /assets 밖은 index.html, 없는 /assets 는 404, html no-cache).
const http = require('node:http')
const path = require('node:path')
const handler = require('serve-handler')
const httpProxy = require('http-proxy')

const PORT = Number(process.env.PORT || 3000)
const DIST = path.join(__dirname, 'dist')
const SERVE_CONFIG = { ...require('./dist/serve.json'), public: DIST, etag: true }

// 백엔드 주소 — compose·Swarm 모두 같은 서비스 이름. 로컬 점검 때만 env 로 바꾼다.
const ROUTES = [
  ['/_api/blog', process.env.BLOG_UPSTREAM || 'http://blog_api:8003'],
  ['/_api/auth', process.env.AUTH_UPSTREAM || 'http://auth_api:8001'],
  ['/_api/stock', process.env.STOCK_UPSTREAM || 'http://stock_api:8002'],
  ['/_api/game', process.env.GAME_UPSTREAM || 'http://trading_game:8004'],
]

// xfwd: X-Forwarded-For/Proto 추가. 원래 요청 헤더(cf-connecting-ip 등)는 그대로 넘어간다
// → 게임 WS 의 IP별 공개 연결 상한이 프록시 IP 하나로 뭉치지 않는다.
// changeOrigin 은 로컬 점검(공개 https 호스트로 보낼 때)에서만 켠다.
const proxy = httpProxy.createProxyServer({ xfwd: true, changeOrigin: process.env.PROXY_CHANGE_ORIGIN === '1' })

// 캐시 헤더가 없는 API 응답에 Cloudflare 가 브라우저 캐시 4시간을 붙이지 않게
proxy.on('proxyRes', (proxyRes) => {
  if (!proxyRes.headers['cache-control']) proxyRes.headers['cache-control'] = 'no-store'
})

// 백엔드가 내려가 있으면 연결을 끊지 않고 502 → 클라이언트 조회 재시도(installRetry)가 동작한다
proxy.on('error', (err, req, res) => {
  console.error(`[proxy] ${req.method} ${req.url}: ${err.code || err.message}`)
  if (res instanceof http.ServerResponse) {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    }
    res.end('{"detail":"upstream unavailable"}')
  } else if (res && typeof res.destroy === 'function') {
    res.destroy() // WebSocket 소켓
  }
})

/** /_api/<name>/... 이면 [대상, 접두사 뗀 경로] */
function match(url) {
  for (const [prefix, target] of ROUTES) {
    if (url === prefix || url.startsWith(prefix + '/') || url.startsWith(prefix + '?')) {
      const rest = url.slice(prefix.length)
      return [target, rest.startsWith('/') ? rest : '/' + rest]
    }
  }
  return null
}

const server = http.createServer((req, res) => {
  const m = match(req.url || '/')
  if (m) {
    req.url = m[1]
    proxy.web(req, res, { target: m[0] })
    return
  }
  handler(req, res, SERVE_CONFIG).catch((err) => {
    console.error('[static]', err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})

// 게임 실시간 스트림(WebSocket)
server.on('upgrade', (req, socket, head) => {
  const m = match(req.url || '/')
  if (!m) return socket.destroy()
  req.url = m[1]
  proxy.ws(req, socket, head, { target: m[0] })
})

// SSE(알림)·WS 는 오래 열려 있다 — 요청 수신 제한만 두고 응답 시간 제한은 두지 않는다
server.requestTimeout = 0

server.listen(PORT, () => console.log(`web_client: :${PORT} (static + /_api proxy)`))
