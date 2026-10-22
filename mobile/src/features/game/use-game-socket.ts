import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { getAuthToken, getRefreshToken } from '@/lib/api/auth-token';
import { refreshAfter401 } from '@/lib/api/token-refresh';
import { ENV } from '@/lib/env';

import { buildGameWsUrl, classifyWsClose, parseGameMessage } from './lib/ws';
import { useTradingGameStore } from './store';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const PING_MS = 25_000;
const CAPACITY_INITIAL_MS = 5_000; // 4429(공개 연결 상한) 재시도 시작 간격
/** 갱신 후 재연결이 이 시간 안에 또 만료(4401)로 닫히면 더 갱신하지 않고 로그인 만료 처리(갱신 1회 — 무한 반복 방지) */
const REFRESH_GUARD_MS = 60_000;

/**
 * 게임 실시간 스트림(RN 내장 WebSocket). enabled 이며 앱이 백그라운드가 아닐 때만(iOS inactive 는 연결 유지) 연결한다.
 * - token 이 있으면 로그인 연결, 없으면 공개 연결(틱·시장심리만 수신). 로그인·로그아웃(모드 전환) 때만 재연결하고,
 *   토큰 회전(갱신)으로는 재연결하지 않는다 — 실제 토큰은 연결할 때 메모리 홀더에서 읽는다.
 * - 끊기면 지수 백오프(1s→30s)로 재연결. 로그인 연결이 4401 이면:
 *   reason TOKEN_EXPIRED·빈 값 + 리프레시 있음 → 토큰 갱신 후 재연결(1회), 갱신 네트워크 오류 → 백오프 재시도,
 *   그 밖(SESSION_REPLACED·SESSION_ENDED·TOKEN_INVALID·갱신 거부) → 갱신·재연결 없이 onAuthFailed(사유) 호출.
 * - 4429(공개 연결 상한)는 accept 직후 닫히므로 별도 백오프(5s→30s)로 재시도 — 첫 메시지 수신 시 초기화.
 * - 로그인 연결의 재연결 성공 시 놓친 자동청산 등을 반영하려고 계좌/포지션/순위를 다시 불러온다(web 과 동일).
 * - 앱이 background 로 가면 연결을 닫고(effect 정리), 포그라운드 복귀 시 재연결 + 재조회.
 */
export function useGameSocket(token: string | null, enabled: boolean, onAuthFailed: (reason: string) => void): void {
  const onAuthFailedRef = useRef(onAuthFailed);
  const tokenRef = useRef(token);
  const loggedIn = token !== null;
  const [appActive, setAppActive] = useState(() => AppState.currentState !== 'background');

  // 렌더 중 ref 대입은 React Compiler 규칙 위반 — effect 에서 최신 콜백으로 갱신
  useEffect(() => {
    onAuthFailedRef.current = onAuthFailed;
  }, [onAuthFailed]);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // 포그라운드 복귀 감지 — 비활성 동안 놓친 체결/자동청산을 재조회(연결은 아래 effect 가 appActive 로 재수립)
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const resumed = prev !== 'active' && next === 'active';
      prev = next;
      setAppActive(next !== 'background');
      if (resumed && enabled) useTradingGameStore.getState().bumpStreamEpoch(); // 차트가 놓친 캔들 다시 불러옴
      if (resumed && loggedIn && enabled) void useTradingGameStore.getState().refreshTrading();
    });
    return () => sub.remove();
  }, [loggedIn, enabled]);

  useEffect(() => {
    const base = ENV.gameApiUrl;
    if (!enabled || !appActive || !base) return;
    const store = useTradingGameStore.getState;
    let ws: WebSocket | null = null;
    let stopped = false;
    let opened = false;
    let backoff = INITIAL_BACKOFF_MS;
    let capacityBackoff = CAPACITY_INITIAL_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let lastRefreshAt = 0;

    const scheduleRetry = () => {
      retryTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };

    const connect = () => {
      // 연결 시점의 최신 토큰(갱신으로 회전됐을 수 있음). 로그인 모드인데 홀더가 비었으면(로그아웃 중) 렌더 값
      const sent = loggedIn ? (getAuthToken() ?? tokenRef.current) : null;
      const sock = new WebSocket(buildGameWsUrl(base, sent));
      ws = sock;
      sock.onopen = () => {
        backoff = INITIAL_BACKOFF_MS;
        if (opened) store().bumpStreamEpoch(); // 끊긴 동안 놓친 캔들 → 차트가 다시 불러옴
        if (opened && sent) void store().refreshTrading();
        opened = true;
        pingTimer = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send('ping');
        }, PING_MS);
      };
      sock.onmessage = (e) => {
        capacityBackoff = CAPACITY_INITIAL_MS;
        if (typeof e.data !== 'string') return;
        const msg = parseGameMessage(e.data);
        if (msg) store().applyMessage(msg);
      };
      sock.onclose = (e) => {
        clearInterval(pingTimer);
        if (stopped) return;
        const canRefresh = !!getRefreshToken() && Date.now() - lastRefreshAt > REFRESH_GUARD_MS;
        const action = classifyWsClose(e.code, !!sent, e.reason, canRefresh);
        if (action === 'auth-expired' && sent) {
          void refreshAfter401(sent).then((r) => {
            if (stopped) return;
            if (r.ok) {
              lastRefreshAt = Date.now();
              connect();
            } else if (r.kind === 'network') {
              scheduleRetry(); // 일시 오류 — 로그아웃하지 않고 다시 시도(재연결이 또 만료면 그때 다시 갱신)
            } else if (r.kind !== 'stale') {
              // 갱신 거부(사유 코드 우선 — SESSION_REPLACED "다른 기기"·SESSION_ENDED·REFRESH_REUSED 안내)·리프레시 없음
              onAuthFailedRef.current((r.kind === 'auth' ? r.code : null) ?? e.reason ?? '');
            }
          });
          return;
        }
        if (action === 'auth-failed') {
          onAuthFailedRef.current(e.reason ?? '');
          return;
        }
        if (action === 'capacity') {
          retryTimer = setTimeout(connect, capacityBackoff);
          capacityBackoff = Math.min(capacityBackoff * 2, MAX_BACKOFF_MS);
          return;
        }
        scheduleRetry();
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      ws?.close();
    };
  }, [loggedIn, enabled, appActive]);
}
