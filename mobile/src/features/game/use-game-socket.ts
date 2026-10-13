import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { ENV } from '@/lib/env';

import { parseGameMessage } from './lib/ws';
import { useTradingGameStore } from './store';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const PING_MS = 25_000;
const AUTH_FAILED = 4401; // 서버 ws_gateway: 토큰 무효/비활성 유저

/**
 * 게임 실시간 스트림(RN 내장 WebSocket). token 이 있고 enabled 이며 앱이 포그라운드(active)일 때만 연결한다.
 * - 끊기면 지수 백오프(1s→30s)로 재연결, 4401 이면 재연결하지 않고 onAuthFailed 호출.
 * - 재연결 성공 시 놓친 자동청산 등을 반영하려고 계좌/포지션/순위를 다시 불러온다(web 과 동일).
 * - 앱이 백그라운드로 가면 연결을 닫고(effect 정리), 포그라운드 복귀 시 재연결 + 재조회.
 */
export function useGameSocket(token: string | null, enabled: boolean, onAuthFailed: () => void): void {
  const onAuthFailedRef = useRef(onAuthFailed);
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');

  // 렌더 중 ref 대입은 React Compiler 규칙 위반 — effect 에서 최신 콜백으로 갱신
  useEffect(() => {
    onAuthFailedRef.current = onAuthFailed;
  }, [onAuthFailed]);

  // 포그라운드 복귀 감지 — 비활성 동안 놓친 체결/자동청산을 재조회(연결은 아래 effect 가 appActive 로 재수립)
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const resumed = prev !== 'active' && next === 'active';
      prev = next;
      setAppActive(next === 'active');
      if (resumed && token && enabled) void useTradingGameStore.getState().refreshTrading();
    });
    return () => sub.remove();
  }, [token, enabled]);

  useEffect(() => {
    const base = ENV.gameApiUrl;
    if (!token || !enabled || !appActive || !base) return;
    const url = `${base.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws/game/stream?token=${encodeURIComponent(token)}`;
    const store = useTradingGameStore.getState;
    let ws: WebSocket | null = null;
    let stopped = false;
    let opened = false;
    let backoff = INITIAL_BACKOFF_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const sock = new WebSocket(url);
      ws = sock;
      sock.onopen = () => {
        backoff = INITIAL_BACKOFF_MS;
        if (opened) void store().refreshTrading();
        opened = true;
        pingTimer = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send('ping');
        }, PING_MS);
      };
      sock.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const msg = parseGameMessage(e.data);
        if (msg) store().applyMessage(msg);
      };
      sock.onclose = (e) => {
        clearInterval(pingTimer);
        if (stopped) return;
        if (e.code === AUTH_FAILED) {
          onAuthFailedRef.current();
          return;
        }
        retryTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      ws?.close();
    };
  }, [token, enabled, appActive]);
}
