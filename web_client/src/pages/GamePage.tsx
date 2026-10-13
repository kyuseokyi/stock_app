import { useEffect, useState } from 'react'
import LoginModal from '../components/LoginModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import ActivePositionCard from '../components/game/ActivePositionCard'
import CoachBanner from '../components/game/CoachBanner'
import GameHeader from '../components/game/GameHeader'
import NudgeToaster from '../components/game/NudgeToaster'
import OrderPanel from '../components/game/OrderPanel'
import SentimentBar from '../components/game/SentimentBar'
import TradingChart from '../components/game/TradingChart'
import { useGameWebSocket } from '../hooks/useGameWebSocket'
import { useAuthStore } from '../store/auth'
import { useTradingGameStore } from '../store/tradingGame'
import type { Leverage, Ratio, Side } from '../types/game'

const RANK_POLL_MS = 30_000

// 실시간 트레이딩 게임 — 상태별 분기: 서버 미설정/시즌 없음 → 준비 중, 연결 실패 → 재시도, 정상 → 트레이딩 화면
export default function GamePage() {
  const token = useAuthStore((s) => s.token)
  const loggedIn = token !== null
  const {
    status, season, account, position, myRank, coach, academyUnlocked, lastPrice, sentiment,
    submitting, closing, loadSeason, loadPrivate, resetPrivate, refreshRank, placeOrder, closePosition, pushToast,
  } = useTradingGameStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const ready = status === 'ready'

  useEffect(() => {
    loadSeason()
  }, [loadSeason])

  // 로그인 상태가 바뀌면 개인 데이터 로드/초기화
  useEffect(() => {
    if (!ready) return
    if (loggedIn) loadPrivate()
    else resetPrivate()
  }, [ready, loggedIn, loadPrivate, resetPrivate])

  // 보유 중 실시간 ROI 로 순위가 움직이므로 주기적으로 갱신
  useEffect(() => {
    if (!ready || !loggedIn) return
    const t = setInterval(() => refreshRank(), RANK_POLL_MS)
    return () => clearInterval(t)
  }, [ready, loggedIn, refreshRank])

  useGameWebSocket(token, ready, () =>
    pushToast({ kind: 'error', icon: '🔑', message: '로그인이 만료되었어요. 다시 로그인해 주세요' }),
  )

  if (status === 'unavailable' || status === 'no-season') {
    return (
      <EmptyState
        emoji="🎮"
        title="시즌을 준비하고 있어요"
        description="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
      />
    )
  }
  if (status === 'error') {
    return (
      <EmptyState
        emoji="🔌"
        title="게임 서버에 연결할 수 없어요"
        description="잠시 후 다시 시도해 주세요."
        action={<Button onClick={() => loadSeason()}>다시 시도</Button>}
      />
    )
  }
  if (!ready || !season) return <p className="py-16 text-center text-ink-muted">불러오는 중…</p>

  const handleOrder = (side: Side, ratio: Ratio, leverage: Leverage) => {
    if (!loggedIn) {
      setLoginOpen(true)
      return
    }
    placeOrder(side, ratio, leverage)
  }

  return (
    <div className="space-y-4">
      <GameHeader season={season} account={account} myRank={myRank} loggedIn={loggedIn} />
      <CoachBanner coach={coach} />
      {loggedIn ? (
        <SentimentBar sentiment={sentiment} />
      ) : (
        <p className="rounded-card bg-surface p-4 text-sm text-ink-muted">로그인하면 실시간 시세와 주문이 열려요</p>
      )}
      <TradingChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />
      {position && (
        <ActivePositionCard position={position} lastPrice={lastPrice} closing={closing} onClose={() => closePosition()} />
      )}
      <OrderPanel
        hasPosition={position !== null}
        academyUnlocked={academyUnlocked}
        submitting={submitting}
        onOrder={handleOrder}
        onLockedLeverage={() =>
          pushToast({ kind: 'info', icon: '🔒', message: '5배 레버리지는 아카데미 퀴즈를 통과하면 열려요 (곧 오픈)' })
        }
      />
      <NudgeToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
