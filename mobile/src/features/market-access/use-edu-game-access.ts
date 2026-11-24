import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';
import { getEduFeatures, isEduConfigured } from '@/features/edu-game/api';

import { eduGateOf, type EduGate } from './access';

type Viewer = number | null;

// 교육용 합성 종가 게임 노출 + 게임 모드 스위치 판단값 — GET /api/game/edu/features 한 번으로 두 값을 얻는다
// (비로그인 가능, 전역 플래그만 — 시즌을 만들지 않는다. 옛 서버는 state 폴백. 게임 화면은 계속 state).
//  - enabled: 교육용(가상 데이터) 게임 공개 여부
//  - realMarketSwitch: 관리자 전역 REAL_MARKET 스위치 — ON 이면 실시간 게임만, OFF 면 가상 데이터 게임만 보인다.
//    (use-game-access 의 real_market 은 사용자별 판정이라 관리자는 스위치 OFF 여도 true — 화면 분기에는 쓰지 않는다)
// use-game-access 와 같은 방식: 사용자별 모듈 캐시, 포커스·로그인 사용자 변경 때 다시 묻기, 실패·게임 서버 미설정은 둘 다 false(닫힘).
// 종가 게임 화면이 상태를 새로 받으면 noteEduEnabled 로 캐시를 맞춰 탭 노출도 바로 따라간다(관리자가 끈 직후 등).
let last: { viewer: Viewer; value: EduGate } | null = null;
const listeners = new Set<() => void>();

const CLOSED: EduGate = { enabled: false, realMarketSwitch: false };

const currentViewer = (): Viewer => useAuthStore.getState().user?.id ?? null;

async function fetchEduGate(): Promise<EduGate> {
  if (!isEduConfigured()) return CLOSED;
  return eduGateOf(await getEduFeatures());
}

/** 화면이 받은 최신 enabled·스위치 값을 탭 판단값에 반영(현재 사용자 기준) */
export function noteEduEnabled(enabled: boolean, realMarketSwitch?: boolean): void {
  const viewer = currentViewer();
  const value: EduGate = { enabled, realMarketSwitch: realMarketSwitch === true };
  if (
    last !== null &&
    last.viewer === viewer &&
    last.value.enabled === value.enabled &&
    last.value.realMarketSwitch === value.realMarketSwitch
  ) {
    return;
  }
  last = { viewer, value };
  for (const l of listeners) l();
}

/** null = 아직 이 사용자로 답을 못 받음(게임 없음으로 본다). 한 화면에서 이 훅을 한 번만 부르면 요청도 한 번 */
export function useEduGate(): EduGate | null {
  const viewer = useAuthStore((s) => s.user?.id ?? null);
  const [state, setState] = useState<{ viewer: Viewer; value: EduGate | null }>(() => ({
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
      fetchEduGate()
        .then((v) => {
          if (currentViewer() === viewer) last = { viewer, value: v };
          if (alive) setState({ viewer, value: v });
        })
        .catch(() => {
          if (last === null || last.viewer !== viewer) last = { viewer, value: CLOSED };
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

/** null = 아직 이 사용자로 답을 못 받음(숨김), true = 교육용 종가 게임 열림 */
export function useEduGameAccess(): boolean | null {
  const gate = useEduGate();
  return gate === null ? null : gate.enabled;
}
