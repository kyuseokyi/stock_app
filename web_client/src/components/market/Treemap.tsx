import { useEffect, useRef, useState } from 'react'
import { formatPct } from '../../lib/format'
import { chgColor, chgTextColor, squarify } from '../../lib/treemap'
import type { TreemapGroup } from '../../types/market'

interface Props {
  groups: TreemapGroup[]
  period: string
  /** 그룹 안에 종목 타일까지(넓은 화면). false 면 그룹 타일만 → 누르면 그 그룹 종목으로 들어간다 */
  nested: boolean
  height: number
  /** 그룹(넓은 화면: 머리글, 좁은 화면: 종목 보기 머리글의 '자세히')을 눌렀을 때 */
  onGroupSelect?: (id: string) => void
  note?: string
}

const HEADER = 18

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

function Tile({ x, y, w, h, label, chg, period, onClick, title }: {
  x: number; y: number; w: number; h: number; label: string; chg: number | null; period: string
  onClick?: () => void; title: string
}) {
  // 글자는 12px 고정 — 안 들어가는 작은 칸은 글자를 숨기고 title·aria-label 로만 알린다(10px 로 줄이지 않음)
  const showText = w > 52 && h > 20
  const big = w > 90 && h > 44
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={!onClick}
      className="absolute overflow-hidden border border-surface text-left leading-tight disabled:cursor-default"
      style={{ left: x, top: y, width: w, height: h, background: chgColor(chg, period), color: chgTextColor(chg, period) }}
    >
      {showText && (
        <span className={`block truncate px-1 pt-0.5 ${big ? 'text-xs font-bold' : 'text-xs font-medium'}`}>{label}</span>
      )}
      {showText && h > 36 && (
        <span className="block truncate px-1 text-xs">{chg == null ? '—' : formatPct(chg)}</span>
      )}
    </button>
  )
}

// 트리맵 — 면적 = 시총 또는 거래대금, 색 = 등락률. 라이브러리 없이 squarify 좌표로 그린다.
export default function Treemap({ groups, period, nested, height, onGroupSelect, note }: Props) {
  const { ref, width } = useWidth()
  const [drill, setDrill] = useState<string | null>(null)
  useEffect(() => setDrill(null), [groups, nested])

  const current = drill ? groups.find((g) => g.id === drill) : undefined
  const rect = { x: 0, y: 0, w: width, h: height }
  const tiles: JSX.Element[] = []

  if (width > 0 && current) {
    for (const p of squarify(current.stocks.map((s, i) => ({ id: String(i), size: s.size })), rect)) {
      const s = current.stocks[Number(p.id)]
      tiles.push(<Tile key={p.id} {...p} label={s.name} chg={s.chg} period={period} title={`${s.name} ${s.chg == null ? '' : formatPct(s.chg)}`} />)
    }
  } else if (width > 0) {
    for (const p of squarify(groups.map((g) => ({ id: g.id, size: g.size })), rect)) {
      const g = groups.find((x) => x.id === p.id)!
      const title = `${g.name} ${g.chg == null ? '' : formatPct(g.chg)}`
      if (nested && p.w > 60 && p.h > HEADER + 24) {
        tiles.push(
          <button key={`h${g.id}`} type="button" title={title} onClick={() => onGroupSelect?.(g.id)}
            className="absolute truncate border border-surface bg-ink/80 px-1 text-left text-xs font-bold text-white"
            style={{ left: p.x, top: p.y, width: p.w, height: HEADER }}>
            {g.name} {g.chg == null ? '' : formatPct(g.chg)}
          </button>,
        )
        const inner = { x: p.x, y: p.y + HEADER, w: p.w, h: p.h - HEADER }
        for (const q of squarify(g.stocks.map((s, i) => ({ id: String(i), size: s.size })), inner)) {
          const s = g.stocks[Number(q.id)]
          tiles.push(<Tile key={`${g.id}-${q.id}`} {...q} label={s.name} chg={s.chg} period={period}
            title={`${g.name} · ${s.name} ${s.chg == null ? '' : formatPct(s.chg)}`} onClick={() => onGroupSelect?.(g.id)} />)
        }
      } else {
        tiles.push(<Tile key={g.id} {...p} label={g.name} chg={g.chg} period={period} title={title}
          onClick={() => (nested ? onGroupSelect?.(g.id) : setDrill(g.id))} />)
      }
    }
  }

  return (
    <div>
      {current && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <button type="button" onClick={() => setDrill(null)} className="rounded-btn bg-fill px-3 py-1.5 text-sm font-medium text-ink">
            ← 전체
          </button>
          <span className="truncate text-sm font-bold text-ink">{current.name}</span>
          {onGroupSelect ? (
            <button type="button" onClick={() => onGroupSelect(current.id)} className="shrink-0 text-sm font-medium text-brand-strong">
              자세히
            </button>
          ) : <span />}
        </div>
      )}
      <div ref={ref} className="relative w-full overflow-hidden rounded-btn bg-fill" style={{ height }}>
        {tiles}
      </div>
      {note && <p className="mt-1.5 text-xs text-ink-muted">{note}</p>}
    </div>
  )
}
