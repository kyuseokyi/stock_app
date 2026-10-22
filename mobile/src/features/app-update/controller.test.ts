// 앱 업데이트 제어 흐름(controller.ts) — 네이티브·네트워크 모듈은 모두 모의.
// react-native 는 AppState(현재 상태·리스너 캡처)·BackHandler·Linking 만 준다(@/lib/api·expo-updates 를 끌어오지 않게 하위 모듈도 모의).
jest.mock('react-native', () => {
  const listeners: ((s: string) => void)[] = [];
  return {
    listeners,
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn((_: string, fn: (s: string) => void) => {
        listeners.push(fn);
        return {
          remove: () => {
            const i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
          },
        };
      }),
    },
    BackHandler: { exitApp: jest.fn() },
    Linking: { openURL: jest.fn() },
  };
});
jest.mock('@/ui/app-toast', () => ({ showToast: jest.fn() }));
jest.mock('./api', () => ({ fetchVersionCheck: jest.fn() }));
jest.mock('./ota', () => ({ checkAndFetchOta: jest.fn(), reloadApp: jest.fn() }));
jest.mock('./storage', () => ({ readStoreHiddenUntil: jest.fn(), hideStoreForADay: jest.fn() }));
jest.mock('./app-info', () => ({
  currentPlatform: jest.fn(() => 'android'),
  currentAppVersion: jest.fn(() => '1.0.0'),
  currentPackageId: jest.fn(() => 'com.stockapp'),
}));

import { showToast } from '@/ui/app-toast';

import { fetchVersionCheck } from './api';
import { currentPlatform } from './app-info';
import {
  __resetForTest,
  currentMode,
  isPolling,
  isUpdateBlocking,
  IOS_STORE_HINT,
  openStore,
  RELOAD_RETRY_MESSAGE,
  restart,
  runCheck,
  startAppUpdateLifecycle,
  useAppUpdateStore,
} from './controller';
import { MAINTENANCE_POLL_MS } from './decide';
import { checkAndFetchOta, reloadApp } from './ota';
import { parseVersionCheck } from './parse';
import { readStoreHiddenUntil } from './storage';

const rn = jest.requireMock('react-native') as {
  listeners: ((s: string) => void)[];
  AppState: { currentState: string };
  Linking: { openURL: jest.Mock };
};
const fetchMock = fetchVersionCheck as jest.Mock;
const otaMock = checkAndFetchOta as jest.Mock;
const reloadMock = reloadApp as jest.Mock;
const toastMock = showToast as jest.Mock;
const platformMock = currentPlatform as jest.Mock;

function vc(p: { maintenance?: boolean; store?: string; ota?: string; url?: string | null } = {}) {
  return parseVersionCheck({
    maintenance: { is_active: p.maintenance ?? false },
    store: { update_type: p.store ?? 'NONE', latest_version: '1.1.0', store_url: p.url ?? null },
    ota: { policy: p.ota ?? 'SILENT' },
  })!;
}

/** 마이크로태스크 비우기(가짜 타이머에서도 동작) */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let stop: (() => void) | null = null;

beforeEach(() => {
  jest.useRealTimers();
  __resetForTest();
  rn.listeners.length = 0;
  rn.AppState.currentState = 'active';
  rn.Linking.openURL.mockReset();
  fetchMock.mockReset();
  otaMock.mockReset().mockResolvedValue(false);
  reloadMock.mockReset();
  toastMock.mockReset();
  platformMock.mockReturnValue('android');
  (readStoreHiddenUntil as jest.Mock).mockResolvedValue(null);
});
afterEach(() => {
  stop?.();
  stop = null;
  __resetForTest();
  jest.useRealTimers();
});

