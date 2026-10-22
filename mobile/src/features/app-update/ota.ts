/**
 * expo-updates 안전 호출 — 어떤 경우에도 던지지 않는다(실패하면 지금 번들 그대로 실행).
 * __DEV__(Metro 개발 서버)·Updates.isEnabled=false(Expo Go·웹·업데이트 비활성 빌드)면 아무것도 하지 않는다.
 * 두 값은 호출 시점에 읽는다(테스트에서 바꿀 수 있게).
 */
import * as Updates from 'expo-updates';

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
 */
export async function checkAndFetchOta(): Promise<boolean> {
  if (!isOtaSupported()) return false;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable && !check.isRollBackToEmbedded) return false;
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew || fetched.isRollBackToEmbedded;
  } catch {
    return false;
  }
}

/** 내려받은 번들로 재시작. 실패하면 조용히 넘어간다(다음 실행 때 적용) */
export async function reloadApp(): Promise<void> {
  if (!isOtaSupported()) return;
  try {
    await Updates.reloadAsync();
  } catch {
    // 무시 — 다음 실행 때 적용된다
  }
}
