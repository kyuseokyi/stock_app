jest.mock('expo-secure-store', () => require('./__fixtures__/fake-storage').secureStoreMock);
jest.mock('expo-file-system', () => require('./__fixtures__/fake-storage').fileSystemMock);
const mockAuth: { user: { id: number } | null; hydrated: boolean } = { user: null, hydrated: true };
jest.mock('@/features/auth/store', () => ({ useAuthStore: { getState: () => mockAuth } }));

import { resetFakeStorage, secureMem } from './__fixtures__/fake-storage';
import { loadFunds, saveFunds } from './fund-store';
import { currentOwnerId, isNoOwnerError } from './owner';

const URL_A = 'https://fund.ivyro.net/dataroom/om_data/a.htm';
const URL_B = 'https://fund.ivyro.net/dataroom/om_data/b.htm';
const fa = { id: 'a1', name: 'A', url: URL_A };
const fb = { id: 'b1', name: 'B', url: URL_B };

beforeEach(() => {
  resetFakeStorage();
  mockAuth.user = { id: 7 };
  mockAuth.hydrated = true;
});

describe('현재 소유자', () => {
  it('로그인 + hydrate 완료면 user.id', () => {
    expect(currentOwnerId()).toBe(7);
  });
  it('로그인 안 됨·hydrate 전이면 소유자 없음 오류', () => {
    mockAuth.user = null;
    expect(() => currentOwnerId()).toThrow();
    try {
      currentOwnerId();
    } catch (e) {
      expect(isNoOwnerError(e)).toBe(true);
    }
    mockAuth.user = { id: 7 };
    mockAuth.hydrated = false;
    expect(() => currentOwnerId()).toThrow();
    expect(isNoOwnerError(new Error('x'))).toBe(false);
  });
});

describe('계정별 펀드 목록', () => {
  it('fund_list_v1_u<id> 키에 저장하고 읽는다(옛 키는 건드리지 않음)', async () => {
    secureMem.set('fund_list_v1', JSON.stringify([fb]));
    await saveFunds([fa]);
    expect(JSON.parse(secureMem.get('fund_list_v1_u7')!)).toEqual([fa]);
    expect(await loadFunds()).toEqual([fa]);
    expect(JSON.parse(secureMem.get('fund_list_v1')!)).toEqual([fb]);
  });

  it('계정 A/B 전환 시 목록이 분리된다', async () => {
    await saveFunds([fa]);
    mockAuth.user = { id: 8 };
    expect(await loadFunds()).toEqual([]);
    await saveFunds([fb]);
    mockAuth.user = { id: 7 };
    expect(await loadFunds()).toEqual([fa]);
  });

  it('로그인 안 됨이면 읽기·쓰기 모두 던지고 아무 키도 쓰지 않는다', async () => {
    mockAuth.user = null;
    expect(isNoOwnerError(await loadFunds().catch((e: unknown) => e))).toBe(true);
    expect(isNoOwnerError(await saveFunds([fa]).catch((e: unknown) => e))).toBe(true);
    expect(secureMem.size).toBe(0);
  });

  it('hydrate 전이면 던진다', async () => {
    mockAuth.hydrated = false;
    await expect(loadFunds()).rejects.toThrow();
  });
});
