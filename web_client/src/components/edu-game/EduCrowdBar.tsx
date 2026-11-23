import type { EduCrowd } from '../../types/eduGame'

// 오늘 참가자 선택 비율 바 — 상승(up)·하락(down)·관망(회색). 아무도 없으면 안내 문구.
export default function EduCrowdBar({ crowd }: { crowd: EduCrowd | null }) {
  if (!crowd || crowd.total === 0) {
    return <p className="text-sm text-ink-muted">아직 오늘 결정을 낸 참가자가 없어요.</p>
  }
  const seg = [
    { key: 'long', label: '상승', pct: crowd.long_pct, cls: 'bg-up' },
    { key: 'short', label: '하락', pct: crowd.short_pct, cls: 'bg-down' },
    { key: 'watch', label: '관망', pct: crowd.watch_pct, cls: 'bg-ink-muted/40' },
  ]
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-fill" aria-hidden>
        {seg.map((s) => (s.pct > 0 ? <div key={s.key} className={s.cls} style={{ width: `${s.pct}%` }} /> : null))}
      </div>
      <p className="mt-1.5 text-sm text-ink">
        <span className="text-up">상승 {Math.round(crowd.long_pct)}%</span>
        {' · '}
        <span className="text-down">하락 {Math.round(crowd.short_pct)}%</span>
        {' · '}
        <span className="text-ink-muted">관망 {Math.round(crowd.watch_pct)}%</span>
        <span className="ml-1 text-xs text-ink-muted">({crowd.total.toLocaleString('ko-KR')}명)</span>
      </p>
    </div>
  )
}
