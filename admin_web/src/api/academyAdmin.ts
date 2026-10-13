import { requireGameClient } from './coach'
import type { AcademyQuestionAdmin, AcademyQuestionBody } from '../types/game'

// 아카데미 문항 관리자 API (trading_game, 백로그 ⑤-2)
const BASE = '/api/game/admin/academy/questions'

export const listAcademyQuestions = async (): Promise<AcademyQuestionAdmin[]> => {
  const { data } = await requireGameClient().get<AcademyQuestionAdmin[]>(BASE)
  return data
}

export const createAcademyQuestion = async (body: AcademyQuestionBody): Promise<AcademyQuestionAdmin> => {
  const { data } = await requireGameClient().post<AcademyQuestionAdmin>(BASE, body)
  return data
}

export const updateAcademyQuestion = async (
  id: number,
  body: AcademyQuestionBody,
): Promise<AcademyQuestionAdmin> => {
  const { data } = await requireGameClient().put<AcademyQuestionAdmin>(`${BASE}/${id}`, body)
  return data
}

export const deleteAcademyQuestion = async (id: number): Promise<void> => {
  await requireGameClient().delete(`${BASE}/${id}`)
}
