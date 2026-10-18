// 펀드 목록 = SecureStore(키 1개, 2KB 한도 → core 의 MAX_FUNDS·MAX_NAME),
// 리포트 캐시 = 앱 문서 폴더의 펀드별 JSON 파일(SecureStore 2KB 한도를 넘으므로).
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { parseFundList, type CacheEntry, type CachePort, type FundEntry } from './core';

const LIST_KEY = 'fund_list_v1';

export async function loadFunds(): Promise<FundEntry[]> {
  return parseFundList(await SecureStore.getItemAsync(LIST_KEY));
}

export async function saveFunds(list: FundEntry[]): Promise<void> {
  await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(list));
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
