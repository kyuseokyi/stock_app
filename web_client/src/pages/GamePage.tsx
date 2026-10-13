import EmptyState from '../components/ui/EmptyState'

// 게임 스켈레톤 — 백엔드(트레이딩 게임 Phase 1~5) 후 실제 화면으로 교체
export default function GamePage() {
  return (
    <EmptyState
      emoji="🎮"
      title="시즌을 준비하고 있어요"
      description="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
    />
  )
}
