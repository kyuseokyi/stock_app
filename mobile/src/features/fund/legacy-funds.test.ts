jest.mock('expo-secure-store', () => require('./__fixtures__/fake-storage').secureStoreMock);
jest.mock('expo-file-system', () => require('./__fixtures__/fake-storage').fileSystemMock);
const mockAuth: { user: { id: number } | null; hydrated: boolean } = { user: null, hydrated: true };
jest.mock('@/features/auth/store', () => ({ useAuthStore: { getState: () => mockAuth } }));

import { fileMem, resetFakeStorage, secureMem } from './__fixtures__/fake-storage';
import { MAX_FUNDS, type FundEntry } from './core';
import { loadFunds, saveFunds } from './fund-store';
import { discardLegacyFunds, importLegacyFunds, loadLegacyFunds } from './legacy-funds';

const url = (n: number) => `https://fund.ivyro.net/dataroom/om_data/f${n}.htm`;
const e = (id: string, n: number): FundEntry => ({ id, name: `펀드${n}`, url: url(n) });
const hist = (u: string, day: string, recordedAt: number) =>
  JSON.stringify({
    v: 1,
    url: u,
    accounts: { 계좌1: [{ date: day, value: 110, day: 1, month: 2, recordedAt }] },
  });
const setLegacy = (list: FundEntry[]) => secureMem.set('fund_list_v1', JSON.stringify(list));
const STATE = JSON.stringify({ connected: true, email: 'old@gmail.com', lastBackupAt: 5, lastError: '' });

beforeEach(() => {
  resetFakeStorage();
  mockAuth.user = { id: 7 };
  mockAuth.hydrated = true;
});

describe('loadLegacyFunds', () => {
  it('옛 키 목록(없으면 빈 목록)', async () => {
    expect(await loadLegacyFunds()).toEqual([]);
    setLegacy([e('o1', 1)]);
    expect(await loadLegacyFunds()).toEqual([e('o1', 1)]);
  });
});

