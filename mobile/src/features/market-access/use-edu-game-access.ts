import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';
import { getEduState, isEduConfigured } from '@/features/edu-game/api';

import { eduEnabledOf } from './access';

type Viewer = number | null;

// 교육용 합성 종가 게임 노출 판단값 — GET /api/game/edu/state 의 enabled(비로그인 가능, 실시간 시즌 응답과 별개).
// use-game-access 와 같은 방식: 사용자별 모듈 캐시, 포커스·로그인 사용자 변경 때 다시 묻기, 실패·게임 서버 미설정은 false(숨김).
// 종가 게임 화면이 상태를 새로 받으면 noteEduEnabled 로 캐시를 맞춰 탭 노출도 바로 따라간다(관리자가 끈 직후 등).
let last: { viewer: Viewer; value: boolean } | null = null;
const listeners = new Set<() => void>();

const currentViewer = (): Viewer => useAuthStore.getState().user?.id ?? null;

async function fetchEduEnabled(): Promise<boolean> {
  if (!isEduConfigured()) return false;
  return eduEnabledOf(await getEduState());
}

/** 화면이 받은 최신 enabled 를 탭 판단값에 반영(현재 사용자 기준) */
export function noteEduEnabled(value: boolean): void {
  const viewer = currentViewer();
  if (last !== null && last.viewer === viewer && last.value === value) return;
  last = { viewer, value };
  for (const l of listeners) l();
}

/** null = 아직 이 사용자로 답을 못 받음(숨김), true = 교육용 종가 게임 열림 */
export function useEduGameAccess(): boolean | null {
  const viewer = useAuthStore((s) => s.user?.id ?? null);
  const [state, setState] = useState<{ viewer: Viewer; value: boolean | null }>(() => ({
    viewer,
    value: last?.viewer === viewer ? last.value : null,
  }));
  // 다른 곳(종가 게임 화면)이 캐시를 바꾸면 따라간다
  useEffect(() => {
    const onChange = () => {
      if (last !== null && last.viewer === viewer) setState({ viewer, value: last.value });
    };
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, [viewer]);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (last !== null && last.viewer !== viewer) last = null;
      fetchEduEnabled()
        .then((v) => {
          if (currentViewer() === viewer) last = { viewer, value: v };
          if (alive) setState({ viewer, value: v });
        })
        .catch(() => {
          if (last === null || last.viewer !== viewer) last = { viewer, value: false };
          if (alive) setState({ viewer, value: last.value });
        });
      return () => {
        alive = false;
      };
    }, [viewer]),
  );
  if (state.viewer === viewer) return state.value;
  return last?.viewer === viewer ? last.value : null;
}
