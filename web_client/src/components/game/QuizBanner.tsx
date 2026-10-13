// 장 마감 후(KST 15:30~24:00)·주말 강조 배너 — 클릭 시 야간 차트 퀴즈 모달.
export default function QuizBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-card bg-brand-soft px-4 py-3 text-left transition hover:brightness-95"
    >
      <span>
        <span className="block text-sm font-bold text-brand">🧩 야간 10초 차트 퀴즈 도전!</span>
        <span className="mt-0.5 block text-xs text-ink-muted">차트만 보고 5일 뒤 방향을 맞혀 보세요</span>
      </span>
      <span className="text-brand">›</span>
    </button>
  )
}
