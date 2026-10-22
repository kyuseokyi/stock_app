// 펀드 목록 = SecureStore(계정별 키 1개, 2KB 한도 → core 의 MAX_FUNDS·MAX_NAME),
// 리포트 캐시 = 앱 문서 폴더의 펀드별 JSON 파일(SecureStore 2KB 한도를 넘으므로).
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { parseFundList, renameFund, type CacheEntry, type CachePort, type FundEntry } from './core';
import { rememberFundOwner } from './keys';
import { currentOwnerId, currentOwnerIdOrNull, fundListKey } from './owner';

/** 현재 로그인 계정의 목록(uid 를 주면 그 계정). 로그인 안 됨·hydrate 전이면 던진다(owner.ts). */
export async function loadFunds(uid: number = currentOwnerId()): Promise<FundEntry[]> {
  return parseFundList(await SecureStore.getItemAsync(fundListKey(uid)));
}

/** 현재 로그인 계정의 목록에 저장(uid 를 주면 그 계정). 로그인 안 됨이면 던진다 — 공용 키에 쓰지 않는다. */
export async function saveFunds(list: FundEntry[], uid: number = currentOwnerId()): Promise<void> {
  await rememberFundOwner(uid); // iOS 재설치 정리가 이 계정 키를 찾을 수 있게(keys.ts)
  await SecureStore.setItemAsync(fundListKey(uid), JSON.stringify(list));
}

export type OwnerChangedError = Error & { fundOwnerChanged: true };

export const isOwnerChangedError = (e: unknown): e is OwnerChangedError =>
  e instanceof Error && (e as Partial<OwnerChangedError>).fundOwnerChanged === true;

/**
 * 목록을 읽은 계정(uid)으로만 저장 — 저장 시점 현재 소유자가 uid 와 다르면(계정 전환·로그아웃) 쓰지 않고 던진다.
 * 화면에 남은 A 의 목록으로 만든 next 가 B 키에 저장되는 누출을 막는다. 던지므로 호출부의 뒤처리(파일 삭제 등)도 건너뛴다.
 */
export async function saveFundsAs(list: FundEntry[], uid: number): Promise<void> {
  if (currentOwnerIdOrNull() !== uid) {
    throw Object.assign(new Error('계정이 바뀌어 저장하지 않았어요'), { fundOwnerChanged: true as const });
  }
  await saveFunds(list, uid);
}

/** 이름 변경 — 같은 uid 로 읽고 쓴다(읽기·쓰기 사이 계정이 바뀌면 저장하지 않음) */
export async function renameFundAs(uid: number, id: string, name: string): Promise<void> {
  await saveFundsAs(renameFund(await loadFunds(uid), id, name), uid);
}

/** 회원 탈퇴 정리용 — 그 계정의 목록 키 삭제 */
export async function deleteFundList(uid: number): Promise<void> {
  await SecureStore.deleteItemAsync(fundListKey(uid));
}

const cacheFile = (id: string): File => new File(Paths.document, `fund-cache-${id}.json`);

export const fileCache: CachePort = {
  async read(id) {
    try {
      const f = cacheFile(id);
      return f.exists ? (JSON.parse(await f.text()) as CacheEntry) : null;
    } catch {
      return null;
    }
  },
  async write(id, entry) {
    try {
      const f = cacheFile(id);
      if (!f.exists) f.create();
      f.write(JSON.stringify(entry));
    } catch {
      // 캐시는 보조 저장 — 실패해도 가져온 리포트는 그대로 보여준다
    }
  },
};

export function deleteCache(id: string): void {
  try {
    const f = cacheFile(id);
    if (f.exists) f.delete();
  } catch {
    // 지우지 못해도 목록에서 빠졌으니 다시 읽히지 않는다
  }
}
