import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { fetchAdConfig, type AdConfig } from './api';

// 앱 안에서 마지막으로 받은 답 — 다른 화면이 새로 마운트돼도 다시 받기 전까지 같은 값을 보여 준다
let last: AdConfig | null = null;

/** 광고 원격 설정. 화면에 들어올 때(포커스)마다 다시 물어 관리자 긴급 끄기가 앱 재시작 없이 반영된다
 *  (use-screener-features 와 같은 방식). null = 아직 한 번도 답을 못 받음 — 광고는 숨긴다.
 *  재요청 실패는 마지막 값을 유지한다(꺼짐 → 켜짐으로 잘못 바뀌지 않고, 켜짐이 잠깐 실패로 깜빡이지도 않게). */
export function useAdConfig(): AdConfig | null {
  const [config, setConfig] = useState<AdConfig | null>(last);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      fetchAdConfig()
        .then((c) => {
          last = c;
          if (alive) setConfig(c);
        })
        .catch(() => {
          if (alive) setConfig(last);
        });
      return () => {
        alive = false;
      };
    }, []),
  );
  return config;
}
