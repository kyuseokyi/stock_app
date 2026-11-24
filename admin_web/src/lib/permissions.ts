import type { AdminPermissionKey, AdminTier, UserOut } from '../types/api'

// 관리자 권한 판정(화면용) — 진짜 막는 곳은 서버(403 INSUFFICIENT_ADMIN_PERMISSION). 여기는 메뉴·버튼 표시만.

export const TIER_LABEL: Record<AdminTier, string> = {
  SUPER_ADMIN: '슈퍼 관리자',
  OPERATOR: '운영 관리자',
  ANALYST: '분석 관리자',
  EDITOR: '콘텐츠 에디터',
}

export const tierLabel = (user: Pick<UserOut, 'admin_tier' | 'is_super_admin'> | null): string => {
  if (!user) return ''
  if (user.is_super_admin) return TIER_LABEL.SUPER_ADMIN
  return user.admin_tier ? TIER_LABEL[user.admin_tier] : '관리자'
}

/** perms 중 하나라도 있으면 true. 슈퍼 관리자는 항상 true.
 *  권한 목록이 아예 없는 옛 로그인 정보는(서버 갱신 전 잠깐) 막지 않는다 — 서버가 최종 판단 */
export function hasPermission(user: UserOut | null, ...perms: AdminPermissionKey[]): boolean {
  if (!user) return false
  if (user.is_super_admin) return true
  if (!user.permissions) return true
  return perms.some((p) => user.permissions!.includes(p))
}
