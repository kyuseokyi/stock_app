import axios from 'axios'

// 회원 탈퇴 실패 → 사용자 문구. 서버 detail = {code, message} (400/403), 401 = 로그인 만료.

const CODE_MESSAGES: Record<string, string> = {
  CONFIRM_REQUIRED: '탈퇴 확인에 실패했어요. 다시 시도해 주세요.',
  ADMIN_CANNOT_DELETE: '관리자 계정은 탈퇴할 수 없어요.',
}

const DEFAULT_MESSAGE = '탈퇴에 실패했어요. 잠시 후 다시 시도해 주세요.'

/** 확인 모달 안내 문구(모바일과 동일) */
export const DELETE_ACCOUNT_NOTICES = [
  '게임 계좌·거래·퀘스트·출석·퀴즈 기록과 댓글이 삭제돼요',
  "명예의 전당·주간 랭킹 기록은 '탈퇴한 회원'으로 남아요",
  '탈퇴하면 되돌릴 수 없어요',
  '네이버로 가입했다면 연결은 네이버 설정에서 해제할 수 있어요',
] as const

export function deleteAccountErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err) || !err.response) return '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
  if (err.response.status === 401) return '로그인이 만료되었어요. 다시 로그인해 주세요.'
  const data: unknown = err.response.data
  const detail = typeof data === 'object' && data !== null && 'detail' in data ? data.detail : undefined
  const code =
    typeof detail === 'object' && detail !== null && 'code' in detail && typeof detail.code === 'string'
      ? detail.code
      : undefined
  return (code && CODE_MESSAGES[code]) || DEFAULT_MESSAGE
}
