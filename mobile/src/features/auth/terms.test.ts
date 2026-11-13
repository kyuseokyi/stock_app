// 약관 게이트 판정·오류 문구·심사 로그인 7번 탭(3초 창)
import {
  agreeTermsErrorMessage,
  needsTerms,
  registerReviewTap,
  REVIEW_TAP_WINDOW_MS,
  reviewLoginErrorMessage,
  TERMS_VERSION,
} from './terms';

describe('needsTerms', () => {
  it('termsRequired=true 만 동의 필요', () => {
    expect(needsTerms({ termsRequired: true })).toBe(true);
    expect(needsTerms({ termsRequired: false })).toBe(false);
  });
  it('필드 없는 옛 저장값·비로그인은 띄우지 않는다', () => {
    expect(needsTerms({})).toBe(false);
    expect(needsTerms(null)).toBe(false);
    expect(needsTerms(undefined)).toBe(false);
  });
  it('약관 버전은 서버 상수와 같은 값', () => {
    expect(TERMS_VERSION).toBe('2026-11-13');
  });
});

describe('agreeTermsErrorMessage', () => {
  it('409 → 앱 업데이트 안내', () => {
    expect(agreeTermsErrorMessage(409)).toContain('앱을 업데이트해 주세요');
  });
  it('네트워크 오류·그 밖의 상태', () => {
    expect(agreeTermsErrorMessage(undefined)).toContain('서버에 연결할 수 없어요');
    expect(agreeTermsErrorMessage(500)).toContain('잠시 후 다시 시도');
  });
});

describe('reviewLoginErrorMessage', () => {
  it('404·401·403 문구', () => {
    expect(reviewLoginErrorMessage(404)).toBe('지금은 사용할 수 없어요');
    expect(reviewLoginErrorMessage(401)).toBe('이메일 또는 비밀번호를 확인해 주세요');
    expect(reviewLoginErrorMessage(403)).toBe('사용할 수 없는 계정이에요');
  });
  it('네트워크 오류', () => {
    expect(reviewLoginErrorMessage(undefined)).toContain('서버에 연결할 수 없어요');
  });
});

describe('registerReviewTap', () => {
  const tapN = (n: number, start: number, step: number) => {
    let times: number[] = [];
    let open = false;
    for (let i = 0; i < n; i++) {
      const r = registerReviewTap(times, start + i * step);
      times = r.times;
      open = r.open;
    }
    return { times, open };
  };

  it('3초 안에 7번 → 열림, 기록 비움', () => {
    expect(tapN(7, 1000, 300)).toEqual({ times: [], open: true });
  });
  it('6번은 열리지 않는다', () => {
    const r = tapN(6, 1000, 300);
    expect(r.open).toBe(false);
    expect(r.times).toHaveLength(6);
  });
  it('느리게 누르면(창 밖 탭은 버림) 열리지 않는다', () => {
    expect(tapN(7, 0, 600).open).toBe(false); // 0~3600ms — 첫 탭들이 창 밖으로 빠진다
  });
  it('창 경계 — 정확히 3초 지난 탭은 센 것에서 빠진다', () => {
    const times = [0, 100, 200, 300, 400, 500];
    expect(registerReviewTap(times, REVIEW_TAP_WINDOW_MS).open).toBe(false);
    expect(registerReviewTap(times, REVIEW_TAP_WINDOW_MS - 1).open).toBe(true);
  });
});
