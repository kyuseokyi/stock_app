import { mergeFundLists, parseFundList, type CacheEntry, type CachePort, type FundEntry } from './fundCore'
import { useAuthStore } from '../store/auth'

// 펀드 목록·리포트 캐시 = 이 브라우저 localStorage(서버 저장 없음). 사생활 보호 모드 등에서 실패해도 무시.
// 목록은 로그인 계정별 키(2026-10-23 계정별 저장 설계). 캐시는 펀드 id(무작위) 기준이라 계정 구분 없이 그대로.
const LIST_PREFIX = 'fund_list_v1_u'
/** 계정별 저장 전 이 브라우저 공용 목록 — 처음 들어온 계정이 가져오거나 버린다 */
const LEGACY_LIST_KEY = 'fund_list_v1'
const CACHE_PREFIX = 'fund_cache_v1:'

export const fundListKey = (uid: number): string => `${LIST_PREFIX}${uid}`

/** 지금 로그인한 계정 id(로그인 안 됨이면 null) — 웹 인증 store 는 모듈 로드 때 동기로 채워진다 */
export const currentFundOwner = (): number | null => useAuthStore.getState().user?.id ?? null

function get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 성공 여부를 돌려준다 — 가져오기처럼 "먼저 쓴 게 성공해야 다음 단계"인 곳에서 확인 */
function trySet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false // 저장 불가 환경 — 화면은 계속 동작
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // 무시
  }
}

/** 이 계정의 목록. 로그인 안 됨이면 빈 목록. uid 를 생략하면 지금 로그인한 계정. */
export function loadFunds(uid: number | null = currentFundOwner()): FundEntry[] {
  return uid === null ? [] : parseFundList(get(fundListKey(uid)))
}

/**
 * 목록 저장 — 목록을 읽었던 계정(uid)이 지금 로그인한 계정일 때만 쓴다.
 * 계정이 바뀐 뒤 이전 화면 상태가 새 계정 키에 덮어써지지 않게. 저장 못 했으면 false.
 */
export function saveFunds(list: FundEntry[], uid: number | null): boolean {
  if (uid === null || uid !== currentFundOwner()) return false
  return trySet(fundListKey(uid), JSON.stringify(list))
}

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
    trySet(CACHE_PREFIX + id, JSON.stringify(entry))
  },
}

export function deleteCache(id: string): void {
  remove(CACHE_PREFIX + id)
}

// ── 옛 공용 목록(fund_list_v1) 가져오기·버리기 ──

export const loadLegacyFunds = (): FundEntry[] => parseFundList(get(LEGACY_LIST_KEY))

/** 이 브라우저의 모든 계정 목록이 쓰는 펀드 id — 다른 계정이 이미 가져간 펀드의 캐시를 지우지 않게 */
function idsInAccountLists(): Set<string> {
  const ids = new Set<string>()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(LIST_PREFIX)) for (const f of parseFundList(get(key))) ids.add(f.id)
    }
  } catch {
    // 나열 실패 — 아래에서 내 목록 id 만이라도 지킨다
  }
  return ids
}

function deleteCachesExcept(funds: FundEntry[], keep: Set<string>): void {
  for (const f of funds) if (!keep.has(f.id)) deleteCache(f.id)
}

/**
 * 가져오기 미리보기(저장 없음).
 * - full: 이 계정 목록이 꽉 차서 하나도 못 가져옴(가져올 수 없는 펀드만 남음) → 반복 안내 대신 버리기만 제안
 * - added/skipped: 가져올 수 있는 개수 / 한도로 남는 개수
 */
export type LegacyPreview = { count: number; added: number; skipped: number; full: boolean }

export function previewLegacyImport(uid: number): LegacyPreview | null {
  const legacy = loadLegacyFunds()
  if (legacy.length === 0) return null
  const r = mergeFundLists(loadFunds(uid), legacy)
  return { count: legacy.length, added: r.added, skipped: r.skipped, full: r.added === 0 && r.skipped > 0 }
}

export type LegacyImportResult = { added: number; skipped: number }

/**
 * 가져오기 — 내 목록과 합침(URL 중복 제거·한도) → 내 키 먼저 저장 → 옛 키 처리.
 * 한도로 못 가져온 펀드는 옛 키에 남기고 캐시도 보존(다른 계정이 가져가거나 나중에 버린다).
 * 순서상 도중에 실패해도 다음 진입 때 다시 물어 같은 결과가 된다(내 목록에 이미 있는 URL 은 건너뜀).
 */
export function importLegacyFunds(uid: number): LegacyImportResult {
  const legacy = loadLegacyFunds()
  const r = mergeFundLists(loadFunds(uid), legacy)
  if (!saveFunds(r.funds, uid)) throw new Error('펀드 목록을 저장하지 못했어요')

  // URL 이 이미 내 목록에 있던 옛 펀드(다른 id) — 내 펀드 캐시가 따로 있으니 옛 캐시만 정리
  const keep = idsInAccountLists()
  for (const f of r.funds) keep.add(f.id)
  for (const d of r.duplicates) if (!keep.has(d.legacy.id)) deleteCache(d.legacy.id)

  if (r.dropped.length > 0) {
    if (!trySet(LEGACY_LIST_KEY, JSON.stringify(r.dropped))) throw new Error('남은 펀드를 저장하지 못했어요')
  } else {
    remove(LEGACY_LIST_KEY)
  }
  return { added: r.added, skipped: r.skipped }
}

/** 버리기 — 옛 키와 그 펀드들의 캐시 삭제. 내(또는 이 브라우저의 다른 계정) 목록이 쓰는 id 의 캐시는 남긴다. */
export function discardLegacyFunds(uid: number): void {
  const keep = idsInAccountLists()
  for (const f of loadFunds(uid)) keep.add(f.id)
  deleteCachesExcept(loadLegacyFunds(), keep)
  remove(LEGACY_LIST_KEY)
}

/** 회원 탈퇴 성공 뒤 — 그 계정의 목록과 캐시 삭제. 이 브라우저의 다른 계정·옛 목록이 쓰는 id 의 캐시는 남긴다(앱 account-purge 와 같은 동작). */
export function purgeAccountFunds(uid: number): void {
  const funds = loadFunds(uid)
  remove(fundListKey(uid))
  const keep = idsInAccountLists()
  for (const f of loadLegacyFunds()) keep.add(f.id)
  deleteCachesExcept(funds, keep)
}
