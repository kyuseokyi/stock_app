import { deleteAccountErrorMessage } from './delete-account';

describe('deleteAccountErrorMessage', () => {
  test('CONFIRM_REQUIRED', () => {
    expect(deleteAccountErrorMessage(400, { detail: { code: 'CONFIRM_REQUIRED', message: 'x' } })).toBe(
      '탈퇴 확인에 실패했어요. 다시 시도해 주세요.',
    );
  });
  test('ADMIN_CANNOT_DELETE', () => {
    expect(deleteAccountErrorMessage(403, { detail: { code: 'ADMIN_CANNOT_DELETE', message: 'x' } })).toBe(
      '관리자 계정은 탈퇴할 수 없어요.',
    );
  });
  test('401 은 로그인 만료', () => {
    expect(deleteAccountErrorMessage(401, { detail: 'Not authenticated' })).toBe(
      '로그인이 만료되었어요. 다시 로그인해 주세요.',
    );
  });
  test('네트워크 오류(status 없음)', () => {
    expect(deleteAccountErrorMessage(undefined, undefined)).toBe(
      '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.',
    );
  });
  test('모르는 코드·문자열 detail·빈 본문은 기본 문구', () => {
    const fallback = '탈퇴에 실패했어요. 잠시 후 다시 시도해 주세요.';
    expect(deleteAccountErrorMessage(500, { detail: { code: 'WHAT' } })).toBe(fallback);
    expect(deleteAccountErrorMessage(400, { detail: 'oops' })).toBe(fallback);
    expect(deleteAccountErrorMessage(500, 'Internal Server Error')).toBe(fallback);
    expect(deleteAccountErrorMessage(500, null)).toBe(fallback);
  });
});
