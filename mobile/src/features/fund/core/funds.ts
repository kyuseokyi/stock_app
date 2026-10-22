// 기기에 저장하는 펀드 목록 조작(순수 함수). 저장 자체는 플랫폼별 store 가 한다.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { fundError, type FundReport } from './types';
import { isFundUrl, normalizeFundUrl } from './url';

export type FundEntry = { id: string; name: string; url: string };

export const MAX_FUNDS = 10; // 앱은 목록을 SecureStore 값 하나(iOS 약 2KB 한도)에 둔다
export const MAX_NAME = 20;

export function newFundId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function addFund(list: FundEntry[], input: { name: string; url: string }, id: string): FundEntry[] {
  const url = normalizeFundUrl(input.url);
  if (list.some((f) => f.url === url)) throw fundError('input', '이미 등록한 주소예요.');
  if (list.length >= MAX_FUNDS) throw fundError('input', `펀드는 ${MAX_FUNDS}개까지 등록할 수 있어요.`);
  return [...list, { id, name: input.name.trim().slice(0, MAX_NAME), url }];
}

export const removeFund = (list: FundEntry[], id: string): FundEntry[] => list.filter((f) => f.id !== id);

export const renameFund = (list: FundEntry[], id: string, name: string): FundEntry[] =>
  list.map((f) => (f.id === id ? { ...f, name: name.trim().slice(0, MAX_NAME) } : f));

export const displayName = (f: FundEntry): string => f.name || '이름 없는 펀드';

/** 이름을 비워 등록한 펀드에 첫 조회 후 붙일 이름 */
export const defaultName = (r: FundReport): string =>
  r.investorNo ? `펀드 ${r.investorNo}` : r.title.slice(0, MAX_NAME) || '내 펀드';

export type FundListMerge = {
  funds: FundEntry[];
  added: number;
  /** 한도(MAX_FUNDS)로 못 가져온 개수 = dropped.length */
  skipped: number;
  /** URL 이 이미 있어 넣지 않은 옛 펀드 → 합칠 대상(같은 id 면 제외 — 이미 가져온 펀드) */
  duplicates: { legacy: FundEntry; mine: FundEntry }[];
  dropped: FundEntry[];
};

/** 기기 공용(옛) 목록을 내 계정 목록에 합치기 — 내 것 먼저, 옛 id 유지(캐시·기록 파일이 id 기준), URL 중복 제거, 한도까지 */
export function mergeFundLists(mine: FundEntry[], legacy: FundEntry[]): FundListMerge {
  const funds = [...mine];
  const duplicates: FundListMerge['duplicates'] = [];
  const dropped: FundEntry[] = [];
  let added = 0;
  for (const f of legacy) {
    const same = funds.find((x) => x.url === f.url);
    if (same) {
      if (same.id !== f.id) duplicates.push({ legacy: f, mine: same });
      continue;
    }
    if (funds.length >= MAX_FUNDS) {
      dropped.push(f);
      continue;
    }
    funds.push(f);
    added++;
  }
  return { funds, added, skipped: dropped.length, duplicates, dropped };
}

export function parseFundList(raw: string | null): FundEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((f: unknown): f is FundEntry => {
      const o = f as Partial<FundEntry> | null;
      return !!o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.url === 'string' && isFundUrl(o.url);
    });
  } catch {
    return [];
  }
}
