import { TOKEN_KEY } from '../store/auth'

// stock_api 호출(GraphQL·시세 REST)에 로그인 토큰을 붙인다 — A안(시세 비노출)에서 서버는 스위치가 꺼져 있어도
// 관리자·시세 열람 권한 회원에게는 시세를 준다(설계 docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-2).
// 비로그인이면 아무것도 붙이지 않는다(지금과 같음). 전역 axios 인터셉터 대신 호출마다 헤더를 넘긴다 — 전역 axios 는
// 다른 외부 호출에도 쓰여 토큰이 새면 안 된다.

/** 로그인 상태면 { Authorization: 'Bearer …' }, 아니면 빈 객체 */
export function stockAuthHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
