import { hasPermission } from './permissions'
import type { AdminPermissionKey, UserOut } from '../types/api'

// 메뉴(경로) → 필요한 권한(하나라도 있으면 열림). 서버 가드와 같은 대응 — docs/admin_rbac_permissions_spec_and_plan.md 1-2
// 여기에 없는 경로(통계·비밀번호 변경 등)는 모든 관리자에게 열린다. '관리자 계정'은 슈퍼 관리자 전용이라 따로 처리.
export const NAV_PERMS: Record<string, AdminPermissionKey[]> = {
  '/boards': ['CONTENT_MANAGE'],
  '/blogs': ['CONTENT_MANAGE'],
  '/reports': ['CONTENT_MANAGE'],
  '/blog-chart-audit': ['CONTENT_MANAGE'],
  '/members': ['CONTENT_MANAGE'],
  '/fund-notices': ['CONTENT_MANAGE'],
  '/game/coach': ['GAME_MANAGE'],
  '/game/academy': ['GAME_MANAGE'],
  '/game/quizzes': ['GAME_MANAGE'],
  '/game/settings': ['GAME_MANAGE'],
  '/market/themes': ['DATA_PIPELINE'],
  '/market/status': ['SCREENER_VIEW', 'DATA_PIPELINE'],
  '/market/verify': ['SCREENER_VIEW'],
  '/market/leaders': ['SCREENER_VIEW'],
  '/market/ma-screener': ['SCREENER_VIEW'],
  '/market/finder': ['SCREENER_VIEW'],
  '/market/patterns': ['SCREENER_VIEW'],
  '/market/screener': ['SCREENER_SETTINGS'],
  '/app/versions': ['APP_UPDATE_MANAGE'],
  '/app/ads': ['AD_MANAGE'],
}

/** 로그인 직후·없는 주소 → 이 관리자가 열 수 있는 첫 메뉴(표 순서). 하나도 없으면 비밀번호 변경 */
export function firstAllowedPath(user: UserOut | null): string {
  const hit = Object.entries(NAV_PERMS).find(([, perms]) => hasPermission(user, ...perms))
  return hit ? hit[0] : '/account/password'
}
