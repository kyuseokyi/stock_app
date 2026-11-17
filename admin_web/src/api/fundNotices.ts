import client from './client'
import type { FundNoticeCreate, FundNoticePreviewOut, PushSendListOut, PushSendOut, TestPushIn, TestPushOut } from '../types/api'

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

/** 단순 테스트 알림 — 입력 문구를 내 기기(관리자 계정으로 로그인·알림 허용한 기기)로. 발송 이력에 남지 않는다 */
export const sendTestPush = async (payload: TestPushIn): Promise<TestPushOut> => {
  const { data } = await client.post<TestPushOut>('/admin/push-test', payload)
  return data
}
