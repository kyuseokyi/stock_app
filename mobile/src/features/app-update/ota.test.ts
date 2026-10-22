// expo-updates 는 네이티브 모듈 — 가변 isEnabled 를 가진 mock 으로 대체.
// import 가 jest.mock 바로 뒤로 끌어올려져 바깥 const 는 아직 초기화 전이라, 객체는 팩토리 안에서 만들고 requireMock 으로 꺼낸다.
// `import * as` 는 값을 복사하므로 isEnabled 는 getter 로(바꾼 값이 ota.ts 에 보이게).
jest.mock('expo-updates', () => {
  const state = { enabled: true };
  return {
    state,
    get isEnabled() {
      return state.enabled;
    },
    checkForUpdateAsync: jest.fn(),
    fetchUpdateAsync: jest.fn(),
    reloadAsync: jest.fn(),
  };
});

import { checkAndFetchOta, isOtaSupported, OTA_TIMEOUT_MS, reloadApp, withTimeout } from './ota';

const mockUpdates = jest.requireMock('expo-updates') as {
  state: { enabled: boolean };
  checkForUpdateAsync: jest.Mock;
  fetchUpdateAsync: jest.Mock;
  reloadAsync: jest.Mock;
};

const g = globalThis as unknown as { __DEV__: boolean };
const originalDev = g.__DEV__;

beforeEach(() => {
  g.__DEV__ = false;
  mockUpdates.state.enabled = true;
  mockUpdates.checkForUpdateAsync.mockReset();
  mockUpdates.fetchUpdateAsync.mockReset();
  mockUpdates.reloadAsync.mockReset();
});
afterAll(() => {
  g.__DEV__ = originalDev;
});

describe('isOtaSupported', () => {
  it('운영 번들 + 업데이트 활성일 때만 true', () => {
    expect(isOtaSupported()).toBe(true);
  });
  it('개발 모드(__DEV__)면 false', () => {
    g.__DEV__ = true;
    expect(isOtaSupported()).toBe(false);
  });
  it('Updates.isEnabled=false 면 false', () => {
    mockUpdates.state.enabled = false;
    expect(isOtaSupported()).toBe(false);
  });
});

describe('checkAndFetchOta', () => {
  it('개발 모드면 네이티브를 부르지 않고 false', async () => {
    g.__DEV__ = true;
    await expect(checkAndFetchOta()).resolves.toBe(false);
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('비활성 빌드면 건너뜀', async () => {
    mockUpdates.state.enabled = false;
    await expect(checkAndFetchOta()).resolves.toBe(false);
    expect(mockUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('새 번들 없음 → 내려받지 않고 false', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false, isRollBackToEmbedded: false });
    await expect(checkAndFetchOta()).resolves.toBe(false);
    expect(mockUpdates.fetchUpdateAsync).not.toHaveBeenCalled();
  });

  it('새 번들 있음 → 내려받고 true', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true, isRollBackToEmbedded: false });
    mockUpdates.fetchUpdateAsync.mockResolvedValue({ isNew: true, isRollBackToEmbedded: false });
    await expect(checkAndFetchOta()).resolves.toBe(true);
  });

  it('내장 번들 롤백도 준비됨', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: false, isRollBackToEmbedded: true });
    mockUpdates.fetchUpdateAsync.mockResolvedValue({ isNew: false, isRollBackToEmbedded: true });
    await expect(checkAndFetchOta()).resolves.toBe(true);
  });

  it('내려받기 결과가 새것이 아니면 false', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true, isRollBackToEmbedded: false });
    mockUpdates.fetchUpdateAsync.mockResolvedValue({ isNew: false, isRollBackToEmbedded: false });
    await expect(checkAndFetchOta()).resolves.toBe(false);
  });

  it('확인 실패(네트워크 등)는 삼키고 false', async () => {
    mockUpdates.checkForUpdateAsync.mockRejectedValue(new Error('network'));
    await expect(checkAndFetchOta()).resolves.toBe(false);
  });

  it('확인이 끝나지 않으면 60초 상한 후 false(검사 락 고착 방지)', async () => {
    jest.useFakeTimers();
    try {
      mockUpdates.checkForUpdateAsync.mockReturnValue(new Promise(() => {}));
      const p = checkAndFetchOta();
      await jest.advanceTimersByTimeAsync(OTA_TIMEOUT_MS);
      await expect(p).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('내려받기가 끝나지 않아도 상한 후 false', async () => {
    jest.useFakeTimers();
    try {
      mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true, isRollBackToEmbedded: false });
      mockUpdates.fetchUpdateAsync.mockReturnValue(new Promise(() => {}));
      const p = checkAndFetchOta();
      await jest.advanceTimersByTimeAsync(OTA_TIMEOUT_MS);
      await expect(p).resolves.toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('내려받기 실패도 삼키고 false', async () => {
    mockUpdates.checkForUpdateAsync.mockResolvedValue({ isAvailable: true, isRollBackToEmbedded: false });
    mockUpdates.fetchUpdateAsync.mockRejectedValue(new Error('disk'));
    await expect(checkAndFetchOta()).resolves.toBe(false);
  });
});

describe('reloadApp', () => {
  it('재시작 호출 → true', async () => {
    mockUpdates.reloadAsync.mockResolvedValue(undefined);
    await expect(reloadApp()).resolves.toBe(true);
    expect(mockUpdates.reloadAsync).toHaveBeenCalledTimes(1);
  });
  it('재시작 실패는 삼키고 false', async () => {
    mockUpdates.reloadAsync.mockRejectedValue(new Error('no runtime'));
    await expect(reloadApp()).resolves.toBe(false);
  });
  it('개발 모드면 부르지 않고 false', async () => {
    g.__DEV__ = true;
    await expect(reloadApp()).resolves.toBe(false);
    expect(mockUpdates.reloadAsync).not.toHaveBeenCalled();
  });
});

describe('withTimeout', () => {
  it('제때 끝나면 값 그대로', async () => {
    await expect(withTimeout(Promise.resolve(3), 1000)).resolves.toBe(3);
  });
  it('원래 오류는 그대로 전달', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 1000)).rejects.toThrow('x');
  });
});
