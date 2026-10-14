import { useEffect, useRef } from 'react'
import { GAME_API_URL } from '../config'
import { parseGameMessage } from '../lib/gameWs'
import { useTradingGameStore } from '../store/tradingGame'

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const PING_MS = 25_000
const AUTH_FAILED = 4401 // 서버 ws_gateway: 토큰 무효/비활성 유저
const OVER_CAPACITY = 4429 // 서버 ws_gateway: 공개(비로그인) 연결 상한 초과
const CAPACITY_INITIAL_MS = 5_000

/** 게임 WS URL. 토큰이 없으면 token 파라미터 자체를 생략(공개 연결) — 빈 `?token=` 은 서버가 4401 로 거부한다. */
export function buildGameWsUrl(baseUrl: string, token: string | null): string {
  const base = `${baseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws/game/stream`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

/**
 * 게임 실시간 스트림. enabled 일 때 연결 — token 이 있으면 로그인 연결, 없으면 공개 연결(틱·시장심리만 수신).
 * token 이 바뀌면(로그인/로그아웃) 맞는 모드로 다시 연결한다.
 * 끊기면 지수 백오프로 재연결, 로그인 연결이 4401 이면 재연결하지 않고 onAuthFailed 호출.
 * 4429(공개 연결 상한)는 accept 직후 닫히므로 별도 백오프(5초→최대 30초)로 재시도 — 첫 메시지 수신 시 초기화.
 * 로그인 연결 재연결 성공 시 놓친 자동청산 등을 반영하려고 계좌/포지션/순위를 다시 불러온다.
 */
export function useGameWebSocket(token: string | null, enabled: boolean, onAuthFailed: () => void): void {
  const onAuthFailedRef = useRef(onAuthFailed)
  onAuthFailedRef.current = onAuthFailed

  useEffect(() => {
    if (!enabled || !GAME_API_URL) return
    const url = buildGameWsUrl(GAME_API_URL, token)
    const store = useTradingGameStore.getState
    let ws: WebSocket | null = null
    let stopped = false
    let opened = false
    let backoff = INITIAL_BACKOFF_MS
    let capacityBackoff = CAPACITY_INITIAL_MS
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      const sock = new WebSocket(url)
      ws = sock
      sock.onopen = () => {
        backoff = INITIAL_BACKOFF_MS
        if (opened && token) void store().refreshTrading()
        opened = true
        pingTimer = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send('ping')
        }, PING_MS)
      }
      sock.onmessage = (e: MessageEvent<string>) => {
        capacityBackoff = CAPACITY_INITIAL_MS
        const msg = parseGameMessage(e.data)
        if (msg) store().applyMessage(msg)
      }
      sock.onclose = (e: CloseEvent) => {
        clearInterval(pingTimer)
        if (stopped) return
        if (e.code === AUTH_FAILED && token) {
          onAuthFailedRef.current()
          return
        }
        if (e.code === OVER_CAPACITY) {
          retryTimer = setTimeout(connect, capacityBackoff)
          capacityBackoff = Math.min(capacityBackoff * 2, MAX_BACKOFF_MS)
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
