import type { AxiosError } from 'axios'

// 게임 관리자 API 오류 → 사용자 메시지.
// detail 형태: 문자열 | {code, message}(서비스 오류) | 검증 오류 배열(422 pydantic)
interface CodedDetail {
  code: string
  message: string
}

const isCoded = (v: unknown): v is CodedDetail =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Record<string, unknown>).code === 'string' &&
  typeof (v as Record<string, unknown>).message === 'string'

/** 서비스 오류 코드(예: HAS_ATTEMPTS). 없으면 null */
export const gameErrorCode = (caught: unknown): string | null => {
  const detail = (caught as AxiosError<{ detail?: unknown }>).response?.data?.detail
  return isCoded(detail) ? detail.code : null
}

export const gameErrorMessage = (caught: unknown): string => {
  const err = caught as AxiosError<{ detail?: unknown }>
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (isCoded(detail)) return detail.message
  if (Array.isArray(detail)) return '입력값을 확인하세요.'
  if (err.response) return `요청 실패 (HTTP ${err.response.status})`
  if (caught instanceof Error && !err.isAxiosError) return caught.message
  return '게임 서버에 연결할 수 없습니다.'
}
