// iOS 첫 실행 정리(2026-10-23 계정별 저장 설계 '앱 삭제') — 표식 없음이면 키 삭제·표식 작성, 표식 있음·Android 면 아무것도 안 함
jest.mock('expo-secure-store', () => require('@/features/fund/__fixtures__/fake-storage').secureStoreMock);
jest.mock('expo-file-system', () => require('@/features/fund/__fixtures__/fake-storage').fileSystemMock);

import * as fs from 'fs';
import * as path from 'path';

import { fileMem, resetFakeStorage, secureMem, secureStoreMock } from '@/features/fund/__fixtures__/fake-storage';
import { resetFundOwnersMemoForTest } from '@/features/fund/keys';

import {
  ensureInstallCleanup,
  FIXED_SECURE_KEYS,
  INSTALL_MARKER_FILE,
  resetInstallCleanupForTest,
  runInstallCleanup,
} from './install-cleanup';

const log = jest.fn();

function seedLeftovers(): void {
  secureMem.set('auth_token', 't');
  secureMem.set('auth_user', '{"id":7}');
  secureMem.set('auth_refresh', 'r');
  secureMem.set('fund_list_v1', '[]');
  secureMem.set('fund_backup_state_v1', '{}');
  secureMem.set('push_device_v1', '{}');
  secureMem.set('game.chartPrefs.v1', '{}');
  secureMem.set('fund_owners_v1', '[7,8]');
  secureMem.set('fund_list_v1_u7', '[]');
  secureMem.set('fund_backup_state_v1_u7', '{}');
  secureMem.set('fund_list_v1_u8', '[]');
  secureMem.set('fund_backup_state_v1_u8', '{}');
}

beforeEach(() => {
  resetFakeStorage();
  resetFundOwnersMemoForTest();
  resetInstallCleanupForTest();
  log.mockClear();
});

describe('runInstallCleanup', () => {
  it('iOS + 표식 없음 → 고정 키·소유자별 키·소유자 목록을 모두 지우고 표식을 쓴다', async () => {
    seedLeftovers();
    secureMem.set('unrelated', 'x'); // 앱이 모르는 키는 건드리지 않는다(나열 불가 — 고정 목록만)
    expect(await runInstallCleanup({ platform: 'ios', log })).toBe('cleaned');
    expect([...secureMem.keys()]).toEqual(['unrelated']);
    expect(fileMem.get(INSTALL_MARKER_FILE)).toBe('done');
  });

  it('iOS + 표식 있음 → 아무것도 지우지 않는다', async () => {
    seedLeftovers();
    fileMem.set(INSTALL_MARKER_FILE, 'done');
    const before = new Map(secureMem);
    expect(await runInstallCleanup({ platform: 'ios', log })).toBe('already');
    expect(secureMem).toEqual(before);
  });

  it('Android → 아무것도 하지 않는다(업데이트 사용자 로그아웃 방지)', async () => {
    seedLeftovers();
    const before = new Map(secureMem);
    expect(await runInstallCleanup({ platform: 'android', log })).toBe('not-ios');
    expect(secureMem).toEqual(before);
    expect(fileMem.has(INSTALL_MARKER_FILE)).toBe(false);
  });

  it('표식을 쓸 수 없으면 지우지 않는다(매 실행 로그아웃 방지)', async () => {
    seedLeftovers();
    const before = new Map(secureMem);
    const marker = {
      read: async () => null,
      write: () => {
        throw new Error('disk full');
      },
    };
    expect(await runInstallCleanup({ platform: 'ios', marker, log })).toBe('marker-unwritable');
    expect(secureMem).toEqual(before);
    expect(log).toHaveBeenCalled();
  });

  it('키 삭제가 실패하면 표식이 pending 으로 남아 다음 실행에 다시 정리 — 소유자 목록 키는 남긴다', async () => {
    seedLeftovers();
    const deleteKey = async (k: string) => {
      if (k === 'fund_list_v1_u8') throw new Error('keychain');
      secureMem.delete(k);
    };
    expect(await runInstallCleanup({ platform: 'ios', deleteKey, log })).toBe('failed');
    expect(fileMem.get(INSTALL_MARKER_FILE)).toBe('pending');
    expect(secureMem.has('fund_owners_v1')).toBe(true);
    expect(secureMem.has('auth_token')).toBe(false);

    expect(await runInstallCleanup({ platform: 'ios', log })).toBe('cleaned'); // 다음 실행
    expect(secureMem.size).toBe(0);
    expect(fileMem.get(INSTALL_MARKER_FILE)).toBe('done');
  });

  it('완료 표식 쓰기만 실패해도 정리는 성공으로 본다', async () => {
    seedLeftovers();
    let n = 0;
    const marker = {
      read: async () => null,
      write: () => {
        if (++n === 2) throw new Error('io');
      },
    };
    expect(await runInstallCleanup({ platform: 'ios', marker, log })).toBe('cleaned');
    expect(secureMem.size).toBe(0);
  });
});

describe('ensureInstallCleanup', () => {
  it('실행당 한 번만 돌고 던지지 않는다', async () => {
    const spy = jest.spyOn(secureStoreMock, 'deleteItemAsync');
    const a = ensureInstallCleanup();
    expect(ensureInstallCleanup()).toBe(a);
    await expect(a).resolves.toBeUndefined();
    const calls = spy.mock.calls.length;
    await ensureInstallCleanup();
    expect(spy.mock.calls.length).toBe(calls);
    spy.mockRestore();
  });
});

describe('고정 키 목록이 소스의 SecureStore 키를 빠짐없이 담는다', () => {
  it('expo-secure-store 를 쓰는 파일(+chart-prefs)의 상수 키 문자열이 모두 FIXED_SECURE_KEYS 에 있다', () => {
    const root = path.join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__fixtures__') walk(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    const found = new Set<string>();
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (!src.includes('expo-secure-store') && !f.endsWith(path.join('game', 'lib', 'chart-prefs.ts'))) continue;
      for (const m of src.matchAll(/const\s+[A-Z_]*KEY\s*=\s*'([^']+)'/g)) found.add(m[1]);
    }
    found.delete('fund_owners_v1'); // 소유자 목록 키는 계정별 키를 지운 뒤 따로 지운다
    expect(found.size).toBeGreaterThanOrEqual(8);
    expect([...found].filter((k) => !FIXED_SECURE_KEYS.includes(k))).toEqual([]);
  });
});
