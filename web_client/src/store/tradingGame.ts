import { create } from 'zustand'
import * as gameApi from '../api/game'
import { gameClient } from '../api/gameClient'
import { orderErrorMessage } from '../lib/gameErrors'
import type {
  Account, Coach, GameWsMessage, Leverage, MyRank, Nudge, Position, Ratio, Season, Sentiment, Side, Streak,
} from '../types/game'

// 트레이딩 게임 전역 상태. 공개 데이터(시즌)와 로그인 데이터(계좌·포지션·순위·코치·해금·Streak·WS 실시간)를 분리한다.
// 모달 내부 데이터(랭킹 목록·퀘스트·문항·퀴즈 진행)는 각 모달의 로컬 state — 여기엔 화면 간 공유값만 둔다.

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
  streak: Streak | null
  lastPrice: number | null
  sentiment: Sentiment | null
}

interface TradingGameState extends PrivateState {
  status: GameStatus
  season: Season | null
  submitting: boolean
  closing: boolean
  toasts: GameToast[]
  /** 퀴즈 API 가 503 FEATURE_DISABLED 를 준 뒤 이 세션 동안 퀴즈 진입점 숨김(로그아웃해도 유지 — 서버 전역 플래그) */
  quizDisabled: boolean
  loadSeason: () => Promise<void>
  loadPrivate: () => Promise<void>
  refreshTrading: () => Promise<void>
  refreshRank: () => Promise<void>
  refreshStreak: () => Promise<void>
  resetPrivate: () => void
  placeOrder: (side: Side, ratio: Ratio, leverage: Leverage) => Promise<void>
  closePosition: () => Promise<void>
  applyMessage: (msg: GameWsMessage) => void
  /** gen = 요청 시작 시점의 currentPrivateGen() — 그 사이 로그아웃했으면 무시 */
  setAcademyUnlocked: (unlocked: boolean, gen: number) => void
  /** 퀴즈 제출 응답의 streak 반영. gen 규칙은 setAcademyUnlocked 와 동일 */
  setStreak: (streak: Streak, gen: number) => void
  markQuizDisabled: () => void
  pushToast: (t: Omit<GameToast, 'id'>) => void
  dismissToast: (id: number) => void
}

const PRIVATE_EMPTY: PrivateState = {
  account: null,
  position: null,
  myRank: null,
  coach: null,
  academyUnlocked: false,
  streak: null,
  lastPrice: null,
  sentiment: null,
}

const NUDGE_ICON: Record<string, string> = { WARNING: '⚠️', PRAISE: '👏', ADVICE: '💡' }
let toastSeq = 0
// 경쟁 상태 가드: privateGen은 resetPrivate(로그아웃)마다 증가 — 요청 시작 시점과 달라졌으면 늦게 도착한 응답을 버린다.
// refreshSeq는 재조회 호출 순번 — 더 최신 호출이 있으면 순서가 뒤바뀌어 도착한 이전 응답을 버린다.
let privateGen = 0
let refreshSeq = 0

/** 모달 등 스토어 밖에서 비동기 요청을 시작할 때 캡처 → setAcademyUnlocked/setStreak 에 전달 */
export const currentPrivateGen = (): number => privateGen

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

  /** 연속 출석 재조회(주문 성공 시 서버가 touch). 실패는 무시 */
  const refreshStreak = async () => {
    const gen = privateGen
    try {
      const streak = await gameApi.getMyStreak()
      if (gen === privateGen) set({ streak })
    } catch {
      // Streak 은 부가 정보 — 조회 실패 시 기존 값 유지
    }
  }

  return {
    ...PRIVATE_EMPTY,
    status: 'loading',
    season: null,
    submitting: false,
    closing: false,
    toasts: [],
    quizDisabled: false,

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
      const [, coach, academy, streak] = await Promise.allSettled([
        refreshTrading(),
        gameApi.getTodayCoach(),
        gameApi.getAcademyUnlocked(),
        gameApi.getMyStreak(),
      ])
      const patch: Partial<PrivateState> = {}
      if (coach.status === 'fulfilled') {
        patch.coach = coach.value && coach.value.season_id === season.id ? coach.value : null
      }
      if (academy.status === 'fulfilled') patch.academyUnlocked = academy.value
      if (streak.status === 'fulfilled') patch.streak = streak.value
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

    refreshStreak,

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
          void refreshStreak() // 서버가 주문 시 연속 출석을 touch — 기다리지 않음
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

    setAcademyUnlocked: (unlocked, gen) => {
      if (gen === privateGen) set({ academyUnlocked: unlocked })
    },

    setStreak: (streak, gen) => {
      if (gen === privateGen) set({ streak })
    },

    markQuizDisabled: () => set({ quizDisabled: true }),

    pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastSeq }] })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})
