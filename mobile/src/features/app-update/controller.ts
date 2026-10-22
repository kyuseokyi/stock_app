/**
 * 앱 업데이트 제어 흐름(docs/app_update_management_spec.md 2장) — React 밖 상태·수명주기(훅은 use-app-update.ts).
 *  기동 1회: 버전 확인(서버 정책) → 점검·스토어 강제가 아니면 OTA 확인·다운로드 → decideMode 로 모달 결정.
 *  포그라운드 복귀 재검사: 마지막 검사 후 1시간(차단 모드 — 점검·스토어 강제·OTA 필수 — 중엔 10초)이 지났으면.
 *    10초는 "복귀했을 때 다시 볼지"의 임계값이지 주기 폴링이 아니다.
 *  점검 모드 주기 재검사: 점검 안내가 떠 있고 앱이 active 인 동안만 30초마다(setInterval) — 관리자가 끄면 기다리던
 *    화면에서 바로 풀린다. 점검이 풀리거나·백그라운드로 가거나·언마운트되면 정리한다.
 *  모든 실패는 조용히 — 렌더를 막지 않고, 실패하면 모달 없이 평소대로 쓴다.
 * 상태는 작은 zustand 스토어(앱 전체 1개) — 비동기 검사 결과를 effect 밖에서 반영한다.
 */
