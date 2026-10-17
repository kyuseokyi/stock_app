import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** 탭(시트)이 열려 있는 동안 조용히 다시 불러오는 주기(서버 목록 캐시 5초) — 웹 RANKING_REFRESH_MS 와 같음 */
export const RANKING_REFRESH_MS = 15_000;

/**
 * 앱이 포그라운드(active)일 때만 ms 마다 callback 호출. 반환값은 정지 함수.
 * getState 는 테스트에서 바꿔 끼우기 위함(기본 AppState.currentState).
 */
export function startForegroundInterval(
  callback: () => void,
  ms: number,
  getState: () => string = () => AppState.currentState,
): () => void {
  const t = setInterval(() => {
    if (getState() === 'active') callback();
  }, ms);
  return () => clearInterval(t);
}

/** 컴포넌트가 떠 있고 enabled 인 동안 startForegroundInterval. callback 은 최신 것을 쓴다(타이머 재생성 없음) */
export function useForegroundInterval(callback: () => void, ms: number, enabled = true) {
  const cb = useRef(callback);
  useEffect(() => {
    cb.current = callback;
  });
  useEffect(() => {
    if (!enabled) return;
    return startForegroundInterval(() => cb.current(), ms);
  }, [ms, enabled]);
}
