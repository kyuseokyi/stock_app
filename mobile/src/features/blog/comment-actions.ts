// 댓글 ⋯ 메뉴 분기 · 표시 · 신고 사유 · 오류 문구 — 순수 함수(네트워크·RN 의존 없음, 테스트 대상). 웹 lib/commentActions 와 같은 규칙.

export type ReportReason = 'abuse' | 'spam' | 'sexual' | 'privacy' | 'scam' | 'other';

/** 신고 사유(서버 값 → 표시 문구), 보여 주는 순서 그대로 */
export const REPORT_REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: 'abuse', label: '욕설·비하' },
  { value: 'spam', label: '스팸·광고' },
  { value: 'sexual', label: '음란·불쾌' },
  { value: 'privacy', label: '개인정보 노출' },
  { value: 'scam', label: '투자 사기·리딩방' },
  { value: 'other', label: '기타(직접 입력)' },
];

export const REPORT_DETAIL_MAX = 200;
export const HIDDEN_COMMENT_TEXT = '신고로 가려진 댓글이에요';
export const UNKNOWN_USER = '알 수 없는 사용자';

export const TOAST_REPORTED = '신고했어요. 검토 후 조치할게요';
export const TOAST_BLOCKED = '차단했어요. 이 사용자의 댓글이 보이지 않아요';
export const TOAST_UNBLOCKED = '차단을 해제했어요';
export const TOAST_DELETED = '댓글을 삭제했어요';

type MenuTarget = { hidden: boolean; isMine: boolean; authorId: number | null };

export type CommentMenuAction = 'delete' | 'report' | 'block';
export type CommentMenu =
  | { kind: 'none' } // 가려진 댓글 — ⋯ 자체를 그리지 않는다
  | { kind: 'login' } // 비로그인 — ⋯ 를 누르면 로그인 안내
  | { kind: 'actions'; actions: CommentMenuAction[] };

/** 댓글 ⋯ 메뉴: 가려짐 → 없음 / 비로그인 → 로그인 안내 / 내 댓글 → 삭제 / 남의 댓글 → 신고·차단(작성자 없으면 신고만) */
export function commentMenu(c: MenuTarget, loggedIn: boolean): CommentMenu {
  if (c.hidden) return { kind: 'none' };
  if (!loggedIn) return { kind: 'login' };
  if (c.isMine) return { kind: 'actions', actions: ['delete'] };
  return { kind: 'actions', actions: c.authorId != null ? ['report', 'block'] : ['report'] };
}

export type CommentView =
  | { hidden: true; text: string }
  | { hidden: false; author: string; text: string };

/** 댓글 한 줄 표시 — 가려진 댓글은 작성자 없이 회색 안내 문구만 */
export function commentView(
  c: { hidden: boolean; authorName: string | null; content: string },
  anonymousName: string,
): CommentView {
  if (c.hidden) return { hidden: true, text: HIDDEN_COMMENT_TEXT };
  return { hidden: false, author: c.authorName || anonymousName, text: c.content };
}

/** [신고하기] 활성 조건 — 사유 선택, 기타면 1~200자 입력 */
export function canSubmitReport(reason: ReportReason | null, detail: string): boolean {
  if (!reason) return false;
  if (reason !== 'other') return true;
  const d = detail.trim();
  return d.length > 0 && d.length <= REPORT_DETAIL_MAX;
}

/** 신고 요청 본문 — detail 은 기타일 때만 보낸다 */
export function buildReportBody(reason: ReportReason, detail: string): { reason: ReportReason; detail?: string } {
  return reason === 'other' ? { reason, detail: detail.trim() } : { reason };
}

/** 차단 목록 이름 — 닉네임이 없으면(탈퇴 등) "알 수 없는 사용자" */
export function blockedName(nickname: string | null | undefined): string {
  return nickname?.trim() || UNKNOWN_USER;
}

export type CommentAction = 'submit' | 'delete' | 'report' | 'block' | 'unblock';

const CODE_MESSAGES: Record<string, string> = {
  COMMENT_BANNED: '운영 정책 위반으로 댓글을 쓸 수 없어요',
  TERMS_REQUIRED: '약관에 동의해야 댓글을 쓸 수 있어요',
  ALREADY_REPORTED: '이미 신고한 댓글이에요',
  CANNOT_REPORT_OWN: '내 댓글은 신고할 수 없어요',
  COMMENT_NOT_FOUND: '이미 삭제된 댓글이에요',
  CANNOT_BLOCK_SELF: '나 자신은 차단할 수 없어요',
  CANNOT_BLOCK_ADMIN: '운영자는 차단할 수 없어요',
  USER_NOT_FOUND: '이미 탈퇴한 사용자예요',
};

const DEFAULT_MESSAGES: Record<CommentAction, string> = {
  submit: '댓글 등록에 실패했습니다.',
  delete: '댓글을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.',
  report: '신고하지 못했어요. 잠시 후 다시 시도해 주세요.',
  block: '차단하지 못했어요. 잠시 후 다시 시도해 주세요.',
  unblock: '차단을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

/** 서버 오류 본문 {"detail":{"code","message"}} 의 code(없으면 undefined) */
export function errorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return undefined;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail !== 'object' || detail === null || !('code' in detail)) return undefined;
  const code = (detail as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * 댓글 관련 실패 → 사용자 문구. status: HTTP 상태(네트워크 오류면 undefined), body: 응답 본문.
 * 작성(submit)의 코드 없는 403 은 기존처럼 "게시판 댓글 비활성"으로 본다.
 */
export function commentErrorMessage(action: CommentAction, status: number | undefined, body: unknown): string {
  if (status === undefined) return '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
  if (status === 401) return '세션이 만료되었습니다. 다시 로그인해주세요.';
  const code = errorCode(body);
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (action === 'submit' && status === 403) return '이 게시판은 댓글이 비활성화되어 있습니다.';
  if (action === 'report' && status === 422) return '신고 사유를 확인해 주세요.';
  return DEFAULT_MESSAGES[action];
}
