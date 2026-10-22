// 펀드 SecureStore 키 이름 + 소유자 목록(fund_owners_v1) — 인증 스토어를 import 하지 않는 순수 모듈.
// 인증 hydrate 전에 도는 iOS 첫 실행 정리(auth/install-cleanup.ts)가 쓰므로 owner.ts(인증 스토어 의존)와 분리했다.
// owner.ts·backup-state.ts 가 같은 이름을 다시 내보낸다(기존 import 경로 유지).
import * as SecureStore from 'expo-secure-store';

// SecureStore 키 허용 문자 [A-Za-z0-9._-] — 숫자 id 라 안전
export const fundListKey = (uid: number): string => `fund_list_v1_u${uid}`;
export const backupStateKey = (uid: number): string => `fund_backup_state_v1_u${uid}`;
/** 계정별 저장 전 옛 키(기기 공용) — 가져오기·버리기에서만 쓴다 */
export const LEGACY_FUND_LIST_KEY = 'fund_list_v1';
export const LEGACY_BACKUP_STATE_KEY = 'fund_backup_state_v1';

/**
 * 이 기기에 펀드 키를 만든 적 있는 앱 계정 id 목록(JSON 배열).
 * SecureStore 에는 키 나열 API 가 없어, iOS 재설치 정리가 계정별 키를 찾으려면 이 목록이 필요하다(2026-10-23 설계 '앱 삭제').
 */
export const FUND_OWNERS_KEY = 'fund_owners_v1';

export function parseOwners(raw: string | null): number[] {
  try {
    const d: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(d) ? [...new Set(d.filter((x): x is number => Number.isSafeInteger(x)))] : [];
  } catch {
    return [];
  }
}

export async function loadFundOwners(): Promise<number[]> {
  return parseOwners(await SecureStore.getItemAsync(FUND_OWNERS_KEY));
}

// 읽고 고쳐 쓰기는 한 줄로 — 동시에 두 계정이 추가·제거돼도 서로 덮어쓰지 않게
let ownersChain: Promise<void> = Promise.resolve();
// 이번 실행에서 이미 목록에 있음을 확인한 id — 저장할 때마다 키체인을 다시 쓰지 않게
const knownOwners = new Set<number>();

function updateOwners(fn: (ids: number[]) => number[] | null): Promise<void> {
  const run = ownersChain.then(async () => {
    const next = fn(await loadFundOwners());
    if (!next) return;
    // 비면 키를 지운다 — 마지막 계정이 탈퇴하면 기기에 아무 펀드 키도 남지 않게
    await (next.length
      ? SecureStore.setItemAsync(FUND_OWNERS_KEY, JSON.stringify(next))
      : SecureStore.deleteItemAsync(FUND_OWNERS_KEY));
  });
  ownersChain = run.catch(() => {});
  return run;
}

/** 계정별 펀드 키를 쓰기 전에 부른다. 실패는 던지지 않는다(펀드 저장이 우선 — 놓치면 iOS 재설치 때 그 키만 남는다). */
export async function rememberFundOwner(uid: number): Promise<void> {
  if (knownOwners.has(uid)) return;
  try {
    await updateOwners((ids) => (ids.includes(uid) ? null : [...ids, uid]));
    knownOwners.add(uid);
  } catch (e) {
    console.warn('[fund-owners] 소유자 목록 저장 실패', e);
  }
}

/** 회원 탈퇴 정리 — 그 계정의 키를 지운 뒤 목록에서 뺀다. 실패는 던지지 않는다(남아도 정리 때 없는 키를 지울 뿐). */
export async function forgetFundOwner(uid: number): Promise<void> {
  knownOwners.delete(uid);
  try {
    await updateOwners((ids) => (ids.includes(uid) ? ids.filter((x) => x !== uid) : null));
  } catch (e) {
    console.warn('[fund-owners] 소유자 목록 제거 실패', e);
  }
}

/** 테스트 전용 — 실행 간 기억(knownOwners)을 비운다 */
export function resetFundOwnersMemoForTest(): void {
  knownOwners.clear();
}
