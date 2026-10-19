import type { AxiosError } from 'axios'

// 서버 오류 → 화면 메시지. detail 형태: 문자열 | {code, message, ...} | 검증 오류 배열(422)

/** detail 이 객체({code, message, ...})면 그대로, 아니면 null */
export const apiErrorDetail = (caught: unknown): Record<string, unknown> | null => {
  const detail = (caught as AxiosError<{ detail?: unknown }>).response?.data?.detail
  return typeof detail === 'object' && detail !== null && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : null
}

export const apiErrorMessage = (caught: unknown, fallback = '서버에 연결할 수 없습니다.'): string => {
  const err = caught as AxiosError<{ detail?: unknown }>
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  const coded = apiErrorDetail(caught)
  if (coded && typeof coded.message === 'string') return coded.message
  if (Array.isArray(detail)) return '입력값을 확인하세요.'
  if (err.response) return `요청 실패 (HTTP ${err.response.status})`
  return fallback
}