import { AppState, BackHandler, Linking, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

import { showToast } from '@/ui/app-toast';

import { fetchVersionCheck } from './api';
import { currentAppVersion, currentPackageId, currentPlatform } from './app-info';
import {
  decideMode,
  defaultStoreUrl,
  isBlockingMode,
  MAINTENANCE_POLL_MS,
  resolveStoreUrl,
  shouldPollMaintenance,
  shouldRecheck,
  shouldRunOta,
  type UpdateMode,
} from './decide';
import { checkAndFetchOta, reloadApp } from './ota';
import type { VersionCheck } from './parse';
import { hideStoreForADay, readStoreHiddenUntil } from './storage';

/** 재시작이 이 횟수만큼 연달아 실패하면 OTA 안내를 내린다(필수여도 — 다음 실행 때 적용) */
export const RELOAD_GIVE_UP_AFTER = 2;
export const RELOAD_RETRY_MESSAGE = '다시 시작하지 못했어요. 다시 시도해 주세요.';
export const RELOAD_GAVE_UP_MESSAGE = '지금은 다시 시작할 수 없어요. 다음에 앱을 열 때 적용돼요.';
export const IOS_STORE_HINT = 'App Store 에서 StockApp 을 검색해 업데이트해 주세요.';

export type AppUpdateState = {
  check: VersionCheck | null;
  otaReady: boolean;
  storeHiddenUntil: number | null;
  storeDismissed: boolean;
  otaDismissed: boolean;
  checkedAt: number;
  /** 재시작 진행 중 — 버튼 loading(중복 탭 방지) */
  restarting: boolean;
  /** 연속 재시작 실패 횟수 */
  reloadFailures: number;
  /** 재시작을 포기함 — 이번 실행 동안 OTA 안내를 다시 올리지 않는다(같은 번들로 같은 차단에 또 갇히지 않게) */
  reloadGaveUp: boolean;
  /** 시트 안 한 줄 안내(토스트는 RN Modal 뒤에 그려져 시트가 떠 있으면 안 보이므로 같이 둔다) */
  notice: string | null;
};

const INITIAL: AppUpdateState = {
  check: null,
  otaReady: false,
  storeHiddenUntil: null,
  storeDismissed: false,
  otaDismissed: false,
  checkedAt: 0,
  restarting: false,
  reloadFailures: 0,
  reloadGaveUp: false,
  notice: null,
};

export const useAppUpdateStore = create<AppUpdateState>(() => ({ ...INITIAL }));

let running = false;
let lastRunAt = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let appActive = true;

export const currentMode = (s: AppUpdateState = useAppUpdateStore.getState()): UpdateMode | null =>
  decideMode({
    check: s.check,
    otaReady: s.otaReady,
    storeHiddenUntil: s.storeHiddenUntil,
    storeDismissed: s.storeDismissed,
    otaDismissed: s.otaDismissed,
    now: s.checkedAt,
  });

/** 차단 안내(점검·스토어 강제·OTA 필수)가 떠 있는가 — 다른 시트(푸시 안내 등)는 이때 띄우지 않는다 */
export const isUpdateBlocking = (s: AppUpdateState = useAppUpdateStore.getState()): boolean =>
  isBlockingMode(currentMode(s));

export async function runCheck(): Promise<void> {
  const platform = currentPlatform();
  if (!platform || running) return;
  running = true;
  lastRunAt = Date.now();
  try {
    const result = await fetchVersionCheck(platform, currentAppVersion());
    if (result) {
      // 재검사 실패(null)는 직전 결과 유지 — 순간 끊김으로 점검 안내가 사라지지 않게
      const storeHiddenUntil = await readStoreHiddenUntil(platform, result.store.latestVersion);
      useAppUpdateStore.setState({ check: result, storeHiddenUntil });
    }
    useAppUpdateStore.setState({ checkedAt: Date.now() });
    // OTA 진행 판단: 재검사 실패면 직전 결과(점검·강제 중이면 OTA 안 함). 기동 최초 실패만 null → SILENT 진행.
    const effective = result ?? useAppUpdateStore.getState().check;
    const s = useAppUpdateStore.getState();
    if (shouldRunOta(effective) && !s.otaReady && !s.reloadGaveUp && (await checkAndFetchOta())) {
      if (!useAppUpdateStore.getState().reloadGaveUp) useAppUpdateStore.setState({ otaReady: true });
    }
  } catch {
    // 무시 — 앱은 평소대로
  } finally {
    running = false;
    syncPolling();
  }
}

/** 점검 모드 + active + 수명주기 시작 상태일 때만 30초 interval — 아니면 정리 */
export function syncPolling(): void {
  const want = started && appActive && shouldPollMaintenance(currentMode());
  if (want && !pollTimer) {
    pollTimer = setInterval(() => void runCheck(), MAINTENANCE_POLL_MS);
  } else if (!want && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function isPolling(): boolean {
  return pollTimer !== null;
}

/**
 * 기동 검사·포그라운드 복귀 재검사·점검 폴링을 시작하고 정리 함수를 돌려준다(AppUpdateGate 가 한 번 부른다).
 * 이미 시작돼 있으면 아무것도 하지 않는 정리 함수 — 중복 검사·리스너가 생기지 않게.
 */
export function startAppUpdateLifecycle(): () => void {
  if (started) return () => {};
  started = true;
  appActive = AppState.currentState == null || AppState.currentState === 'active';
  void runCheck();
  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    appActive = next === 'active';
    if (appActive && shouldRecheck(currentMode(), lastRunAt, Date.now())) void runCheck();
    syncPolling();
  });
  // 모드가 바뀌면(점검 해제·OTA 포기 등) 폴링 여부를 다시 맞춘다
  const unsubscribe = useAppUpdateStore.subscribe(() => syncPolling());
  return () => {
    started = false;
    sub.remove();
    unsubscribe();
    syncPolling();
  };
}

export async function dismissStore(): Promise<void> {
  useAppUpdateStore.setState({ storeDismissed: true });
  const platform = currentPlatform();
  if (!platform) return;
  const latest = useAppUpdateStore.getState().check?.store.latestVersion ?? null;
  useAppUpdateStore.setState({ storeHiddenUntil: await hideStoreForADay(platform, latest, Date.now()) });
}

/**
 * 스토어 열기 — 서버 주소(https 만, parse 에서 걸러짐)가 없거나 열기에 실패하면 플랫폼 기본 스토어로 다시 시도.
 * iOS 는 기본 주소가 없어 안내 문구만 보여준다(강제 업데이트 버튼이 아무 반응 없이 먹통이 되지 않게).
 */
export async function openStore(): Promise<void> {
  // 권장 안내는 스토어로 보낸 뒤 이번 실행 동안 닫는다(강제는 그대로 — 업데이트 전엔 계속 막는다)
  if (currentMode() === 'STORE_RECOMMENDED') useAppUpdateStore.setState({ storeDismissed: true });
  const platform = currentPlatform();
  const packageId = currentPackageId();
  const primary = resolveStoreUrl(useAppUpdateStore.getState().check?.store.storeUrl ?? null, platform, packageId);
  const fallback = defaultStoreUrl(platform, packageId);
  for (const url of primary === fallback ? [primary] : [primary, fallback]) {
    if (!url) continue;
    try {
      await Linking.openURL(url);
      useAppUpdateStore.setState({ notice: null });
      return;
    } catch {
      // 다음 후보로
    }
  }
  const hint = platform === 'ios' ? IOS_STORE_HINT : '스토어를 열지 못했어요. Play 스토어에서 StockApp 을 검색해 주세요.';
  useAppUpdateStore.setState({ notice: hint });
  showToast(hint);
}

export const dismissOta = () => useAppUpdateStore.setState({ otaDismissed: true });

/**
 * OTA 재시작. 누르는 동안 restarting(버튼 loading·중복 탭 무시).
 * 실패하면 "다시 시도해 주세요" 안내, 연달아 RELOAD_GIVE_UP_AFTER 번 실패하면 OTA 안내를 내린다(필수여도 탈출구 —
 * 내려받은 번들은 다음 실행 때 적용된다).
 */
export async function restart(): Promise<void> {
  if (useAppUpdateStore.getState().restarting) return;
  useAppUpdateStore.setState({ restarting: true });
  let ok = false;
  try {
    ok = await reloadApp();
  } catch {
    ok = false;
  }
  if (ok) {
    useAppUpdateStore.setState({ restarting: false, reloadFailures: 0, notice: null });
    return;
  }
  const failures = useAppUpdateStore.getState().reloadFailures + 1;
  if (failures >= RELOAD_GIVE_UP_AFTER) {
    useAppUpdateStore.setState({
      restarting: false,
      reloadFailures: failures,
      reloadGaveUp: true,
      otaReady: false,
      notice: null,
    });
    showToast(RELOAD_GAVE_UP_MESSAGE);
    return;
  }
  useAppUpdateStore.setState({ restarting: false, reloadFailures: failures, notice: RELOAD_RETRY_MESSAGE });
  showToast(RELOAD_RETRY_MESSAGE);
}

export function exitApp() {
  try {
    BackHandler.exitApp();
  } catch {
    // 무시
  }
}

/** 테스트 전용 — 모듈 상태 초기화 */
export function __resetForTest(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  running = false;
  lastRunAt = 0;
  started = false;
  appActive = true;
  useAppUpdateStore.setState({ ...INITIAL });
}
