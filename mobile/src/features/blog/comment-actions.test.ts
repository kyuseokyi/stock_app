import {
  blockedName,
  buildReportBody,
  canSubmitReport,
  commentErrorMessage,
  commentMenu,
  commentView,
  errorCode,
  HIDDEN_COMMENT_TEXT,
  REPORT_REASONS,
} from './comment-actions';

const base = { hidden: false, isMine: false, authorId: 7 };
const err = (code: string) => ({ detail: { code, message: 'x' } });

describe('commentMenu', () => {
  it('가려진 댓글은 메뉴 없음(로그인 여부·내 것 상관없이)', () => {
    expect(commentMenu({ ...base, hidden: true }, true)).toEqual({ kind: 'none' });
    expect(commentMenu({ ...base, hidden: true, isMine: true }, true)).toEqual({ kind: 'none' });
    expect(commentMenu({ ...base, hidden: true }, false)).toEqual({ kind: 'none' });
  });
  it('비로그인은 로그인 안내', () => {
    expect(commentMenu(base, false)).toEqual({ kind: 'login' });
  });
  it('내 댓글은 삭제만', () => {
    expect(commentMenu({ ...base, isMine: true }, true)).toEqual({ kind: 'actions', actions: ['delete'] });
  });
  it('남의 댓글은 신고·차단, 작성자를 모르면 신고만', () => {
    expect(commentMenu(base, true)).toEqual({ kind: 'actions', actions: ['report', 'block'] });
    expect(commentMenu({ ...base, authorId: null }, true)).toEqual({ kind: 'actions', actions: ['report'] });
  });
});

describe('commentView', () => {
  it('가려진 댓글은 안내 문구만', () => {
    expect(commentView({ hidden: true, authorName: null, content: '' }, '게스트')).toEqual({
      hidden: true,
      text: HIDDEN_COMMENT_TEXT,
    });
    expect(HIDDEN_COMMENT_TEXT).toBe('신고로 가려진 댓글이에요');
  });
  it('보통 댓글은 작성자(없으면 대체 이름)와 내용', () => {
    expect(commentView({ hidden: false, authorName: '철수', content: '안녕' }, '게스트')).toEqual({
      hidden: false,
      author: '철수',
      text: '안녕',
    });
    expect(commentView({ hidden: false, authorName: null, content: 'a' }, '게스트')).toMatchObject({ author: '게스트' });
  });
});

describe('신고 사유·본문', () => {
  it('사유 6개, 서버 값 순서', () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual(['abuse', 'spam', 'sexual', 'privacy', 'scam', 'other']);
    expect(REPORT_REASONS.find((r) => r.value === 'scam')?.label).toBe('투자 사기·리딩방');
  });
  it('기타는 1~200자 입력이 있어야 신고 가능', () => {
    expect(canSubmitReport(null, '')).toBe(false);
    expect(canSubmitReport('spam', '')).toBe(true);
    expect(canSubmitReport('other', '   ')).toBe(false);
    expect(canSubmitReport('other', '광고 링크')).toBe(true);
    expect(canSubmitReport('other', 'a'.repeat(200))).toBe(true);
    expect(canSubmitReport('other', 'a'.repeat(201))).toBe(false);
  });
  it('detail 은 기타일 때만 보낸다', () => {
    expect(buildReportBody('spam', '무시')).toEqual({ reason: 'spam' });
    expect(buildReportBody('other', ' 이유 ')).toEqual({ reason: 'other', detail: '이유' });
  });
});

describe('blockedName', () => {
  it('닉네임이 없으면 알 수 없는 사용자', () => {
    expect(blockedName('영희')).toBe('영희');
    expect(blockedName(null)).toBe('알 수 없는 사용자');
    expect(blockedName('  ')).toBe('알 수 없는 사용자');
  });
});

describe('commentErrorMessage', () => {
  it('code 추출', () => {
    expect(errorCode(err('ALREADY_REPORTED'))).toBe('ALREADY_REPORTED');
    expect(errorCode({ detail: '문자열' })).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });
  it('서버 코드별 문구', () => {
    expect(commentErrorMessage('submit', 403, err('COMMENT_BANNED'))).toBe('운영 정책 위반으로 댓글을 쓸 수 없어요');
    expect(commentErrorMessage('submit', 403, err('TERMS_REQUIRED'))).toBe('약관에 동의해야 댓글을 쓸 수 있어요');
    expect(commentErrorMessage('report', 409, err('ALREADY_REPORTED'))).toBe('이미 신고한 댓글이에요');
    expect(commentErrorMessage('report', 400, err('CANNOT_REPORT_OWN'))).toBe('내 댓글은 신고할 수 없어요');
    expect(commentErrorMessage('report', 404, err('COMMENT_NOT_FOUND'))).toBe('이미 삭제된 댓글이에요');
    expect(commentErrorMessage('block', 400, err('CANNOT_BLOCK_SELF'))).toBe('나 자신은 차단할 수 없어요');
    expect(commentErrorMessage('block', 400, err('CANNOT_BLOCK_ADMIN'))).toBe('운영자는 차단할 수 없어요');
    expect(commentErrorMessage('block', 404, err('USER_NOT_FOUND'))).toBe('이미 탈퇴한 사용자예요');
  });
  it('코드 없는 403 작성은 기존 "댓글 비활성" 문구 유지', () => {
    expect(commentErrorMessage('submit', 403, { detail: 'Comments disabled' })).toBe('이 게시판은 댓글이 비활성화되어 있습니다.');
  });
  it('401·네트워크·422·기본 문구', () => {
    expect(commentErrorMessage('report', 401, undefined)).toBe('세션이 만료되었습니다. 다시 로그인해주세요.');
    expect(commentErrorMessage('block', undefined, undefined)).toContain('서버에 연결할 수 없어요');
    expect(commentErrorMessage('report', 422, { detail: [] })).toBe('신고 사유를 확인해 주세요.');
    expect(commentErrorMessage('delete', 500, null)).toBe('댓글을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.');
  });
});
