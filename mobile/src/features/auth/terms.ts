// 이용약관 동의 게이트·심사 전용 로그인의 순수 판정·문구(2026-11-13 설계). RN·expo import 없음 — jest 대상.

/** 현재 약관 버전 — 서버 backend/apps/auth/terms.py 의 TERMS_VERSION 과 반드시 같아야 한다(다르면 동의가 409) */
export const TERMS_VERSION = '2026-11-13';

/** 약관 동의 시트의 요약 3줄(웹 TermsModal 과 같은 문구) */
export const TERMS_SUMMARY = [
  'FunNote의 정보는 참고용이며 투자 권유가 아니에요',
  '모의투자는 가상 자금으로만 진행돼요',
  '욕설·스팸·사기 권유는 금지되며, 신고되면 조치해요',
] as const;

/** 내정보 정책 링크 위 정보 제공 고지(웹과 같은 문구) */
export const INFO_NOTICE =
  'FunNote는 투자 정보를 참고용으로 제공하며 투자 권유·자문을 하지 않습니다. 모의투자는 가상 자금으로 진행돼요.';

/** [동의하지 않음] → 로그아웃 뒤 토스트 */
export const TERMS_DECLINED_MESSAGE = '약관에 동의해야 회원 기능을 쓸 수 있어요';

/** 약관 동의가 필요한 사용자인지 — 저장된 옛 사용자(필드 없음)·구 서버는 false(서버 판정만 믿는다) */
export function needsTerms(user: { termsRequired?: boolean } | null | undefined): boolean {
  return user?.termsRequired === true;
}

/** 동의 실패 문구. status: HTTP 상태(네트워크 오류면 undefined) */
export function agreeTermsErrorMessage(status: number | undefined): string {
  if (status === undefined) return '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
  if (status === 409) return '약관이 바뀌었어요. 앱을 업데이트해 주세요.';
  if (status === 401) return '로그인이 만료되었어요. 다시 로그인해 주세요.';
  return '동의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

/** 심사 전용 로그인 실패 문구 */
export function reviewLoginErrorMessage(status: number | undefined): string {
  if (status === 404) return '지금은 사용할 수 없어요';
  if (status === 401) return '이메일 또는 비밀번호를 확인해 주세요';
  if (status === 403) return '사용할 수 없는 계정이에요';
  if (status === undefined) return '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
  return '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.';
}

/** 버전 표시를 이 횟수만큼 창 안에서 누르면 심사용 로그인 폼을 연다 */
export const REVIEW_TAP_COUNT = 7;
export const REVIEW_TAP_WINDOW_MS = 3_000;

/**
 * 탭 한 번 반영 — 창(3초) 밖의 옛 탭은 버리고 이번 탭을 더한다. 7번이 차면 open=true 와 함께 기록을 비운다.
 * times: 지금까지의 탭 시각(ms), now: 이번 탭 시각
 */
export function registerReviewTap(times: readonly number[], now: number): { times: number[]; open: boolean } {
  const recent = times.filter((t) => now - t < REVIEW_TAP_WINDOW_MS);
  recent.push(now);
  if (recent.length >= REVIEW_TAP_COUNT) return { times: [], open: true };
  return { times: recent, open: false };
}
