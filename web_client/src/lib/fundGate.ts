// '내 펀드' 로그인 게이트 — 순수 판정 함수와 문구(docs/app_identity_and_nav_redesign_spec.md 1-2).
// 펀드 목록은 로그인 계정별로 이 브라우저에만 저장하므로(lib/fundStore) 로그인 전에는 보여 줄 목록이 없다.

export const FUNDS_PATH = '/me/funds'

/** 탭·홈 카드에서 연 로그인 모달의 안내 문구 */
export const FUND_LOGIN_DESCRIPTION = '내 펀드 수익률을 확인하려면 로그인이 필요해요'

/** 탭·카드 클릭 판정 — 로그인했으면 그대로 이동, 아니면 이동을 막고 로그인 모달 */
export type FundNavAction = 'navigate' | 'login'

export function fundNavAction(loggedIn: boolean): FundNavAction {
  return loggedIn ? 'navigate' : 'login'
}

/** 이 섹션의 탭 클릭이 로그인 게이트를 거치는가(지금은 '내 펀드'만) */
export function isLoginGatedSection(section: string): boolean {
  return section === 'funds'
}
