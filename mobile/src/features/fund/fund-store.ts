// 펀드 목록 = SecureStore(계정별 키 1개, 2KB 한도 → core 의 MAX_FUNDS·MAX_NAME),
// 리포트 캐시 = 앱 문서 폴더의 펀드별 JSON 파일(SecureStore 2KB 한도를 넘으므로).
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { parseFundList, type CacheEntry, type CachePort, type FundEntry } from './core';
import { rememberFundOwner } from './keys';
import { currentOwnerId, fundListKey } from './owner';

/** 현재 로그인 계정의 목록(uid 를 주면 그 계정). 로그인 안 됨·hydrate 전이면 던진다(owner.ts). */
export async function loadFunds(uid: number = currentOwnerId()): Promise<FundEntry[]> {
  return parseFundList(await SecureStore.getItemAsync(fundListKey(uid)));
}

/** 현재 로그인 계정의 목록에 저장(uid 를 주면 그 계정). 로그인 안 됨이면 던진다 — 공용 키에 쓰지 않는다. */
export async function saveFunds(list: FundEntry[], uid: number = currentOwnerId()): Promise<void> {
  await rememberFundOwner(uid); // iOS 재설치 정리가 이 계정 키를 찾을 수 있게(keys.ts)
  await SecureStore.setItemAsync(fundListKey(uid), JSON.stringify(list));
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
