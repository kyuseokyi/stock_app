import { useEffect, useRef } from 'react'
import { GAME_API_URL } from '../config'
import { parseGameMessage } from '../lib/gameWs'
import { useTradingGameStore } from '../store/tradingGame'

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const PING_MS = 25_000
const AUTH_FAILED = 4401 // 서버 ws_gateway: 토큰 무효/비활성 유저

/**
 * 게임 실시간 스트림. token 이 있고 enabled 일 때만 연결한다.
 * 끊기면 지수 백오프로 재연결, 4401 이면 재연결하지 않고 onAuthFailed 호출.
 * 재연결 성공 시 놓친 자동청산 등을 반영하려고 계좌/포지션/순위를 다시 불러온다.
 */
export function useGameWebSocket(token: string | null, enabled: boolean, onAuthFailed: () => void): void {
  const onAuthFailedRef = useRef(onAuthFailed)
  onAuthFailedRef.current = onAuthFailed

  useEffect(() => {
    if (!token || !enabled || !GAME_API_URL) return
    const url = `${GAME_API_URL.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws/game/stream?token=${encodeURIComponent(token)}`
    const store = useTradingGameStore.getState
    let ws: WebSocket | null = null
    let stopped = false
    let opened = false
    let backoff = INITIAL_BACKOFF_MS
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      const sock = new WebSocket(url)
      ws = sock
      sock.onopen = () => {
        backoff = INITIAL_BACKOFF_MS
        if (opened) void store().refreshTrading()
        opened = true
        pingTimer = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send('ping')
        }, PING_MS)
      }
      sock.onmessage = (e: MessageEvent<string>) => {
        const msg = parseGameMessage(e.data)
        if (msg) store().applyMessage(msg)
      }
      sock.onclose = (e: CloseEvent) => {
        clearInterval(pingTimer)
        if (stopped) return
        if (e.code === AUTH_FAILED) {
          onAuthFailedRef.current()
          return
        }
        retryTimer = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(pingTimer)
      ws?.close()
    }
  }, [token, enabled])
}
