import { authClient } from './client'
import type { AdminAccount, AdminPermissionKey, EditableTier, RolePolicies } from '../types/api'

// 관리자 계정 관리(슈퍼 관리자 전용) — 인증 서버
const BASE = '/auth/admin/accounts'

export const listAdminAccounts = async (): Promise<AdminAccount[]> =>
  (await authClient.get<AdminAccount[]>(BASE)).data

export const createAdminAccount = async (body: {
  login_id: string
  nickname: string
  password: string
  admin_tier: EditableTier
  custom_permissions: AdminPermissionKey[]
}): Promise<AdminAccount> => (await authClient.post<AdminAccount>(BASE, body)).data

export const resetAdminPassword = async (id: number, newPassword: string): Promise<AdminAccount> =>
  (await authClient.post<AdminAccount>(`${BASE}/${id}/password`, { new_password: newPassword })).data

export const setAdminActive = async (id: number, isActive: boolean): Promise<AdminAccount> =>
  (await authClient.patch<AdminAccount>(`${BASE}/${id}/active`, { is_active: isActive })).data

export const setAdminTier = async (
  id: number,
  adminTier: EditableTier,
  customPermissions: AdminPermissionKey[],
): Promise<AdminAccount> =>
  (await authClient.patch<AdminAccount>(`${BASE}/${id}/tier`, {
    admin_tier: adminTier,
    custom_permissions: customPermissions,
  })).data

// 등급별 권한 표 — 조회는 모든 관리자, 수정은 슈퍼 관리자
const POLICIES = '/auth/admin/role-policies'

export const getRolePolicies = async (): Promise<RolePolicies> =>
  (await authClient.get<RolePolicies>(POLICIES)).data

export const updateRolePolicy = async (tier: EditableTier, permissions: AdminPermissionKey[]): Promise<RolePolicies> =>
  (await authClient.put<RolePolicies>(`${POLICIES}/${tier}`, { permissions })).data
