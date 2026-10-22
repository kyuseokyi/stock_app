// 펀드 데이터 소유자 = 현재 로그인한 앱 계정(2026-10-23 계정별 저장 설계). 저장 키·파일 이름에 붙는다.
// 로그인 안 됨(또는 hydrate 전)이면 던진다 — 읽고 고쳐 쓰는 경로가 엉뚱한 키·빈 목록으로 덮어쓰지 않게.
import { useAuthStore } from '@/features/auth/store';

export type NoOwnerError = Error & { noFundOwner: true };

export const isNoOwnerError = (e: unknown): e is NoOwnerError =>
  e instanceof Error && (e as Partial<NoOwnerError>).noFundOwner === true;

export function currentOwnerId(): number {
  const { user, hydrated } = useAuthStore.getState();
  if (!hydrated || !user) throw Object.assign(new Error('로그인이 필요해요'), { noFundOwner: true as const });
  return user.id;
}

/** 던지지 않는 판 — 로그인 안 됨이면 null(백업 상태 읽기·대기 표시처럼 조용히 넘어가는 곳용) */
export function currentOwnerIdOrNull(): number | null {
  try {
    return currentOwnerId();
  } catch {
    return null;
  }
}

// SecureStore 키 허용 문자 [A-Za-z0-9._-] — 숫자 id 라 안전
export const fundListKey = (uid: number): string => `fund_list_v1_u${uid}`;
/** 계정별 저장 전 옛 키(기기 공용) — 가져오기·버리기에서만 쓴다 */
export const LEGACY_FUND_LIST_KEY = 'fund_list_v1';
