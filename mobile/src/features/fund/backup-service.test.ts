jest.mock('expo-secure-store', () => require('./__fixtures__/fake-storage').secureStoreMock);
jest.mock('expo-file-system', () => require('./__fixtures__/fake-storage').fileSystemMock);
const mockAuth: { user: { id: number } | null; hydrated: boolean } = { user: null, hydrated: true };
jest.mock('@/features/auth/store', () => ({ useAuthStore: { getState: () => mockAuth } }));
const mockGoogle = { email: 'me@gmail.com' as string | null, tokenCalls: 0 };
jest.mock('./google-auth', () => ({
  isBackupConfigured: () => true,
  accessToken: async () => {
    mockGoogle.tokenCalls++;
    return 'TOKEN';
  },
  currentGoogleEmail: () => mockGoogle.email,
}));
// Drive = 이름 → 본문 메모리. 토큰은 deps.getAccessToken 으로 받아 실제 흐름(이메일 확인)을 지나게 한다
const mockDrive = new Map<string, string>();
const mockDriveCalls: string[] = [];
jest.mock('./drive-backup', () => {
  const actual = jest.requireActual('./drive-backup');
  return {
    ...actual,
    findBackupId: async (deps: { getAccessToken: () => Promise<string> }, name: string) => {
      await deps.getAccessToken();
      mockDriveCalls.push(`find:${name}`);
      return mockDrive.has(name) ? `id-${name}` : null;
    },
    downloadBackup: async (deps: { getAccessToken: () => Promise<string> }, name: string) => {
      await deps.getAccessToken();
      mockDriveCalls.push(`get:${name}`);
      return mockDrive.get(name) ?? null;
    },
    uploadBackup: async (deps: { getAccessToken: () => Promise<string> }, json: string, name: string) => {
      await deps.getAccessToken();
      mockDriveCalls.push(`put:${name}`);
      mockDrive.set(name, json);
    },
  };
});

import { resetFakeStorage, secureMem } from './__fixtures__/fake-storage';
import { backupNow, hasRemoteBackup, maybeAutoBackup, restoreFromDrive } from './backup-service';
import { loadBackupState, saveBackupState } from './backup-state';
import { isDriveError } from './drive-backup';
import { loadFunds, saveFunds } from './fund-store';
import { isNoOwnerError } from './owner';

const url = (n: number) => `https://fund.ivyro.net/dataroom/om_data/f${n}.htm`;
const backupOf = (...ns: number[]) =>
  JSON.stringify({ v: 1, exportedAt: 1, funds: ns.map((n) => ({ name: `펀드${n}`, url: url(n) })), history: {} });
const NOW = new Date(2026, 9, 23, 12).getTime();

beforeEach(async () => {
  resetFakeStorage();
  mockDrive.clear();
  mockDriveCalls.length = 0;
  mockGoogle.email = 'me@gmail.com';
  mockGoogle.tokenCalls = 0;
  mockAuth.user = { id: 7 };
  mockAuth.hydrated = true;
  await saveBackupState({ connected: true, email: 'me@gmail.com' });
});

describe('계정별 백업 상태', () => {
  it('fund_backup_state_v1_u<id> 키, 다른 계정은 연결 안 됨', async () => {
    expect(JSON.parse(secureMem.get('fund_backup_state_v1_u7')!).email).toBe('me@gmail.com');
    mockAuth.user = { id: 8 };
    expect((await loadBackupState()).connected).toBe(false);
    mockAuth.user = null;
    expect((await loadBackupState()).connected).toBe(false);
    await expect(saveBackupState({ connected: true })).rejects.toThrow();
    expect(secureMem.has('fund_backup_state_v1')).toBe(false);
  });
});

