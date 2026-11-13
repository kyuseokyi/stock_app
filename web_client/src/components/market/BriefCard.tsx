import { useState } from 'react'
import Card from '../ui/Card'
import Modal from '../ui/Modal'
import { AI_NOTICE } from './SectionHead'
import NewsSources from '../ai/NewsSources'
import { formatShortDate } from '../../lib/marketDashboard'
import type { MorningBrief, SectorNote } from '../../types/marketRest'

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {children}
    </section>
  )
}

function Sectors({ title, items, cls }: { title: string; items: SectorNote[]; cls: string }) {
  if (items.length === 0) return null
  return (
    <Block title={title}>
      <ul className="space-y-1.5">
        {items.map((s) => (
          <li key={s.sector}>
            <div className={`text-sm font-bold ${cls}`}>{s.sector}</div>
            {s.reason && <div className="text-sm text-ink-muted">{s.reason}</div>}
          </li>
        ))}
      </ul>
    </Block>
  )
}

// AI 장전 브리핑 — 블루 배너에 헤드라인만, 누르면 수혜·주의 섹터·체크포인트·요약(앱 BriefCard 와 같은 구성).
export default function BriefCard({ brief }: { brief: MorningBrief }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Card as="section" aria-label="AI 장전 브리핑" padding="none" className="bg-sky-soft">
        <button type="button" onClick={() => setOpen(true)} className="block w-full rounded-card p-4 text-left">
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold text-brand-strong">AI 장전 브리핑 (08:30)</span>
            {brief.date && <span className="text-xs text-ink-muted">{formatShortDate(brief.date)}</span>}
          </span>
          <span className="mt-2 block text-pretty text-base font-bold text-ink">{brief.headline}</span>
          <span className="mt-1 block text-sm font-semibold text-brand-strong">수혜·주의 섹터 보기 ›</span>
        </button>
        {/* 근거 기사 — 버튼 밖 형제(버튼 안에 링크 금지) */}
        <NewsSources sources={brief.sources} className="-mt-1 px-4 pb-4" />
      </Card>
      {open && (
        <Modal title="AI 장전 브리핑" onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-pretty text-base font-bold text-ink">{brief.headline}</p>
            <Sectors title="수혜 예상 섹터" items={brief.bullishSectors} cls="text-up" />
            <Sectors title="주의 섹터" items={brief.bearishSectors} cls="text-down" />
            {brief.macroCheckpoints.length > 0 && (
              <Block title="환율·금리 체크포인트">
                <ul className="list-inside list-disc space-y-1 text-sm text-ink">
                  {brief.macroCheckpoints.map((c, i) => <li key={`${i}-${c}`}>{c}</li>)}
                </ul>
              </Block>
            )}
            {brief.usMarketSummary && (
              <Block title="밤사이 미국 증시"><p className="text-sm text-ink">{brief.usMarketSummary}</p></Block>
            )}
            {brief.krImpactSummary && (
              <Block title="오늘 국내 증시 영향"><p className="text-sm text-ink">{brief.krImpactSummary}</p></Block>
            )}
            <p className="text-xs text-ink-muted">{AI_NOTICE}</p>
          </div>
        </Modal>
      )}
    </>
  )
}
