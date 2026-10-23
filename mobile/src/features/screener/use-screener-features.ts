import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchScreenerFeatures, type ScreenerFeatures } from './api';

const HIDDEN: ScreenerFeatures = { finder: false, patterns: false };

/** 관리자가 켜고 끄는 스크리너 탭(조건검색·차트 패턴). 스크리너 탭에 들어올 때마다 다시 물어 관리자 변경이 앱 재시작 없이 반영된다.
 *  처음 답을 받기 전과 실패하면 숨긴다(다듬는 중인 탭이 실수로 열리지 않게). 재요청 실패는 마지막 값을 유지. */
export function useScreenerFeatures(): ScreenerFeatures {
  const [features, setFeatures] = useState<ScreenerFeatures>(HIDDEN);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      fetchScreenerFeatures()
        .then((f) => {
          if (alive) setFeatures(f);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );
  return features;
}
