import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuthStore } from '@/features/auth/store';
import { getActiveSeason, isGameConfigured } from '@/features/game/api';

import { realMarketOf } from './access';

type Viewer = number | null;

// 게임 탭 노출 판단값 — GET /api/game/seasons/active 의 features.real_market(요청자 기준, A안).
// 탭 버튼은 게임 화면에 들어가기 전에 알아야 하므로 탭 레이아웃이 따로 묻는다(포커스·로그인 사용자 변경 때마다).
// 실패·시즌 없음·게임 서버 미설정은 false(숨김). 게임 클라이언트가 로그인 토큰을 붙인다(관리자·열람 권한 회원은 true).
// 사용자가 바뀌면 이전 답을 먼저 버린다(관리자의 true 가 로그아웃 뒤에 남지 않게).
let last: { viewer: Viewer; value: boolean } | null = null;

const currentViewer = (): Viewer => useAuthStore.getState().user?.id ?? null;

async function fetchRealMarket(): Promise<boolean> {
  if (!isGameConfigured()) return false;
  return realMarketOf(await getActiveSeason());
}

/** null = 아직 이 사용자로 답을 못 받음(숨김), true = 실제 시세 게임 허용 */
export function useGameAccess(): boolean | null {
  const viewer = useAuthStore((s) => s.user?.id ?? null);
  const [state, setState] = useState<{ viewer: Viewer; value: boolean | null }>(() => ({
    viewer,
    value: last?.viewer === viewer ? last.value : null,
  }));
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (last !== null && last.viewer !== viewer) last = null;
      fetchRealMarket()
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
