import { useState, type ReactNode } from 'react'
import Button from '../ui/Button'
import { chipClass } from '../ui/Chip'
import { BB_SIGMAS, DEFAULT_FINDER_FILTERS, fromDraft, sigmaLabel, toDraft } from '../../lib/finder'
import type { BbPosition, FinderDraft, FinderFilters as Filters, MaOrderFilter, NumKey } from '../../types/finder'
import type { MarketFilter } from '../../types/screener'

const MARKETS: { key: MarketFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  { key: 'KOSPI', label: 'KOSPI' },
  { key: 'KOSDAQ', label: 'KOSDAQ' },
]
const MA_ORDERS: { key: MaOrderFilter | null; label: string }[] = [
  { key: null, label: '무관' },
  { key: 'PERFECT', label: '정배열' },
  { key: 'REVERSE', label: '역배열' },
]
const BB_POSITIONS: { key: BbPosition | null; label: string }[] = [
  { key: null, label: '무관' },
  { key: 'ABOVE', label: '상단 돌파' },
  { key: 'BELOW', label: '하단 이탈' },
  { key: 'INSIDE', label: '밴드 안' },
]

// 한 줄 — 왼쪽 제목 + 오른쪽 입력들(좁은 화면에서는 줄바꿈)
function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-xs font-medium text-ink-muted">{title}</span>
      {children}
    </div>
  )
}

// 숫자 입력 한 칸 — 빈칸이면 조건 없음
function NumField({ label, value, unit, onChange }: { label: string; value: string; unit?: string; onChange: (v: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={label}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded-btn bg-fill px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted/70 focus:outline-none focus:ring-1 focus:ring-brand"
      />
      {unit && <span className="text-xs text-ink-muted">{unit}</span>}
    </span>
  )
}

interface Props {
  value: Filters
  onApply: (f: Filters) => void
}

// 커스텀 필터 패널 — 초안만 바꾸고 [적용]에서 반영. [초기화]는 초안을 기본값으로(적용은 따로). 패널을 닫으면 초안은 버린다.
export default function FinderFilters({ value, onApply }: Props) {
  const [draft, setDraft] = useState<FinderDraft>(() => toDraft(value))
  const set = (patch: Partial<FinderDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const num = (key: NumKey, label: string, unit?: string) => (
    <NumField label={label} unit={unit} value={draft[key]} onChange={(v) => set({ [key]: v } as Partial<FinderDraft>)} />
  )

  return (
    <div className="space-y-3">
      <Row title="시장">
        {MARKETS.map((m) => (
          <button key={m.key} type="button" aria-pressed={draft.market === m.key} className={chipClass(draft.market === m.key)} onClick={() => set({ market: m.key })}>
            {m.label}
          </button>
        ))}
      </Row>
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" checked={draft.liquidOnly} onChange={(e) => set({ liquidOnly: e.target.checked })} />
        거래가 활발한 종목만(하루 평균 거래대금 10억 원·주가 1,000원 이상)
      </label>
      <Row title="가격">{num('priceMin', '최소', '원')}<span className="text-ink-muted">~</span>{num('priceMax', '최대', '원')}</Row>
      <Row title="시가총액">{num('mcapMin', '최소', '억')}<span className="text-ink-muted">~</span>{num('mcapMax', '최대', '억')}</Row>
      <Row title="거래대금">{num('valueMin', '최소', '억 이상')}</Row>
      <Row title="거래량(20일 평균 대비)">{num('volRatioMin', '예: 2', '배 이상')}</Row>
      <Row title="RSI(14)">{num('rsiMin', '최소')}<span className="text-ink-muted">~</span>{num('rsiMax', '최대')}</Row>
      <Row title="이동평균 배열">
        {MA_ORDERS.map((m) => (
          <button key={m.label} type="button" aria-pressed={draft.maOrder === m.key} className={chipClass(draft.maOrder === m.key)} onClick={() => set({ maOrder: m.key })}>
            {m.label}
          </button>
        ))}
      </Row>
      <Row title="볼린저 σ">
        {BB_SIGMAS.map((s) => (
          <button key={s} type="button" aria-pressed={draft.bbSigma === s} className={chipClass(draft.bbSigma === s)} onClick={() => set({ bbSigma: s })}>
            {sigmaLabel(s)}
          </button>
        ))}
      </Row>
      <Row title="볼린저 위치">
        {BB_POSITIONS.map((p) => (
          <button key={p.label} type="button" aria-pressed={draft.bbPosition === p.key} className={chipClass(draft.bbPosition === p.key)} onClick={() => set({ bbPosition: p.key })}>
            {p.label}
          </button>
        ))}
      </Row>
      <Row title="볼린저 밴드폭">{num('bbWidthMax', '예: 10', '% 이하')}</Row>
      <Row title="위쪽 매물(120일)">{num('vpAboveMax', '예: 20', '% 이하')}</Row>
      <Row title="ROE">{num('roeMin', '최소', '% 이상')}</Row>
      <Row title="PER">{num('perMin', '최소', '배')}<span className="text-ink-muted">~</span>{num('perMax', '최대', '배')}</Row>
      <Row title="PBR">{num('pbrMin', '최소', '배')}<span className="text-ink-muted">~</span>{num('pbrMax', '최대', '배')}</Row>
      <Row title="부채비율">{num('debtRatioMax', '최대', '% 이하')}</Row>
      <Row title="매출 성장률">{num('salesGrowthMin', '최소', '% 이상')}</Row>
      <p className="text-xs text-ink-muted">재무(ROE·PER·PBR·부채비율·매출 성장률)는 최신 연간 결산 기준이에요. 빈칸은 조건 없음.</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setDraft(toDraft(DEFAULT_FINDER_FILTERS))}>초기화</Button>
        <Button onClick={() => onApply(fromDraft(draft))}>적용</Button>
      </div>
    </div>
  )
}
