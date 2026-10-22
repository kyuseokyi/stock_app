jest.mock('expo-secure-store', () => require('./__fixtures__/fake-storage').secureStoreMock);
jest.mock('expo-file-system', () => require('./__fixtures__/fake-storage').fileSystemMock);
const mockAuth: { user: { id: number } | null; hydrated: boolean } = { user: null, hydrated: true };
jest.mock('@/features/auth/store', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('./google-auth', () => ({ disconnect: jest.fn(async () => {}) }));

import { fileMem, resetFakeStorage, secureMem } from './__fixtures__/fake-storage';
import { purgeFundAccount } from './account-purge';
import { saveFunds } from './fund-store';

const url = (n: number) => `https://fund.ivyro.net/dataroom/om_data/f${n}.htm`;

beforeEach(() => {
  resetFakeStorage();
  mockAuth.user = { id: 7 };
});

describe('purgeFundAccount(회원 탈퇴 성공 후)', () => {
  it('그 계정의 목록·캐시·기록·백업 상태·대기 파일을 지우고 Google 로그아웃 — 다른 계정은 그대로', async () => {
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    secureMem.set('fund_backup_state_v1_u7', JSON.stringify({ connected: true, email: 'a@gmail.com' }));
    fileMem.set('fund-cache-a.json', '{}');
    fileMem.set('fund-history-a.json', '{}');
    fileMem.set('fund-backup-pending-u7.json', '1');
    mockAuth.user = { id: 8 };
    await saveFunds([{ id: 'b', name: 'B', url: url(2) }]);
    secureMem.set('fund_backup_state_v1_u8', '{}');
    fileMem.set('fund-history-b.json', '{}');
    mockAuth.user = null; // 탈퇴 직후 = 이미 로그아웃

    const disconnect = jest.fn(async () => {});
    await purgeFundAccount(7, { disconnect });

    expect([...secureMem.keys()].sort()).toEqual(['fund_backup_state_v1_u8', 'fund_list_v1_u8', 'fund_owners_v1']);
    expect(JSON.parse(secureMem.get('fund_owners_v1')!)).toEqual([8]); // 탈퇴 계정은 소유자 목록에서 빠진다
    expect([...fileMem.keys()]).toEqual(['fund-history-b.json']);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('Google 을 연결한 적 없는 계정이면 Google 로그아웃하지 않는다(다른 계정의 Drive 연결 보존)', async () => {
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    const disconnect = jest.fn(async () => {});
    await purgeFundAccount(7, { disconnect });
    expect(disconnect).not.toHaveBeenCalled();
    expect(secureMem.size).toBe(0);
  });

  it('Google 로그아웃이 실패해도 로컬 정리는 끝낸다', async () => {
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    secureMem.set('fund_backup_state_v1_u7', JSON.stringify({ connected: false, email: 'a@gmail.com' }));
    await purgeFundAccount(7, {
      disconnect: async () => {
        throw new Error('x');
      },
    });
    expect(secureMem.size).toBe(0);
  });
});
