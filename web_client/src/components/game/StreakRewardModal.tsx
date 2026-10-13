import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Modal from '../ui/Modal'
import { claimStreakReward } from '../../api/game'
import { formatKrw } from '../../lib/format'
import { gameErrorMessage } from '../../lib/gameErrors'
import { currentPrivateGen, useTradingGameStore } from '../../store/tradingGame'
import type { StreakReward } from '../../types/game'

interface MilestoneCardProps {
  reward: StreakReward
  current: number
  claiming: boolean
  onClaim: () => void
}

function MilestoneCard({ reward, current, claiming, onClaim }: MilestoneCardProps) {
  const done = Math.min(current, reward.milestone)
  const pct = (done / reward.milestone) * 100
  return (
    <Card as="article">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-ink">🔥 {reward.milestone}일 연속</h3>
        <span className="shrink-0 text-sm font-semibold text-up">+{formatKrw(reward.amount)}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={reward.milestone}
          aria-valuenow={done}
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-12 text-right text-xs text-ink-muted tabular-nums">
          {done}/{reward.milestone}
        </span>
      </div>
      <div className="mt-3 flex justify-end">
        {reward.claimed ? (
          <Button variant="secondary" disabled>
            받음 ✓
          </Button>
        ) : reward.claimable ? (
          <Button loading={claiming} loadingText="받는 중…" onClick={onClaim}>
            보상 받기
          </Button>
        ) : (
          <Button variant="secondary" disabled>
            진행 중
          </Button>
        )}
      </div>
    </Card>
  )
}

// 연속 출석 마일스톤 보상 — 시즌마다 마일스톤별 1회. 로그인 전용(헤더 칩은 로그인·Streak 활성 때만 노출).
export default function StreakRewardModal({ onClose }: { onClose: () => void }) {
  const streak = useTradingGameStore((s) => s.streak)
  const refreshStreak = useTradingGameStore((s) => s.refreshStreak)
  const setStreak = useTradingGameStore((s) => s.setStreak)
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading)
  const pushToast = useTradingGameStore((s) => s.pushToast)
  const [claiming, setClaiming] = useState<number | null>(null)

  // 퀴즈·주문 후 새로 받을 수 있게 된 보상까지 반영하도록 열 때 최신화
  useEffect(() => {
    void refreshStreak()
  }, [refreshStreak])

  const claim = async (milestone: number) => {
    if (claiming !== null) return
    const gen = currentPrivateGen()
    setClaiming(milestone)
    try {
      const res = await claimStreakReward(milestone)
      setStreak(res.streak, gen)
      if (gen === currentPrivateGen()) {
        void refreshTrading() // 현금 보상 → 헤더 자본금 반영
        pushToast({ kind: 'info', icon: '🎁', message: '보상을 받았어요' })
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) })
      void refreshStreak() // 끊김·중복 등 서버 상태로 동기화
    } finally {
      setClaiming(null)
    }
  }

  const rewards = streak?.rewards ?? []
  const current = streak?.current_streak ?? 0

  return (
    <Modal title="🔥 연속 출석 보상" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">
        지금 {current}일 연속 출석 중이에요. 연속이 끊기기 전에 받아야 해요.
      </p>
      {rewards.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-muted">지금은 받을 수 있는 보상이 없어요</p>
      ) : (
        <div className="space-y-3">
          {rewards.map((r) => (
            <MilestoneCard
              key={r.milestone}
              reward={r}
              current={current}
              claiming={claiming === r.milestone}
              onClaim={() => void claim(r.milestone)}
            />
          ))}
        </div>
      )}
    </Modal>
  )
}
