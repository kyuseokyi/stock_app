import client from './client'
import type { PushTemplateIn, PushTemplateOut } from '../types/api'

// 푸시 문구 템플릿 (blog /api/v1/admin/push-templates)
export const listPushTemplates = async (): Promise<PushTemplateOut[]> => {
  const { data } = await client.get<PushTemplateOut[]>('/admin/push-templates')
  return data
}

export const createPushTemplate = async (payload: PushTemplateIn): Promise<PushTemplateOut> => {
  const { data } = await client.post<PushTemplateOut>('/admin/push-templates', payload)
  return data
}

export const updatePushTemplate = async (id: number, payload: PushTemplateIn): Promise<PushTemplateOut> => {
  const { data } = await client.put<PushTemplateOut>(`/admin/push-templates/${id}`, payload)
  return data
}

export const deletePushTemplate = async (id: number): Promise<void> => {
  await client.delete(`/admin/push-templates/${id}`)
}
