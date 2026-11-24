import { authClient } from './client'
import type { AdminAccount } from '../types/api'

// 관리자 계정 관리(슈퍼 관리자 전용) — 인증 서버
const BASE = '/auth/admin/accounts'

export const listAdminAccounts = async (): Promise<AdminAccount[]> =>
  (await authClient.get<AdminAccount[]>(BASE)).data

export const createAdminAccount = async (body: {
  login_id: string
  nickname: string
  password: string
}): Promise<AdminAccount> => (await authClient.post<AdminAccount>(BASE, body)).data

export const resetAdminPassword = async (id: number, newPassword: string): Promise<AdminAccount> =>
  (await authClient.post<AdminAccount>(`${BASE}/${id}/password`, { new_password: newPassword })).data

export const setAdminActive = async (id: number, isActive: boolean): Promise<AdminAccount> =>
  (await authClient.patch<AdminAccount>(`${BASE}/${id}/active`, { is_active: isActive })).data
