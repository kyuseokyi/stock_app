import client from './client'
import type {
  AdminUserListOut,
  AdminUserOut,
  ReportedCommentOut,
  ReportStatusFilter,
  ResolveAction,
  ResolveResult,
} from '../types/api'

// 댓글 신고 관리·회원 관리 (blog /api/v1/admin, 관리자 토큰)

export const listCommentReports = async (
  status: ReportStatusFilter = 'pending',
  limit = 200,
): Promise<ReportedCommentOut[]> => {
  const { data } = await client.get<ReportedCommentOut[]>('/admin/comment-reports', {
    params: { status, limit },
  })
  return data
}

export const resolveCommentReport = async (
  commentId: number,
  action: ResolveAction,
): Promise<ResolveResult> => {
  const { data } = await client.post<ResolveResult>(`/admin/comment-reports/${commentId}/resolve`, {
    action,
  })
  return data
}

export const listAdminUsers = async (
  q: string,
  page = 1,
  size = 20,
  marketDataOnly = false,
): Promise<AdminUserListOut> => {
  const params: Record<string, string | number | boolean> = { page, size }
  if (q.trim()) params.q = q.trim()
  if (marketDataOnly) params.market_data_access = true
  const { data } = await client.get<AdminUserListOut>('/admin/users', { params })
  return data
}

export const setCommentBan = async (userId: number, banned: boolean): Promise<AdminUserOut> => {
  const { data } = await client.patch<AdminUserOut>(`/admin/users/${userId}/comment-ban`, { banned })
  return data
}

// 회원별 시세 열람 권한 켜기·끄기(관리자 계정은 400 ADMIN_ALWAYS_ALLOWED — 항상 허용)
export const setMarketDataAccess = async (userId: number, enabled: boolean): Promise<AdminUserOut> => {
  const { data } = await client.patch<AdminUserOut>(`/admin/users/${userId}/market-data-access`, { enabled })
  return data
}

export const updateUserNickname = async (userId: number, nickname: string): Promise<AdminUserOut> => {
  const { data } = await client.patch<AdminUserOut>(`/admin/users/${userId}/nickname`, { nickname })
  return data
}
