// @vitest-environment jsdom
// 스토어 구독 방식 재렌더 테스트 — 전체 구독을 금지한 이유와 useShallow 선택자의 효과를 고정한다.
// GamePage 를 통째로 그리지 않는 이유: 게임 화면은 마운트되자마자 WS·캔들·장운영 상태를 불러 소켓·차트·API 가 엮인다.
// 대신 GamePage(GameScreen) 와 같은 useShallow 선택자를 쓰는 시험 컴포넌트로 실제 useTradingGameStore 를 구독한다.
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { useTradingGameStore } from './tradingGame'

// vitest globals 를 끈 상태라 Testing Library 자동 정리가 돌지 않는다 → 테스트마다 화면을 비운다
afterEach(() => cleanup())

type S = { price: number; season: string; setPrice: (p: number) => void }
const useT = create<S>()((set) => ({ price: 0, season: 's1', setPrice: (price) => set({ price }) }))

describe('스토어 구독 방식', () => {
  it('useShallow 로 고른 패널은 시세만 바뀌면 다시 그려지지 않는다', () => {
    let panel = 0
    function Panel() {
      const { season, setPrice } = useT(useShallow((s) => ({ season: s.season, setPrice: s.setPrice })))
      panel++
      return <span>{season}{typeof setPrice}</span>
    }
    render(<Panel />)
    act(() => useT.getState().setPrice(100))
    act(() => useT.getState().setPrice(101))
    expect(panel).toBe(1)
  })

  it('전체 구독은 시세마다 다시 그려진다(금지 이유)', () => {
    let whole = 0
    function Whole() {
      // 테스트 파일은 재발 방지 규칙 예외(eslint ignores) — 비교용으로 일부러 전체 구독
      const { season } = useT()
      whole++
      return <span>{season}</span>
    }
    render(<Whole />)
    act(() => useT.getState().setPrice(200))
    expect(whole).toBe(2)
  })
})

describe('게임 스토어 구독(GamePage 와 같은 선택자)', () => {
  // GamePage.tsx GameScreen 의 세 묶음과 같은 필드 — GamePage 에서 고르는 필드를 바꾸면 여기도 맞춘다
  let renders = 0
  function GameProbe() {
    const { status, season, account, position, myRank, coach, academyUnlocked, streak, quizDisabled,
      submitting, closing, marketStatus, streamEpoch } = useTradingGameStore(useShallow((s) => ({
      status: s.status, season: s.season, account: s.account, position: s.position, myRank: s.myRank, coach: s.coach,
      academyUnlocked: s.academyUnlocked, streak: s.streak, quizDisabled: s.quizDisabled,
      submitting: s.submitting, closing: s.closing, marketStatus: s.marketStatus, streamEpoch: s.streamEpoch,
    })))
    const { lastPrice, sentiment } = useTradingGameStore(useShallow((s) => ({ lastPrice: s.lastPrice, sentiment: s.sentiment })))
    const { loadSeason, loadPrivate, resetPrivate, refreshRank, placeOrder, closePosition, loadMarketStatus } = useTradingGameStore(
      useShallow((s) => ({
        loadSeason: s.loadSeason, loadPrivate: s.loadPrivate, resetPrivate: s.resetPrivate, refreshRank: s.refreshRank,
        placeOrder: s.placeOrder, closePosition: s.closePosition, loadMarketStatus: s.loadMarketStatus,
      })),
    )
    renders++
    const used = [status, season, account, position, myRank, coach, academyUnlocked, streak, quizDisabled, submitting, closing,
      marketStatus, streamEpoch, sentiment, loadSeason, loadPrivate, resetPrivate, refreshRank, placeOrder, closePosition, loadMarketStatus]
    return <span>{lastPrice ?? '-'}{used.length}</span>
  }

  it('고른 필드(시세 lastPrice)가 바뀌면 한 번 다시 그려진다', () => {
    renders = 0
    render(<GameProbe />)
    act(() => useTradingGameStore.setState({ lastPrice: 71_000 }))
    expect(renders).toBe(2)
  })

  it('고르지 않은 필드(toasts)만 바뀌면 다시 그려지지 않는다', () => {
    renders = 0
    render(<GameProbe />)
    act(() => useTradingGameStore.getState().pushToast({ kind: 'info', icon: 'i', message: '시험' }))
    act(() => useTradingGameStore.getState().dismissToast(useTradingGameStore.getState().toasts[0].id))
    expect(renders).toBe(1)
  })
})
