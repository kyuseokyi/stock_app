// 회원 탈퇴 실패 → 사용자 문구(순수 함수). 서버 detail = {code, message} (400/403), 401 = 로그인 만료.

const CODE_MESSAGES: Record<string, string> = {
  CONFIRM_REQUIRED: '탈퇴 확인에 실패했어요. 다시 시도해 주세요.',
  ADMIN_CANNOT_DELETE: '관리자 계정은 탈퇴할 수 없어요.',
};

const DEFAULT_MESSAGE = '탈퇴에 실패했어요. 잠시 후 다시 시도해 주세요.';

function detailCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return undefined;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail !== 'object' || detail === null || !('code' in detail)) return undefined;
  const code = (detail as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** status: HTTP 상태(네트워크 오류면 undefined), body: 응답 본문 */
export function deleteAccountErrorMessage(status: number | undefined, body: unknown): string {
  if (status === undefined) return '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
  if (status === 401) return '로그인이 만료되었어요. 다시 로그인해 주세요.';
  const code = detailCode(body);
  return (code && CODE_MESSAGES[code]) || DEFAULT_MESSAGE;
}

/** 시트 안내 문구(웹과 동일) */
export const DELETE_ACCOUNT_NOTICES = [
  '게임 계좌·거래·퀘스트·출석·퀴즈 기록과 댓글이 삭제돼요',
  "명예의 전당·주간 랭킹 기록은 '탈퇴한 회원'으로 남아요",
  '탈퇴하면 되돌릴 수 없어요',
  '네이버로 가입했다면 연결은 네이버 설정에서 해제할 수 있어요',
] as const;