describe('Drive 파일 이름', () => {
  it('업로드는 항상 내 파일(fund-backup-v1-u7.json)', async () => {
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    await backupNow(NOW);
    expect([...mockDrive.keys()]).toEqual(['fund-backup-v1-u7.json']);
    expect((await loadBackupState()).lastBackupAt).toBe(NOW);
  });

  it('내 파일이 없으면 옛 파일을 합치기 기준으로 쓰고(옛 파일은 그대로) 내 파일에 올린다', async () => {
    mockDrive.set('fund-backup-v1.json', backupOf(2));
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    await backupNow(NOW);
    const mine = JSON.parse(mockDrive.get('fund-backup-v1-u7.json')!);
    expect(mine.funds.map((f: { url: string }) => f.url)).toEqual([url(1), url(2)]);
    expect(mockDrive.get('fund-backup-v1.json')).toBe(backupOf(2));
  });

  it('복원 — 내 파일이 없을 때만 옛 파일', async () => {
    mockDrive.set('fund-backup-v1.json', backupOf(2));
    expect(await restoreFromDrive()).toMatchObject({ status: 'ok', addedFunds: 1 });
    expect((await loadFunds()).map((f) => f.url)).toEqual([url(2)]);

    mockDrive.set('fund-backup-v1-u7.json', backupOf(3));
    await restoreFromDrive();
    expect((await loadFunds()).map((f) => f.url)).toEqual([url(2), url(3)]);
    expect(mockDriveCalls.filter((c) => c.startsWith('get:')).slice(-1)).toEqual(['get:fund-backup-v1-u7.json']);
  });

  it('hasRemoteBackup — 옛 파일만 있어도 true', async () => {
    expect(await hasRemoteBackup()).toBe(false);
    mockDrive.set('fund-backup-v1.json', backupOf(2));
    expect(await hasRemoteBackup()).toBe(true);
  });
});

describe('Google 계정 확인', () => {
  it('지금 Google 계정이 이 계정이 연결한 것과 다르면 Drive 를 건드리지 않고 연결 안 됨', async () => {
    mockGoogle.email = 'other@gmail.com';
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    const e = await backupNow(NOW).catch((x: unknown) => x);
    expect(isDriveError(e, 'auth')).toBe(true);
    expect(mockDriveCalls).toEqual([]);
    expect(await loadBackupState()).toMatchObject({ connected: false, lastError: '다시 연결해 주세요' });
  });

  it('Google 로그인 이메일을 일시적으로 확인할 수 없으면(null) 이번 작업만 건너뛰고 연결은 유지', async () => {
    mockGoogle.email = null;
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    expect(isDriveError(await restoreFromDrive().catch((x: unknown) => x), 'unverified')).toBe(true);
    expect(isDriveError(await backupNow(NOW).catch((x: unknown) => x), 'unverified')).toBe(true);
    expect(mockDriveCalls).toEqual([]);
    expect(await loadBackupState()).toMatchObject({ connected: true, email: 'me@gmail.com' });
    expect((await loadBackupState()).lastError).not.toBe('다시 연결해 주세요');
  });

  it('이메일 대소문자 차이는 같은 계정', async () => {
    mockGoogle.email = 'Me@Gmail.com';
    expect(await hasRemoteBackup()).toBe(false);
  });

  it('다른 앱 계정(B)의 상태는 A 의 오류로 바뀌지 않는다', async () => {
    mockAuth.user = { id: 8 };
    await saveBackupState({ connected: true, email: 'b@gmail.com' });
    mockAuth.user = { id: 7 };
    mockGoogle.email = 'b@gmail.com';
    await backupNow(NOW).catch(() => {});
    mockAuth.user = { id: 8 };
    expect(await loadBackupState()).toMatchObject({ connected: true, email: 'b@gmail.com' });
  });
});

describe('로그인 안 됨', () => {
  it('자동 백업은 아무것도 안 하고, 수동 백업·복원은 소유자 없음으로 거절', async () => {
    mockAuth.user = null;
    await maybeAutoBackup(NOW);
    expect(mockGoogle.tokenCalls).toBe(0);
    expect(isNoOwnerError(await backupNow(NOW).catch((x: unknown) => x))).toBe(true);
    expect(isNoOwnerError(await restoreFromDrive().catch((x: unknown) => x))).toBe(true);
  });

  it('작업 도중 계정이 바뀌어도 시작한 계정으로 끝낸다', async () => {
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    const p = backupNow(NOW);
    mockAuth.user = { id: 8 };
    await p;
    expect([...mockDrive.keys()]).toEqual(['fund-backup-v1-u7.json']);
    mockAuth.user = { id: 7 };
    expect((await loadBackupState()).lastBackupAt).toBe(NOW);
  });
});

describe('자동 백업', () => {
  it('연결된 계정은 하루 한 번 백업', async () => {
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    await maybeAutoBackup(NOW);
    expect(mockDrive.has('fund-backup-v1-u7.json')).toBe(true);
  });
});
