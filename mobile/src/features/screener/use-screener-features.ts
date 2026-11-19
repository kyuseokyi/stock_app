import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';

import { fetchScreenerFeatures, type ScreenerFeatures } from './api';

const HIDDEN: ScreenerFeatures = { stockFinder: false, finder: false, patterns: false, marketData: false, marketIndexKr: false };

type Viewer = number | string | null;

// 앱 안에서 마지막으로 받은 답(누가 물었는지와 함께) — 다른 화면(탭 레이아웃·스크리너·종목 상세)이 새로 마운트돼도
// 처음부터 '모름'이 되지 않게. marketData·marketIndexKr 은 요청자 기준이라(A안) 로그인 사용자가 바뀌면 버린다 —
// 관리자의 true 가 로그아웃 뒤에 남으면 시세가 새기 때문.
let last: { viewer: Viewer; value: ScreenerFeatures } | null = null;

const currentViewer = (): Viewer => useAuthStore.getState().user?.id ?? null;

/** 마지막으로 받은 스위치 값(없거나 다른 사용자의 값이면 null) — 훅을 쓸 수 없는 곳(헤더 버튼의 누를 때 판정)에서 읽는다 */
export function lastScreenerFeatures(): ScreenerFeatures | null {
  return last?.viewer === currentViewer() ? last.value : null;
}

/** 관리자가 켜고 끄는 스크리너 스위치(종목 찾기 전체·조건검색·차트 패턴) + 요청자 기준 시세 열람 값(marketData·marketIndexKr).
 *  화면에 들어올 때(포커스)마다, 그리고 로그인·로그아웃으로 사용자가 바뀔 때 다시 물어 앱 재시작 없이 반영된다.
 *  null = 아직 이 사용자로 답을 못 받음(로딩 — 숨김). 첫 요청이 실패하면 모두 꺼짐(HIDDEN)으로 확정한다(숨김 쪽이 안전).
 *  같은 사용자의 재요청 실패는 마지막 값을 유지. */
export function useScreenerFeaturesState(): ScreenerFeatures | null {
  const viewer = useAuthStore((s) => s.user?.id ?? null);
  const [state, setState] = useState<{ viewer: Viewer; value: ScreenerFeatures | null }>(() => ({
    viewer,
    value: last?.viewer === viewer ? last.value : null,
  }));
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (last !== null && last.viewer !== viewer) last = null; // 사용자가 바뀌면 이전 답을 먼저 버린다
      fetchScreenerFeatures()
        .then((f) => {
          if (currentViewer() === viewer) last = { viewer, value: f }; // 응답 사이 로그인 상태가 바뀌었으면 저장 안 함
          if (alive) setState({ viewer, value: f });
        })
        .catch(() => {
          if (last === null || last.viewer !== viewer) last = { viewer, value: HIDDEN };
          if (alive) setState({ viewer, value: last.value });
        });
      return () => {
        alive = false;
      };
    }, [viewer]),
  );
  // 사용자가 바뀐 첫 렌더에서 이전 사용자의 값을 쓰지 않는다
  if (state.viewer === viewer) return state.value;
  return last?.viewer === viewer ? last.value : null;
}
