jest.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: jest.fn() } }));
jest.mock('@/features/auth/store', () => ({ useAuthStore: jest.fn() }));
jest.mock('./fund-store', () => ({ loadFunds: jest.fn(), deleteCache: jest.fn(), fileCache: {} }));
jest.mock('./record', () => ({ recordFetched: jest.fn() }));
jest.mock('./backup-service', () => ({ maybeAutoBackup: jest.fn() }));
jest.mock('./background/backup-pending', () => ({ markBackupPending: jest.fn(), takeBackupPending: jest.fn() }));
jest.mock('react', () => ({ useEffect: (fn: () => unknown) => void fn() }));

import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/store';

import { flushPendingBackup, fundRefresher, markAddedDuringRun, recordIfRegistered, useFundAutoRefresh } from './auto-refresh';
import { enterBackgroundRun, resetBackgroundRunForTest } from './background/background-mode';
import { markBackupPending, takeBackupPending } from './background/backup-pending';
import { maybeAutoBackup } from './backup-service';
import type { CacheEntry, FundEntry } from './core';
import { loadFunds } from './fund-store';

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

describe('markAddedDuringRun', () => {
  const backup = maybeAutoBackup as jest.Mock;
  beforeEach(() => backup.mockClear());

  it('자동 갱신 중이 아니면 바로 백업한다', () => {
    markAddedDuringRun();
    expect(backup).toHaveBeenCalledTimes(1);
  });

  it('자동 갱신 중이면 갱신이 끝난 뒤 1번 백업한다', async () => {
    let release: (l: FundEntry[]) => void = () => {};
    (loadFunds as jest.Mock).mockImplementationOnce(() => new Promise<FundEntry[]>((res) => (release = res)));
    const run = fundRefresher.run();
    markAddedDuringRun();
    markAddedDuringRun();
    expect(backup).not.toHaveBeenCalled();
    release([]);
    await run;
    expect(backup).toHaveBeenCalledTimes(1);
  });
});

describe('백그라운드 실행 중 백업 보류', () => {
  const backup = maybeAutoBackup as jest.Mock;
  const mark = markBackupPending as jest.Mock;
  beforeEach(() => {
    backup.mockClear();
    mark.mockClear();
    resetBackgroundRunForTest();
  });

  it('백그라운드면 백업 대신 보류 표시만 남긴다', async () => {
    let release: (l: FundEntry[]) => void = () => {};
    (loadFunds as jest.Mock).mockImplementationOnce(() => new Promise<FundEntry[]>((res) => (release = res)));
    const leave = enterBackgroundRun();
    const run = fundRefresher.run();
    markAddedDuringRun();
    release([]);
    await run;
    leave();
    expect(backup).not.toHaveBeenCalled();
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it('앞 화면이면 기존처럼 바로 백업', async () => {
    let release: (l: FundEntry[]) => void = () => {};
    (loadFunds as jest.Mock).mockImplementationOnce(() => new Promise<FundEntry[]>((res) => (release = res)));
    const run = fundRefresher.run();
    markAddedDuringRun();
    release([]);
    await run;
    expect(backup).toHaveBeenCalledTimes(1);
    expect(mark).not.toHaveBeenCalled();
  });
});

describe('flushPendingBackup', () => {
  it('보류 표시가 있으면 백업하고, 없으면 하지 않는다', () => {
    const d = { takeBackupPending: jest.fn(() => true), maybeAutoBackup: jest.fn(async () => {}) };
    flushPendingBackup(d);
    expect(d.maybeAutoBackup).toHaveBeenCalledTimes(1);
    const e = { takeBackupPending: jest.fn(() => false), maybeAutoBackup: jest.fn(async () => {}) };
    flushPendingBackup(e);
    expect(e.maybeAutoBackup).not.toHaveBeenCalled();
  });

  it('기본 의존성은 보류 파일 모듈을 쓴다', () => {
    (takeBackupPending as jest.Mock).mockReturnValueOnce(false);
    flushPendingBackup();
    expect(takeBackupPending).toHaveBeenCalled();
  });
});

describe('앱 복귀 시 보류 백업 (한도 후 JS 가 멈췄다 같은 프로세스가 앞으로 온 경우)', () => {
  const backup = maybeAutoBackup as jest.Mock;
  const mark = markBackupPending as jest.Mock;
  const take = takeBackupPending as jest.Mock;
  const addListener = AppState.addEventListener as jest.Mock;
  let onChange: (s: string) => void = () => {};

  beforeEach(() => {
    backup.mockClear();
    mark.mockClear();
    take.mockReset();
    resetBackgroundRunForTest();
    (useAuthStore as unknown as jest.Mock).mockImplementation((sel: (s: unknown) => unknown) => sel({ user: { id: 1 } }));
    addListener.mockImplementation((_e: string, cb: (s: string) => void) => {
      onChange = cb;
      return { remove: jest.fn() };
    });
  });

  it('표시가 아직 켜진 채 앞으로 와도, 진행 중 실행이 끝난 뒤 보류 백업이 실행된다', async () => {
    let release: (l: FundEntry[]) => void = () => {};
    (loadFunds as jest.Mock).mockImplementationOnce(() => new Promise<FundEntry[]>((res) => (release = res)));
    const leave = enterBackgroundRun(); // 백그라운드 실행이 한도로 멈춘 채 표시가 남아 있다
    const bgRun = fundRefresher.run();
    markAddedDuringRun(); // 이번 실행에서 새 기록이 생김
    // 보류 표시는 mark 가 불린 뒤에만 take 가 true
    let marked = false;
    mark.mockImplementation(() => void (marked = true));
    take.mockImplementation(() => {
      const had = marked;
      marked = false; // 실제 takeBackupPending 처럼 읽으면 지운다
      return had;
    });

    useFundAutoRefresh(); // 마운트: 진행 중 실행에 합류 → 끝난 뒤 flush
    onChange('background');
    onChange('active'); // 앱 복귀: 역시 같은 실행에 합류
    expect(backup).not.toHaveBeenCalled();

    release([]);
    await bgRun;
    await Promise.resolve();
    await Promise.resolve();
    leave();
    expect(mark).toHaveBeenCalledTimes(1);
    expect(backup).toHaveBeenCalledTimes(1);
    expect(marked).toBe(false);
  });

  it('active 복귀 때 이미 남은 보류 파일이 있으면 실행이 끝난 뒤 백업한다', async () => {
    (loadFunds as jest.Mock).mockResolvedValueOnce([]);
    take.mockReturnValueOnce(true);
    useFundAutoRefresh();
    await new Promise((r) => setImmediate(r));
    expect(backup).toHaveBeenCalledTimes(1);

    backup.mockClear();
    (loadFunds as jest.Mock).mockResolvedValueOnce([]);
    take.mockReturnValueOnce(true);
    onChange('background');
    onChange('active');
    await new Promise((r) => setImmediate(r));
    expect(backup).toHaveBeenCalledTimes(1);
  });
});
