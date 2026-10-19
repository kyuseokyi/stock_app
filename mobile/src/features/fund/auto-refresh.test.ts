jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn() } }));
jest.mock('@/features/auth/store', () => ({ useAuthStore: jest.fn() }));
jest.mock('./fund-store', () => ({ loadFunds: jest.fn(), deleteCache: jest.fn(), fileCache: {} }));
jest.mock('./record', () => ({ recordFetched: jest.fn() }));
jest.mock('./backup-service', () => ({ maybeAutoBackup: jest.fn() }));

import { recordIfRegistered } from './auto-refresh';
import type { CacheEntry, FundEntry } from './core';

const FUND: FundEntry = { id: 'f1', name: '', url: 'https://fund.example.com/dataroom/om_data/x.htm' };
const ENTRY = { v: 1, fetchedAt: 1 } as unknown as CacheEntry;

const mk = (loaded: () => Promise<FundEntry[]>) => ({
  loadFunds: jest.fn(loaded),
  deleteCache: jest.fn(),
  recordFetched: jest.fn(async () => true),
});

it('등록돼 있으면 backup:false 로 기록하고 결과를 돌려준다', async () => {
  const d = mk(async () => [FUND]);
  await expect(recordIfRegistered(FUND, ENTRY, d)).resolves.toBe(true);
  expect(d.recordFetched).toHaveBeenCalledWith(FUND, ENTRY, { backup: false });
});

it('갱신 중 삭제된 펀드는 캐시를 지우고 기록하지 않는다', async () => {
  const d = mk(async () => []);
  await expect(recordIfRegistered(FUND, ENTRY, d)).resolves.toBe(false);
  expect(d.deleteCache).toHaveBeenCalledWith('f1');
  expect(d.recordFetched).not.toHaveBeenCalled();
});

it('목록을 못 읽으면 판단할 수 없으니 기록한다', async () => {
  const d = mk(async () => {
    throw new Error('x');
  });
  await expect(recordIfRegistered(FUND, ENTRY, d)).resolves.toBe(true);
  expect(d.recordFetched).toHaveBeenCalled();
  expect(d.deleteCache).not.toHaveBeenCalled();
});
