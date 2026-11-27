/**
 * 앱 업데이트 훅 — 흐름·상태는 controller.ts(React 밖, 테스트 대상). 여기서는 수명주기 연결과 구독만.
 * useAppUpdate 는 AppUpdateGate 한 곳에서만 쓴다(검사·리스너 시작). 다른 화면은 useAppUpdateBlocking 만 읽는다.
 */
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  currentMode,
  dismissOta,
  dismissStore,
  exitApp,
  isUpdateBlocking,
  openStore,
  restart,
  startAppUpdateLifecycle,
  useAppUpdateStore,
} from './controller';

export function useAppUpdate() {
  // 스토어 전체 구독 대신 — 모드는 문자열을 돌려주는 선택자로, 나머지는 반환에 쓰는 필드만 고른다(반환 모양은 그대로)
  const state = useAppUpdateStore(
    useShallow((s) => ({ check: s.check, restarting: s.restarting, notice: s.notice })),
  );
  const mode = useAppUpdateStore(currentMode);

  useEffect(() => startAppUpdateLifecycle(), []);

  return {
    mode,
    check: state.check,
    restarting: state.restarting,
    notice: state.notice,
    dismissStore,
    openStore,
    dismissOta,
    restart,
    exitApp,
  };
}

/** 차단 안내(점검·스토어 강제·OTA 필수) 중인가 — 구독만 하고 검사는 시작하지 않는다(푸시 안내 시트 등이 건너뛸 때) */
export function useAppUpdateBlocking(): boolean {
  return useAppUpdateStore(isUpdateBlocking);
}