describe('runCheck', () => {
  it('진행 중 연속 호출은 한 번만 실행(락)', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = runCheck();
    const b = runCheck();
    resolve(vc());
    await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 끝나면 락이 풀려 다시 실행된다
    fetchMock.mockResolvedValue(vc());
    await runCheck();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('재검사 실패(null)는 점검 상태를 유지하고 OTA 도 하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(vc({ maintenance: true }));
    await runCheck();
    expect(currentMode()).toBe('MAINTENANCE');
    fetchMock.mockResolvedValueOnce(null);
    await runCheck();
    expect(currentMode()).toBe('MAINTENANCE');
    expect(otaMock).not.toHaveBeenCalled(); // 직전 결과(점검)로 판단 — SILENT 로 진행하지 않음
  });

  it('기동 최초 실패(null)만 SILENT 로 OTA 진행', async () => {
    fetchMock.mockResolvedValueOnce(null);
    otaMock.mockResolvedValueOnce(true);
    await runCheck();
    expect(otaMock).toHaveBeenCalledTimes(1);
    expect(useAppUpdateStore.getState().otaReady).toBe(true);
    expect(currentMode()).toBeNull(); // SILENT — 모달 없음
  });

  it('웹 등 플랫폼이 없으면 아무것도 하지 않는다', async () => {
    platformMock.mockReturnValue(null);
    await runCheck();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('차단 모드 판정', () => {
  it('점검·스토어 강제·OTA 필수는 차단, 권장·선택은 아님', async () => {
    fetchMock.mockResolvedValueOnce(vc({ maintenance: true }));
    await runCheck();
    expect(isUpdateBlocking()).toBe(true);

    fetchMock.mockResolvedValueOnce(vc({ store: 'FORCE' }));
    await runCheck();
    expect(currentMode()).toBe('STORE_FORCE');
    expect(isUpdateBlocking()).toBe(true);

    fetchMock.mockResolvedValueOnce(vc({ ota: 'MANDATORY' }));
    otaMock.mockResolvedValueOnce(true);
    await runCheck();
    expect(currentMode()).toBe('OTA_MANDATORY');
    expect(isUpdateBlocking()).toBe(true);

    fetchMock.mockResolvedValueOnce(vc({ ota: 'OPTIONAL' }));
    await runCheck();
    expect(currentMode()).toBe('OTA_OPTIONAL');
    expect(isUpdateBlocking()).toBe(false);
  });
});

describe('점검 폴링(30초, active 일 때만)', () => {
  it('점검이면 시작 → 30초마다 재검사 → 해제되면 정리', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(vc({ maintenance: true }));
    stop = startAppUpdateLifecycle();
    await flush();
    expect(isPolling()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(MAINTENANCE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValue(vc()); // 관리자가 점검 해제
    await jest.advanceTimersByTimeAsync(MAINTENANCE_POLL_MS);
    expect(currentMode()).toBeNull();
    expect(isPolling()).toBe(false);
    await jest.advanceTimersByTimeAsync(MAINTENANCE_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('백그라운드로 가면 멈추고, 돌아오면 재검사 후 다시 시작', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(vc({ maintenance: true }));
    stop = startAppUpdateLifecycle();
    await flush();
    expect(isPolling()).toBe(true);

    rn.listeners.forEach((fn) => fn('background'));
    expect(isPolling()).toBe(false);
    await jest.advanceTimersByTimeAsync(MAINTENANCE_POLL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rn.listeners.forEach((fn) => fn('active')); // 10초 넘게 지남 → 포그라운드 복귀 재검사
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isPolling()).toBe(true);
  });

  it('언마운트(정리)하면 멈춘다', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(vc({ maintenance: true }));
    stop = startAppUpdateLifecycle();
    await flush();
    expect(isPolling()).toBe(true);
    stop();
    stop = null;
    expect(isPolling()).toBe(false);
    expect(rn.listeners).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(MAINTENANCE_POLL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('스토어 강제는 주기 폴링하지 않는다(포그라운드 복귀 재검사만)', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue(vc({ store: 'FORCE' }));
    stop = startAppUpdateLifecycle();
    await flush();
    expect(currentMode()).toBe('STORE_FORCE');
    expect(isPolling()).toBe(false);
  });

  it('두 번 시작해도 검사·리스너는 하나', async () => {
    fetchMock.mockResolvedValue(vc());
    stop = startAppUpdateLifecycle();
    const second = startAppUpdateLifecycle();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rn.listeners).toHaveLength(1);
    second();
    expect(rn.listeners).toHaveLength(1);
  });
});

describe('restart(OTA 재시작)', () => {
  async function readyMandatory() {
    fetchMock.mockResolvedValue(vc({ ota: 'MANDATORY' }));
    otaMock.mockResolvedValue(true);
    await runCheck();
    expect(currentMode()).toBe('OTA_MANDATORY');
  }

  it('누르는 동안 restarting, 중복 탭은 무시', async () => {
    await readyMandatory();
    let resolve!: (v: boolean) => void;
    reloadMock.mockReturnValue(new Promise<boolean>((r) => (resolve = r)));
    const a = restart();
    expect(useAppUpdateStore.getState().restarting).toBe(true);
    const b = restart();
    resolve(false);
    await Promise.all([a, b]);
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(useAppUpdateStore.getState().restarting).toBe(false);
  });

  it('1회 실패 → 다시 시도 안내, 모달 유지 / 2회 연속 실패 → 모달 내림(탈출구), 이번 실행 동안 다시 안 올림', async () => {
    await readyMandatory();
    reloadMock.mockResolvedValue(false);

    await restart();
    expect(toastMock).toHaveBeenCalledWith(RELOAD_RETRY_MESSAGE);
    expect(useAppUpdateStore.getState().notice).toBe(RELOAD_RETRY_MESSAGE);
    expect(currentMode()).toBe('OTA_MANDATORY');

    await restart();
    expect(useAppUpdateStore.getState().otaReady).toBe(false);
    expect(currentMode()).toBeNull();
    expect(isUpdateBlocking()).toBe(false);

    // 재검사로 같은 번들이 다시 준비돼도 차단에 또 갇히지 않는다
    await runCheck();
    expect(useAppUpdateStore.getState().otaReady).toBe(false);
  });
});

describe('openStore', () => {
  it('서버 주소가 없으면 패키지 기반 Play 주소로 연다', async () => {
    fetchMock.mockResolvedValue(vc({ store: 'FORCE', url: 'market://details?id=x' })); // parse 에서 버려짐
    await runCheck();
    rn.Linking.openURL.mockResolvedValue(undefined);
    await openStore();
    expect(rn.Linking.openURL).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=com.stockapp');
  });

  it('서버 주소 열기 실패면 기본 주소로 다시 시도', async () => {
    fetchMock.mockResolvedValue(vc({ store: 'FORCE', url: 'https://example.test/broken' }));
    await runCheck();
    rn.Linking.openURL.mockRejectedValueOnce(new Error('no handler')).mockResolvedValueOnce(undefined);
    await openStore();
    expect(rn.Linking.openURL).toHaveBeenLastCalledWith('https://play.google.com/store/apps/details?id=com.stockapp');
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('iOS 에 주소가 없으면 안내만', async () => {
    platformMock.mockReturnValue('ios');
    fetchMock.mockResolvedValue(vc({ store: 'FORCE' }));
    await runCheck();
    await openStore();
    expect(rn.Linking.openURL).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().notice).toBe(IOS_STORE_HINT);
  });
});
