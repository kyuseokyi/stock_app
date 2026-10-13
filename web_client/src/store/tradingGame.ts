import { create } from 'zustand'
import * as gameApi from '../api/game'
import { gameClient } from '../api/gameClient'
import { orderErrorMessage } from '../lib/gameErrors'
import type {
  Account, Coach, GameWsMessage, Leverage, MyRank, Nudge, Position, Ratio, Season, Sentiment, Side,
} from '../types/game'

// 트레이딩 게임 전역 상태. 공개 데이터(시즌)와 로그인 데이터(계좌·포지션·순위·코치·해금·WS 실시간)를 분리한다.

export type GameStatus = 'loading' | 'ready' | 'no-season' | 'unavailable' | 'error'

export interface GameToast {
  id: number
  kind: 'nudge' | 'error' | 'info'
  icon: string
  message: string
}

interface PrivateState {
  account: Account | null
  position: Position | null
  myRank: MyRank | null
  coach: Coach | null
  academyUnlocked: boolean
  lastPrice: number | null
  sentiment: Sentiment | null
}

interface TradingGameState extends PrivateState {
  status: GameStatus
  season: Season | null
  submitting: boolean
  closing: boolean
  toasts: GameToast[]
  loadSeason: () => Promise<void>
  loadPrivate: () => Promise<void>
  refreshTrading: () => Promise<void>
  refreshRank: () => Promise<void>
  resetPrivate: () => void
  placeOrder: (side: Side, ratio: Ratio, leverage: Leverage) => Promise<void>
  closePosition: () => Promise<void>
  applyMessage: (msg: GameWsMessage) => void
  pushToast: (t: Omit<GameToast, 'id'>) => void
  dismissToast: (id: number) => void
}

const PRIVATE_EMPTY: PrivateState = {
  account: null,
  position: null,
  myRank: null,
  coach: null,
  academyUnlocked: false,
  lastPrice: null,
  sentiment: null,
}

const NUDGE_ICON: Record<string, string> = { WARNING: '⚠️', PRAISE: '👏', ADVICE: '💡' }
let toastSeq = 0
// 경쟁 상태 가드: privateGen은 resetPrivate(로그아웃)마다 증가 — 요청 시작 시점과 달라졌으면 늦게 도착한 응답을 버린다.
// refreshSeq는 재조회 호출 순번 — 더 최신 호출이 있으면 순서가 뒤바뀌어 도착한 이전 응답을 버린다.
let privateGen = 0
let refreshSeq = 0

export const useTradingGameStore = create<TradingGameState>()((set, get) => {
  const pushNudges = (nudges: Nudge[]) => {
    for (const n of nudges) get().pushToast({ kind: 'nudge', icon: NUDGE_ICON[n.type] ?? '💬', message: n.message })
  }

  /** 거래·자동청산 후 계좌/포지션/순위 재조회. 개별 실패는 무시(다음 갱신에서 회복) */
  const refreshTrading = async () => {
    const season = get().season
    if (!season) return
    const gen = privateGen
    const seq = ++refreshSeq
    const [acc, pos, rank] = await Promise.allSettled([
      gameApi.getMyAccount(season.id),
      gameApi.getActivePosition(season.id),
      gameApi.getMyRank(season.id),
    ])
    if (gen !== privateGen || seq !== refreshSeq) return // 로그아웃 또는 더 최신 재조회 존재 — 덮어쓰기 금지
    const patch: Partial<PrivateState> = {}
    if (acc.status === 'fulfilled') patch.account = acc.value
    if (pos.status === 'fulfilled') patch.position = pos.value
    if (rank.status === 'fulfilled') patch.myRank = rank.value
    set(patch)
  }

  return {
    ...PRIVATE_EMPTY,
    status: 'loading',
    season: null,
    submitting: false,
    closing: false,
    toasts: [],

    loadSeason: async () => {
      if (!gameClient) {
        set({ status: 'unavailable' })
        return
      }
      // 최초 로드만 loading 표시 — 시즌이 이미 있으면(탭 재진입) 화면 유지한 채 백그라운드 갱신
      if (get().season === null) set({ status: 'loading' })
      try {
        const season = await gameApi.getActiveSeason()
        set(season ? { status: 'ready', season } : { status: 'no-season', season: null })
      } catch {
        if (get().status !== 'ready') set({ status: 'error' }) // 이미 ready 면 현재 상태 유지
      }
    },

    loadPrivate: async () => {
      const season = get().season
      if (!season) return
      const gen = privateGen
      const [, coach, academy] = await Promise.allSettled([
        refreshTrading(),
        gameApi.getTodayCoach(),
        gameApi.getAcademyUnlocked(),
      ])
      const patch: Partial<PrivateState> = {}
      if (coach.status === 'fulfilled') {
        patch.coach = coach.value && coach.value.season_id === season.id ? coach.value : null
      }
      if (academy.status === 'fulfilled') patch.academyUnlocked = academy.value
      if (gen !== privateGen) return // 로그아웃 후 늦게 도착한 이전 사용자 데이터 폐기
      set(patch)
    },

    refreshTrading,

    refreshRank: async () => {
      const season = get().season
      if (!season) return
      const gen = privateGen
      const seq = refreshSeq
      try {
        const rank = await gameApi.getMyRank(season.id)
        if (gen !== privateGen || seq !== refreshSeq) return // 로그아웃 또는 폴링 중 재조회 시작 — 덮어쓰기 금지
        set({ myRank: rank })
      } catch {
        // 순위 갱신 실패는 조용히 무시(다음 주기에 재시도)
      }
    },

    resetPrivate: () => {
      privateGen++
      set({ ...PRIVATE_EMPTY })
    },

    placeOrder: async (side, ratio, leverage) => {
      const { season, submitting } = get()
      if (!season || submitting) return
      const gen = privateGen
      set({ submitting: true })
      try {
        const result = await gameApi.placeOrder({ season_id: season.id, side, ratio, leverage })
        if (gen === privateGen) {
          set({ position: result.position })
          pushNudges(result.nudges)
          await refreshTrading()
        }
      } catch (err) {
        get().pushToast({ kind: 'error', icon: '⚠️', message: orderErrorMessage(err) })
      } finally {
        set({ submitting: false })
      }
    },

    closePosition: async () => {
      const { position, closing } = get()
      if (!position || closing) return
      const gen = privateGen
      set({ closing: true })
      try {
        const result = await gameApi.closePosition(position.id)
        if (gen === privateGen) {
          set({ position: null })
          pushNudges(result.nudges)
          await refreshTrading()
        }
      } catch (err) {
        get().pushToast({ kind: 'error', icon: '⚠️', message: orderErrorMessage(err) })
        void refreshTrading() // 이미 자동청산된 경우 등 — 서버 상태로 동기화
      } finally {
        set({ closing: false })
      }
    },

    applyMessage: (msg) => {
      const { season, position } = get()
      switch (msg.type) {
        case 'tick':
          if (season && msg.ticker === season.ticker) set({ lastPrice: msg.price })
          return
        case 'position_pnl':
          if (position && position.id === msg.position_id) {
            set({ position: { ...position, roi_pct: msg.roi_pct, pnl_amount: msg.pnl_amount } })
          }
          return
        case 'sentiment':
          set({ sentiment: { long_pct: msg.long_pct, short_pct: msg.short_pct } })
          return
        case 'nudge':
          pushNudges([msg.nudge])
          void refreshTrading() // 자동청산(손절/익절/마진콜) 반영
          return
        case 'coach':
          if (season && msg.coach.season_id === season.id) set({ coach: msg.coach })
          return
      }
    },

    pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastSeq }] })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})
