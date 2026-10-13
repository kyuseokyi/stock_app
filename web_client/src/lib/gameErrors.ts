import axios from 'axios'

// 주문/청산 실패 → 사용자 문구. 서버 409/422 detail 은 이미 한국어 문장이므로 그대로 노출.

const NETWORK = '게임 서버에 연결할 수 없어요'

export function orderErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err) || !err.response) return NETWORK
  const { status } = err.response
  const data: unknown = err.response.data
  const detail: unknown = typeof data === 'object' && data !== null && 'detail' in data ? data.detail : undefined

  if (status === 401) return '로그인이 만료되었어요. 다시 로그인해 주세요'
  if (status === 403 && typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'LEVERAGE_LOCKED') {
    return '5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요'
  }
  if ((status === 403 || status === 404 || status === 409 || status === 422) && typeof detail === 'string') {
    return detail
  }
  if (status === 422) return '주문 조건이 올바르지 않아요'
  return NETWORK
}
