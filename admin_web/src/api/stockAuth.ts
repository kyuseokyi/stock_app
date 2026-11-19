// stock_api 호출(GraphQL·REST)에 관리자 토큰을 붙인다 — A안(시세 비노출)에서 서버는 스위치가 꺼져 있어도
// 관리자에게는 시세를 준다(설계 docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-2).
// 토큰은 다른 관리자 API 와 같은 localStorage 'token'(api/client.ts 인터셉터와 같은 규칙).

/** 로그인 상태면 { Authorization: 'Bearer …' }, 아니면 빈 객체 */
export function stockAuthHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
