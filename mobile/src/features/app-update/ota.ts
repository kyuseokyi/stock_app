/**
 * expo-updates 안전 호출 — 어떤 경우에도 던지지 않는다(실패하면 지금 번들 그대로 실행).
 * __DEV__(Metro 개발 서버)·Updates.isEnabled=false(Expo Go·웹·업데이트 비활성 빌드)면 아무것도 하지 않는다.
 * 두 값은 호출 시점에 읽는다(테스트에서 바꿀 수 있게).
 */
import * as Updates from 'expo-updates';

/**
 * check·fetch 상한 — 네이티브 호출이 끝나지 않으면(망 정지·서버 무응답) 검사 락(use-app-update 의 running)이
 * 영구히 걸려 이후 재검사·점검 해제가 막힌다. 상한을 넘기면 실패로 보고 다음 검사 때 다시 시도한다.
 */
export const OTA_TIMEOUT_MS = 60 * 1000;

/** promise 가 ms 안에 끝나지 않으면 reject. 끝나면 타이머를 정리한다(가짜 타이머·열린 핸들 방지) */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function isOtaSupported(): boolean {
  try {
    return !__DEV__ && Updates.isEnabled === true;
  } catch {
    return false;
  }
}

/**
 * 새 번들 확인 → 있으면 내려받기. 재시작하면 적용될 번들이 준비됐으면 true.
 * 내장 번들로의 롤백(isRollBackToEmbedded)도 재시작 시 적용되므로 준비됨으로 본다.
 * 각 단계는 OTA_TIMEOUT_MS 상한 — 넘기면 false.
 */
export async function checkAndFetchOta(): Promise<boolean> {
  if (!isOtaSupported()) return false;
  try {
    const check = await withTimeout(Updates.checkForUpdateAsync(), OTA_TIMEOUT_MS);
    if (!check.isAvailable && !check.isRollBackToEmbedded) return false;
    const fetched = await withTimeout(Updates.fetchUpdateAsync(), OTA_TIMEOUT_MS);
    return fetched.isNew || fetched.isRollBackToEmbedded;
  } catch {
    return false;
  }
}

/**
 * 내려받은 번들로 재시작. 성공하면 앱이 다시 떠서 돌아오지 않는다(돌아오면 true).
 * 실패(네이티브 오류)·미지원(개발 모드·비활성)이면 false — 호출부가 다시 시도 안내·탈출구를 정한다.
 */
export async function reloadApp(): Promise<boolean> {
  if (!isOtaSupported()) return false;
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}
