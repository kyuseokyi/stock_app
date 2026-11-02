import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchScreenerFeatures, type ScreenerFeatures } from './api';

const HIDDEN: ScreenerFeatures = { stockFinder: false, finder: false, patterns: false };

// 앱 안에서 마지막으로 받은 답 — 다른 화면(탭 레이아웃·스크리너·종목 상세)이 새로 마운트돼도 처음부터 '모름'이 되지 않게
let last: ScreenerFeatures | null = null;

/** 관리자가 켜고 끄는 스크리너 스위치(종목 찾기 전체·조건검색·차트 패턴). 화면에 들어올 때(포커스)마다 다시 물어
 *  관리자 변경이 앱 재시작 없이 반영된다. null = 아직 한 번도 답을 못 받음(로딩).
 *  첫 요청이 실패하면 모두 꺼짐(HIDDEN)으로 확정한다(숨김 쪽이 안전). 재요청 실패는 마지막 값을 유지. */
export function useScreenerFeaturesState(): ScreenerFeatures | null {
  const [features, setFeatures] = useState<ScreenerFeatures | null>(last);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      fetchScreenerFeatures()
        .then((f) => {
          last = f;
          if (alive) setFeatures(f);
        })
        .catch(() => {
          if (last === null) last = HIDDEN;
          if (alive) setFeatures(last);
        });
      return () => {
        alive = false;
      };
    }, []),
  );
  return features;
}
