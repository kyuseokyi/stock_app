import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Chip from '../ui/Chip'
import Modal from '../ui/Modal'
import { claimQuest, getQuests } from '../../api/game'
import { formatKrw } from '../../lib/format'
import { gameErrorMessage } from '../../lib/gameErrors'
import { currentPrivateGen, useTradingGameStore } from '../../store/tradingGame'
import type { Quest, QuestList } from '../../types/game'

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T }

function rewardLabel(q: Quest): string {
  if (q.reward_cash !== null) return `+${formatKrw(q.reward_cash)}`
  if (q.reward_badge !== null) return '🏅 뱃지'
  return ''
}

interface QuestCardProps {
  quest: Quest
  claiming: boolean
  onClaim: () => void
}

function QuestCard({ quest, claiming, onClaim }: QuestCardProps) {
  const done = Math.min(quest.progress, quest.target)
  const pct = quest.target > 0 ? (done / quest.target) * 100 : 0
  return (
    <Card as="article">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{quest.title}</h3>
          <p className="mt-0.5 text-sm text-ink-muted">{quest.description}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-up">{rewardLabel(quest)}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={quest.target}
          aria-valuenow={done}
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-10 text-right text-xs text-ink-muted tabular-nums">
          {done}/{quest.target}
        </span>
      </div>
      <div className="mt-3 flex justify-end">
        {quest.claimed ? (
          <Button variant="secondary" disabled>
            받음 ✓
          </Button>
        ) : quest.completed ? (
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

// 퀘스트 모달 — Q1~Q3 진행률·보상 수령·보유 뱃지. 로그인 전용(GamePage 가 비로그인 시 LoginModal 로 분기).
export default function QuestModal({ onClose }: { onClose: () => void }) {
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading)
  const pushToast = useTradingGameStore((s) => s.pushToast)
  const [state, setState] = useState<Load<QuestList>>({ kind: 'loading' })
  const [claiming, setClaiming] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    getQuests()
      .then((data) => {
        if (!cancelled) setState({ kind: 'ok', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const claim = async (code: string) => {
    if (claiming !== null) return
    const gen = currentPrivateGen()
    setClaiming(code)
    try {
      const res = await claimQuest(code)
      setState((s) => {
        if (s.kind !== 'ok') return s
        const quests = s.data.quests.map((q) => (q.code === res.quest.code ? res.quest : q))
        const badge = res.badge
        const badges = badge && !s.data.badges.some((b) => b.code === badge.code) ? [...s.data.badges, badge] : s.data.badges
        return { kind: 'ok', data: { quests, badges } }
      })
      if (gen === currentPrivateGen()) {
        void refreshTrading() // 현금 보상 → 헤더 자본금 반영
        pushToast({ kind: 'info', icon: '🎁', message: '보상을 받았어요' })
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) })
    } finally {
      setClaiming(null)
    }
  }

  return (
    <Modal title="🎯 퀘스트" onClose={onClose}>
      {state.kind === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {state.kind === 'error' && (
        <div className="py-10 text-center">
          <p className="text-sm text-ink-muted">{state.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            다시 시도
          </Button>
        </div>
      )}
      {state.kind === 'ok' && (
        <div className="space-y-3">
          {state.data.quests.map((q) => (
            <QuestCard key={q.code} quest={q} claiming={claiming === q.code} onClaim={() => void claim(q.code)} />
          ))}
          {state.data.badges.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 text-sm font-semibold text-ink">보유 뱃지</p>
              <div className="flex flex-wrap gap-2">
                {state.data.badges.map((b) => (
                  <Chip key={b.code} active>
                    🏅 {b.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
