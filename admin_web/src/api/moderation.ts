import client from './client'
import type {
  AdminUserListOut,
  AssignableRole,
  AdminUserOut,
  ChartPostOut,
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
  provider = '', // 로그인 방식 필터(KAKAO·NAVER·GOOGLE·APPLE·LOCAL). 빈 값=전체
): Promise<AdminUserListOut> => {
  const params: Record<string, string | number | boolean> = { page, size }
  if (q.trim()) params.q = q.trim()
  if (marketDataOnly) params.market_data_access = true
  if (provider) params.provider = provider
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

// 회원 역할 변경 — 일반(FREE)·관리자(ADMIN)만(유료 등급 없음). 자기 강등·마지막 관리자·비활성 승격은 409
export const setUserRole = async (userId: number, role: AssignableRole): Promise<AdminUserOut> => {
  const { data } = await client.patch<AdminUserOut>(`/admin/users/${userId}/role`, { role })
  return data
}

export const updateUserNickname = async (userId: number, nickname: string): Promise<AdminUserOut> => {
  const { data } = await client.patch<AdminUserOut>(`/admin/users/${userId}/nickname`, { nickname })
  return data
}

// 차트 포함 글 점검(조회 전용) — 정리는 기존 글 편집 화면에서 직접 한다
export const listChartPosts = async (limit = 200): Promise<ChartPostOut[]> => {
  const { data } = await client.get<ChartPostOut[]>('/admin/blog/chart-posts', { params: { limit } })
  return data
}
