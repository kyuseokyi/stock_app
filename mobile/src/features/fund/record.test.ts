jest.mock('./history-store', () => ({ recordSnapshot: jest.fn() }));
jest.mock('./backup-service', () => ({ maybeAutoBackup: jest.fn(async () => {}) }));

import { maybeAutoBackup } from './backup-service';
import type { CacheEntry, FundEntry } from './core';
import { recordSnapshot } from './history-store';
import { recordFetched, resetRecordedForTest } from './record';

const snap = recordSnapshot as jest.MockedFunction<typeof recordSnapshot>;
const backup = maybeAutoBackup as jest.MockedFunction<typeof maybeAutoBackup>;

const FUND: FundEntry = { id: 'f1', name: '', url: 'https://fund.ivyro.net/dataroom/om_data/x.htm' };
const entry = (fetchedAt: number): CacheEntry => ({
  v: 1,
  fetchedAt,
  hash: 'h',
  report: { title: '', investorNo: '', investorName: '', notice: null, sections: [] },
  missing: [],
});

beforeEach(() => {
  snap.mockReset();
  backup.mockClear();
  resetRecordedForTest();
});

it('같은 (펀드, fetchedAt) 은 한 번만 기록한다', async () => {
  snap.mockResolvedValue(false);
  await recordFetched(FUND, entry(100));
  await recordFetched(FUND, entry(100));
  expect(snap).toHaveBeenCalledTimes(1);
  expect(snap).toHaveBeenCalledWith(FUND, entry(100).report, 100);
  await recordFetched(FUND, entry(200));
  expect(snap).toHaveBeenCalledTimes(2);
});

it('새 날짜가 생겼을 때만 자동 백업을 시도한다', async () => {
  snap.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await recordFetched(FUND, entry(1));
  expect(backup).not.toHaveBeenCalled();
  await recordFetched(FUND, entry(2));
  expect(backup).toHaveBeenCalledTimes(1);
});
