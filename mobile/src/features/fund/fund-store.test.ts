jest.mock('expo-secure-store', () => require('./__fixtures__/fake-storage').secureStoreMock);
jest.mock('expo-file-system', () => require('./__fixtures__/fake-storage').fileSystemMock);
const mockAuth: { user: { id: number } | null; hydrated: boolean } = { user: null, hydrated: true };
jest.mock('@/features/auth/store', () => ({ useAuthStore: { getState: () => mockAuth } }));

import { resetFakeStorage, secureMem } from './__fixtures__/fake-storage';
import { resetBackupState, saveBackupState } from './backup-state';
import { isOwnerChangedError, loadFunds, renameFundAs, saveFunds, saveFundsAs } from './fund-store';
import { forgetFundOwner, loadFundOwners, parseOwners, rememberFundOwner, resetFundOwnersMemoForTest } from './keys';
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

describe('소유자 목록(fund_owners_v1) — iOS 재설치 정리가 계정별 키를 찾는 데 쓴다', () => {
  beforeEach(() => resetFundOwnersMemoForTest());

  it('계정별 목록·백업 상태를 처음 쓸 때 그 id 를 한 번만 추가한다', async () => {
    await saveFunds([fa]);
    await saveFunds([fa, fb]);
    mockAuth.user = { id: 8 };
    await saveBackupState({ connected: true, email: 'b@gmail.com' });
    await resetBackupState();
    expect(JSON.parse(secureMem.get('fund_owners_v1')!)).toEqual([7, 8]);
    expect(await loadFundOwners()).toEqual([7, 8]);
  });

  it('동시에 여러 계정이 추가돼도 서로 덮어쓰지 않는다', async () => {
    await Promise.all([rememberFundOwner(1), rememberFundOwner(2), rememberFundOwner(3)]);
    expect(await loadFundOwners()).toEqual([1, 2, 3]);
  });

  it('forgetFundOwner 로 빠지고, 다시 쓰면 다시 들어간다', async () => {
    await saveFunds([fa]);
    mockAuth.user = { id: 8 };
    await saveFunds([fb]);
    await forgetFundOwner(7);
    expect(await loadFundOwners()).toEqual([8]);
    mockAuth.user = { id: 7 };
    await saveFunds([fa]);
    expect(await loadFundOwners()).toEqual([8, 7]);
  });

  it('깨진 목록 값은 빈 목록으로 본다', () => {
    expect(parseOwners('oops')).toEqual([]);
    expect(parseOwners('{"a":1}')).toEqual([]);
    expect(parseOwners('[1,"x",1,2.5,3]')).toEqual([1, 3]);
  });
});

describe('목록을 읽은 계정(uid)으로만 저장 — 계정 전환 중 다른 계정 키로 새지 않게', () => {
  it('지금 소유자가 uid 면 그 계정 키에 저장', async () => {
    await saveFundsAs([fa], 7);
    expect(await loadFunds(7)).toEqual([fa]);
  });

  it('지금 소유자가 바뀌었으면(A→B) 저장하지 않고 던진다 — A 목록 기반 next 가 B 키에 쓰이지 않게', async () => {
    await saveFunds([fb], 8);
    mockAuth.user = { id: 8 };
    const e = await saveFundsAs([fa], 7).catch((x: unknown) => x);
    expect(isOwnerChangedError(e)).toBe(true);
    expect(secureMem.has('fund_list_v1_u7')).toBe(false);
    expect(await loadFunds(8)).toEqual([fb]);
  });

  it('로그아웃(소유자 없음)이어도 저장하지 않는다', async () => {
    mockAuth.user = null;
    await expect(saveFundsAs([fa], 7)).rejects.toThrow();
    expect(secureMem.size).toBe(0);
  });

  it('이름 변경은 같은 uid 로 읽고 쓴다', async () => {
    await saveFunds([{ ...fa, name: '' }, fb], 7);
    await renameFundAs(7, 'a1', '새이름');
    expect(await loadFunds(7)).toEqual([{ ...fa, name: '새이름' }, fb]);
  });

  it('이름 변경 중 계정이 바뀌면 다른 계정 키를 건드리지 않는다', async () => {
    await saveFunds([{ ...fa, name: '' }], 7);
    await saveFunds([fb], 8);
    mockAuth.user = { id: 8 };
    await expect(renameFundAs(7, 'a1', '새이름')).rejects.toThrow();
    expect(await loadFunds(8)).toEqual([fb]);
    expect(await loadFunds(7)).toEqual([{ ...fa, name: '' }]);
  });
});
