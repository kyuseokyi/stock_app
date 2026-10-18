import { parseFundList, type CacheEntry, type CachePort, type FundEntry } from './fundCore'

// 펀드 목록·리포트 캐시 = 이 브라우저 localStorage(서버 저장 없음). 사생활 보호 모드 등에서 실패해도 무시.
const LIST_KEY = 'fund_list_v1'
const CACHE_PREFIX = 'fund_cache_v1:'

function get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 저장 불가 환경 — 화면은 계속 동작
  }
}

export const loadFunds = (): FundEntry[] => parseFundList(get(LIST_KEY))
export const saveFunds = (list: FundEntry[]): void => set(LIST_KEY, JSON.stringify(list))

export const localCache: CachePort = {
  async read(id) {
    const raw = get(CACHE_PREFIX + id)
    if (!raw) return null
    try {
      return JSON.parse(raw) as CacheEntry
    } catch {
      return null
    }
  },
  async write(id, entry) {
    set(CACHE_PREFIX + id, JSON.stringify(entry))
  },
}

export function deleteCache(id: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + id)
  } catch {
    // 무시
  }
}
