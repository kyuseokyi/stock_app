import axios from 'axios'

// 사용자 오류 문구 끝에 붙이는 짧은 진단 코드 — 캡처 한 장으로 원인을 가를 수 있게.
//   NETWORK  : 응답 자체를 못 받음(연결 실패·CORS·사전요청 차단·보안 검사 페이지 등)
//   TIMEOUT  : 시간 초과
//   HTTP 403 : 서버(또는 Cloudflare)가 상태 코드로 응답
// 뒤에 요청한 서버 호스트(blog.haezean.com 등)를 붙여 어느 서버 문제인지 보이게 한다.

export function errorCode(err: unknown): string {
  if (axios.isAxiosError(err)) {
    let code: string
    if (err.response) code = `HTTP ${err.response.status}`
    else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') code = 'TIMEOUT'
    else code = 'NETWORK'
    const host = requestHost(err.config?.baseURL, err.config?.url)
    return host ? `${code} · ${host}` : code
  }
  if (err instanceof Error && err.name) return err.name
  return 'UNKNOWN'
}

/** "메시지 (오류: NETWORK · blog.haezean.com)" */
export function withErrorCode(message: string, err: unknown): string {
  return `${message} (오류: ${errorCode(err)})`
}

/** 요청 대상 표시 — 다른 도메인이면 호스트, 같은 도메인 프록시(/_api/blog…)면 "호스트/_api/blog" */
function requestHost(baseURL?: string, url?: string): string {
  try {
    // axios 처럼 baseURL 뒤에 url 을 이어 붙인다(url 이 절대 주소면 그대로). 상대 baseURL 은 현재 페이지 기준.
    const joined =
      url && /^https?:\/\//.test(url)
        ? url
        : `${(baseURL ?? '').replace(/\/+$/, '')}/${(url ?? '').replace(/^\/+/, '')}`
    const u = new URL(joined, window.location.href)
    const prefix = /^\/_api\/[^/]+/.exec(u.pathname)?.[0] ?? ''
    return u.host + prefix
  } catch {
    return ''
  }
}
