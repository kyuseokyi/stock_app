import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchStocks, type StockHit } from '../../api/stockSearch'

const DEBOUNCE_MS = 250

// 종목 검색창 — 이름·코드 부분 일치(국내만), 고르면 /stock/:ticker 로. 위·아래 화살표 + Enter, Esc 로 닫기.
export default function StockSearch() {
  const navigate = useNavigate()
  const listId = useId()
  const [text, setText] = useState('')
  const [hits, setHits] = useState<StockHit[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [failed, setFailed] = useState(false)
  const reqRef = useRef(0)

  useEffect(() => {
    const q = text.trim()
    if (!q) {
      setHits([])
      setFailed(false)
      return
    }
    const id = ++reqRef.current
    const timer = setTimeout(() => {
      searchStocks(q, 8)
        .then((rows) => {
          if (id !== reqRef.current) return // 늦게 온 이전 검색 응답은 버린다
          setHits(rows)
          setFailed(false)
          setActive(rows.length > 0 ? 0 : -1)
        })
        .catch(() => id === reqRef.current && setFailed(true))
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const go = (hit: StockHit) => {
    setText('')
    setHits([])
    setOpen(false)
    navigate(`/stock/${encodeURIComponent(hit.symbol)}`)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(hits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && active >= 0 && hits[active]) {
      e.preventDefault()
      go(hits[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && text.trim() !== ''
  return (
    <div className="relative">
      <input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // 목록 클릭(onMouseDown)이 먼저 처리되도록 닫기를 미룬다
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder="종목 이름 또는 코드 검색"
        aria-label="종목 검색"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        className="w-full rounded-field border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-field border border-line bg-surface py-1 shadow-lg"
        >
          {failed ? (
            <li className="px-3 py-2 text-sm text-ink-muted">검색하지 못했어요. 잠시 후 다시 시도해 주세요</li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">찾는 종목이 없어요</li>
          ) : (
            hits.map((h, i) => (
              <li
                key={h.symbol}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  go(h)
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-baseline justify-between gap-2 px-3 py-2 text-sm ${i === active ? 'bg-fill' : ''}`}
              >
                <span className="truncate font-medium text-ink">{h.name}</span>
                <span className="shrink-0 text-xs text-ink-muted">{h.symbol} · {h.market}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
