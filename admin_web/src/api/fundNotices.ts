import client from './client'
import type { FundNoticeCreate, FundNoticePreviewOut, PushSendListOut, PushSendOut } from '../types/api'

// 펀드 리포트 알림 발송·이력 (blog /api/v1/admin)
export const previewFundNotice = async (date: string): Promise<FundNoticePreviewOut> => {
  const { data } = await client.get<FundNoticePreviewOut>('/admin/fund-notices/preview', { params: { date } })
  return data
}

export const createFundNotice = async (payload: FundNoticeCreate): Promise<PushSendOut> => {
  const { data } = await client.post<PushSendOut>('/admin/fund-notices', payload)
  return data
}

export const listPushSends = async (limit = 20, offset = 0): Promise<PushSendListOut> => {
  const { data } = await client.get<PushSendListOut>('/admin/push-sends', { params: { limit, offset } })
  return data
}

export const cancelPushSend = async (id: number): Promise<PushSendOut> => {
  const { data } = await client.post<PushSendOut>(`/admin/push-sends/${id}/cancel`)
  return data
}
