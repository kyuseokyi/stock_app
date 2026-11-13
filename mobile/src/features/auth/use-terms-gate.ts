import { useAuthStore } from './store';
import { needsTerms } from './terms';

/**
 * 약관 동의 게이트가 열려 있는지(로그인 + 서버가 terms_required=true).
 * 다른 시트(푸시 안내·펀드 안내·선택 업데이트)는 이 값이 true 면 그리지 않는다 — RN Modal 두 장이 겹치지 않게.
 */
export function useTermsGateOpen(): boolean {
  return useAuthStore((s) => s.token !== null && needsTerms(s.user));
}
