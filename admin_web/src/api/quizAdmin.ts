import { requireGameClient } from './coach'
import type {
  QuizAdminDetail,
  QuizAdminList,
  QuizAdminUpdateBody,
  QuizGenerateResult,
  QuizType,
} from '../types/game'

// 차트 퀴즈 관리자 API (trading_game, 백로그 ⑤-2)
const BASE = '/api/game/admin/quizzes'

export interface QuizListParams {
  page: number
  size: number
  active?: boolean // 미지정 = 전체
}

export const listQuizzes = async (params: QuizListParams): Promise<QuizAdminList> => {
  const { data } = await requireGameClient().get<QuizAdminList>(BASE, { params })
  return data
}

export const getQuiz = async (id: number): Promise<QuizAdminDetail> => {
  const { data } = await requireGameClient().get<QuizAdminDetail>(`${BASE}/${id}`)
  return data
}

export const updateQuiz = async (id: number, body: QuizAdminUpdateBody): Promise<QuizAdminDetail> => {
  const { data } = await requireGameClient().put<QuizAdminDetail>(`${BASE}/${id}`, body)
  return data
}

export const deleteQuiz = async (id: number): Promise<void> => {
  await requireGameClient().delete(`${BASE}/${id}`)
}

/** types 생략 = 서버 기본 비율(2지선다 50%·등락폭 구간 25%·신호 맞히기 25%) */
export const generateQuizzes = async (count: number, types?: QuizType[]): Promise<QuizGenerateResult> => {
  const { data } = await requireGameClient().post<QuizGenerateResult>(`${BASE}/generate`, { count, types })
  return data
}

/** 직접 출제 — 실패 사유: 422 INSUFFICIENT_DATA·TOO_FLAT·INVALID_SERIES, 409 DUPLICATE */
export const createQuiz = async (ticker: string, baseDate: string): Promise<QuizAdminDetail> => {
  const { data } = await requireGameClient().post<QuizAdminDetail>(BASE, { ticker, base_date: baseDate })
  return data
}
