// 실시간 게임과 교육용 종가 게임이 둘 다 열려 있을 때(/game) 상단 전환 탭 — 명세 3.2-2
export type GameMode = 'edu' | 'realtime'

export default function GameModeTabs({ mode, onChange }: { mode: GameMode; onChange: (m: GameMode) => void }) {
  const tab = (m: GameMode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => onChange(m)}
      className={`flex-1 rounded-full px-3 py-2 text-sm font-bold transition ${
        mode === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div role="tablist" aria-label="게임 종류" className="flex gap-1 rounded-full bg-fill p-1">
      {tab('edu', '📘 일일 종가 게임')}
      {tab('realtime', '⚡ 실시간 게임')}
    </div>
  )
}