describe('importLegacyFunds', () => {
  it('내 목록에 합쳐 저장하고 옛 키를 지운다(캐시·기록 파일은 id 그대로 유지)', async () => {
    await saveFunds([e('m1', 1)]);
    setLegacy([e('o2', 2)]);
    fileMem.set('fund-cache-o2.json', '{}');
    fileMem.set('fund-history-o2.json', hist(url(2), '2026-10-01', 1));
    expect(await importLegacyFunds()).toEqual({ added: 1, skipped: 0 });
    expect(await loadFunds()).toEqual([e('m1', 1), e('o2', 2)]);
    expect(secureMem.has('fund_list_v1')).toBe(false);
    expect(fileMem.has('fund-cache-o2.json')).toBe(true);
    expect(fileMem.has('fund-history-o2.json')).toBe(true);
  });

  it('한도를 넘친 옛 펀드는 개수를 돌려주고 그 파일은 지운다', async () => {
    await saveFunds(Array.from({ length: MAX_FUNDS - 1 }, (_, i) => e(`m${i}`, i)));
    setLegacy([e('o100', 100), e('o101', 101)]);
    fileMem.set('fund-cache-o101.json', '{}');
    fileMem.set('fund-history-o101.json', hist(url(101), '2026-10-01', 1));
    expect(await importLegacyFunds()).toEqual({ added: 1, skipped: 1 });
    expect(await loadFunds()).toHaveLength(MAX_FUNDS);
    expect(fileMem.has('fund-cache-o101.json')).toBe(false);
    expect(fileMem.has('fund-history-o101.json')).toBe(false);
  });

  it('URL 이 겹치는 옛 펀드는 기록을 내 펀드 기록에 합치고 옛 파일을 지운다', async () => {
    await saveFunds([e('m1', 1)]);
    fileMem.set('fund-history-m1.json', hist(url(1), '2026-10-02', 2));
    setLegacy([e('o1', 1)]);
    fileMem.set('fund-history-o1.json', hist(url(1), '2026-10-01', 1));
    fileMem.set('fund-cache-o1.json', '{}');
    expect(await importLegacyFunds()).toEqual({ added: 0, skipped: 0 });
    const merged = JSON.parse(fileMem.get('fund-history-m1.json')!);
    expect(merged.accounts['계좌1'].map((p: { date: string }) => p.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(fileMem.has('fund-history-o1.json')).toBe(false);
    expect(fileMem.has('fund-cache-o1.json')).toBe(false);
  });

  it('옛 백업 상태는 내 상태가 비었을 때만 넘기고, 옛 키는 지운다', async () => {
    setLegacy([e('o1', 1)]);
    secureMem.set('fund_backup_state_v1', STATE);
    await importLegacyFunds();
    expect(secureMem.get('fund_backup_state_v1_u7')).toBe(STATE);
    expect(secureMem.has('fund_backup_state_v1')).toBe(false);

    mockAuth.user = { id: 8 };
    const mine = JSON.stringify({ connected: true, email: 'b@gmail.com', lastBackupAt: 9, lastError: '' });
    secureMem.set('fund_backup_state_v1_u8', mine);
    setLegacy([e('o2', 2)]);
    secureMem.set('fund_backup_state_v1', STATE);
    await importLegacyFunds();
    expect(secureMem.get('fund_backup_state_v1_u8')).toBe(mine);
    expect(secureMem.has('fund_backup_state_v1')).toBe(false);
  });

  it('옛 대기 표시는 내 대기 표시로 옮긴다', async () => {
    setLegacy([e('o1', 1)]);
    fileMem.set('fund-backup-pending.json', '1');
    await importLegacyFunds();
    expect(fileMem.has('fund-backup-pending.json')).toBe(false);
    expect(fileMem.has('fund-backup-pending-u7.json')).toBe(true);
  });

  it('내 키를 쓴 뒤 중단돼 옛 키가 남아도 다시 가져오면 같은 결과(멱등)', async () => {
    await saveFunds([e('m1', 1), e('o2', 2)]); // 앞선 시도에서 저장까지만 됨
    setLegacy([e('o2', 2)]);
    fileMem.set('fund-history-o2.json', hist(url(2), '2026-10-01', 1));
    expect(await importLegacyFunds()).toEqual({ added: 0, skipped: 0 });
    expect(await loadFunds()).toEqual([e('m1', 1), e('o2', 2)]);
    expect(fileMem.has('fund-history-o2.json')).toBe(true); // 내 목록이 쓰는 파일은 지우지 않는다
  });

  it('로그인 안 됨이면 아무것도 바꾸지 않고 던진다', async () => {
    mockAuth.user = null;
    setLegacy([e('o1', 1)]);
    await expect(importLegacyFunds()).rejects.toThrow();
    expect(secureMem.has('fund_list_v1')).toBe(true);
  });
});

describe('discardLegacyFunds', () => {
  it('옛 키·그 펀드의 캐시·기록·옛 백업 상태·옛 대기 표시를 지운다(내 데이터는 그대로)', async () => {
    await saveFunds([e('m1', 1)]);
    fileMem.set('fund-history-m1.json', hist(url(1), '2026-10-02', 2));
    setLegacy([e('o2', 2)]);
    fileMem.set('fund-cache-o2.json', '{}');
    fileMem.set('fund-history-o2.json', hist(url(2), '2026-10-01', 1));
    secureMem.set('fund_backup_state_v1', STATE);
    fileMem.set('fund-backup-pending.json', '1');
    await discardLegacyFunds();
    expect(secureMem.has('fund_list_v1')).toBe(false);
    expect(secureMem.has('fund_backup_state_v1')).toBe(false);
    expect([...fileMem.keys()]).toEqual(['fund-history-m1.json']);
    expect(await loadFunds()).toEqual([e('m1', 1)]);
  });

  it('내 목록에 있는 id 의 파일은 지우지 않는다(중단된 가져오기 뒤 버리기)', async () => {
    await saveFunds([e('o2', 2)]);
    setLegacy([e('o2', 2)]);
    fileMem.set('fund-history-o2.json', hist(url(2), '2026-10-01', 1));
    await discardLegacyFunds();
    expect(fileMem.has('fund-history-o2.json')).toBe(true);
    expect(secureMem.has('fund_list_v1')).toBe(false);
  });
});
