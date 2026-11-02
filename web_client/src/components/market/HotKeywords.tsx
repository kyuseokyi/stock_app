import { useState } from 'react'
import { Link } from 'react-router-dom'
import { chipClass } from '../ui/Chip'
import Modal from '../ui/Modal'
import type { HotKeyword } from '../../types/marketRest'

// 핫 키워드 칩 — 누르면 배경 설명·관련 종목(이름을 아는 종목은 이름으로). names: 급등락·수급에서 모은 티커 → 종목명
export default function HotKeywords({ keywords, names }: { keywords: HotKeyword[]; names: Map<string, string> }) {
  const [open, setOpen] = useState<HotKeyword | null>(null)
  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {keywords.map((k) => (
          <li key={k.keyword}>
            <button type="button" aria-haspopup="dialog" onClick={() => setOpen(k)} className={chipClass(false)}>#{k.keyword}</button>
          </li>
        ))}
      </ul>
      {open && (
        <Modal title={`#${open.keyword}`} onClose={() => setOpen(null)}>
          <div className="space-y-3">
            {open.background && <p className="text-sm text-ink">{open.background}</p>}
            {open.tickers.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-semibold text-ink-muted">관련 종목</h3>
                <ul className="divide-y divide-line">
                  {open.tickers.map((t) => (
                    <li key={t}>
                      <Link to={`/stock/${encodeURIComponent(t)}`} className="flex min-h-11 items-center justify-between gap-2 hover:bg-fill/60">
                        <span className="min-w-0 truncate text-sm font-medium text-ink">{names.get(t) ?? t}</span>
                        <span className="shrink-0 text-xs text-ink-muted">{t} ›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
