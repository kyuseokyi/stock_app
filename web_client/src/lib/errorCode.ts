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

function requestHost(baseURL?: string, url?: string): string {
  try {
    return new URL(url ?? '', baseURL || window.location.href).host
  } catch {
    return ''
  }
}
