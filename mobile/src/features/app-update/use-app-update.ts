/**
 * 앱 업데이트 제어 흐름(docs/app_update_management_spec.md 2장).
 *  기동 1회: 버전 확인(서버 정책) → 점검·스토어 강제가 아니면 OTA 확인·다운로드 → decideMode 로 모달 결정.
 *  포그라운드 복귀: 마지막 검사 후 1시간(점검·스토어 강제 중엔 10초) 지났으면 다시 검사.
 *  모든 실패는 조용히 — 렌더를 막지 않고, 실패하면 모달 없이 평소대로 쓴다.
 * 상태는 작은 zustand 스토어(앱 전체 1개) — 비동기 검사 결과를 effect 밖에서 반영한다.
 */
import { useEffect } from 'react';
import { AppState, BackHandler, Linking } from 'react-native';
import { create } from 'zustand';

import { fetchVersionCheck } from './api';
import { currentAppVersion, currentPlatform } from './app-info';
import { decideMode, shouldRecheck, shouldRunOta } from './decide';
import { checkAndFetchOta, reloadApp } from './ota';
import type { VersionCheck } from './parse';
import { hideStoreForADay, readStoreHiddenUntil } from './storage';

type State = {
  check: VersionCheck | null;
  otaReady: boolean;
  storeHiddenUntil: number | null;
  storeDismissed: boolean;
  otaDismissed: boolean;
  checkedAt: number;
};

const useAppUpdateStore = create<State>(() => ({
  check: null,
  otaReady: false,
  storeHiddenUntil: null,
  storeDismissed: false,
  otaDismissed: false,
  checkedAt: 0,
}));

let running = false;
let lastRunAt = 0;

const currentMode = (s: State = useAppUpdateStore.getState()) =>
  decideMode({
    check: s.check,
    otaReady: s.otaReady,
    storeHiddenUntil: s.storeHiddenUntil,
    storeDismissed: s.storeDismissed,
    otaDismissed: s.otaDismissed,
    now: s.checkedAt,
  });

async function runCheck(): Promise<void> {
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
    if (shouldRunOta(result) && !useAppUpdateStore.getState().otaReady && (await checkAndFetchOta())) {
      useAppUpdateStore.setState({ otaReady: true });
    }
  } catch {
    // 무시 — 앱은 평소대로
  } finally {
    running = false;
  }
}

async function dismissStore(): Promise<void> {
  useAppUpdateStore.setState({ storeDismissed: true });
  const platform = currentPlatform();
  if (!platform) return;
  const latest = useAppUpdateStore.getState().check?.store.latestVersion ?? null;
  useAppUpdateStore.setState({ storeHiddenUntil: await hideStoreForADay(platform, latest, Date.now()) });
}

async function openStore(): Promise<void> {
  const url = useAppUpdateStore.getState().check?.store.storeUrl;
  // 권장 안내는 스토어로 보낸 뒤 이번 실행 동안 닫는다(강제는 그대로 — 업데이트 전엔 계속 막는다)
  if (currentMode() === 'STORE_RECOMMENDED') useAppUpdateStore.setState({ storeDismissed: true });
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch {
    // 무시
  }
}

const dismissOta = () => useAppUpdateStore.setState({ otaDismissed: true });

function exitApp() {
  try {
    BackHandler.exitApp();
  } catch {
    // 무시
  }
}

export function useAppUpdate() {
  const state = useAppUpdateStore();
  const mode = currentMode(state);

  useEffect(() => {
    void runCheck();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && shouldRecheck(currentMode(), lastRunAt, Date.now())) void runCheck();
    });
    return () => sub.remove();
  }, []);

  return { mode, check: state.check, dismissStore, openStore, dismissOta, restart: reloadApp, exitApp };
}
