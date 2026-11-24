// 관리자 아이디·비밀번호 입력 검사 — 서버 규칙(apps/auth/schemas.py)과 같게 유지
export const LOGIN_ID_RULE = '영문 소문자·숫자·. _ - 로 4~30자'
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 72

const LOGIN_ID_RE = /^[a-z0-9._-]{4,30}$/

/** 문제가 있으면 안내 문구, 괜찮으면 null */
export function validateLoginId(id: string): string | null {
  return LOGIN_ID_RE.test(id) ? null : `아이디는 ${LOGIN_ID_RULE}로 입력해 주세요.`
}

export function validatePassword(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`
  if (pw.length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하여야 해요.`
  return null
}
