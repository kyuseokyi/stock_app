/**
 * 시스템 딥링크 재작성(expo-router NativeIntent).
 * 간편 로그인 복귀 링크(stockapp[-dev]://auth?code=…)는 openAuthSessionAsync 가 직접 받는다.
 * Android 에서는 같은 링크가 라우터에도 전달돼 없는 /auth 화면(Unmatched)으로 가므로 라우팅에서 제외한다.
 */
import { isAuthReturnUrl } from '@/features/auth/return-url';

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    if (isAuthReturnUrl(path)) return initial ? '/profile' : null; // null = 현재 화면 유지
    return path;
  } catch {
    return path;
  }
}
