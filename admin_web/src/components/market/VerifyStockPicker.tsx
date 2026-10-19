import { useEffect, useState } from 'react'
import { searchStocks } from '../../api/stockClient'
import type { Stock } from '../../types/stock'

const DEBOUNCE_MS = 300
const MAX_RESULTS = 8
const TICKER_RE = /^[0-9A-Za-z]{6}$/

interface Props {
  onPick: (ticker: string) => void
}

// 국내 종목 검색(기존 GraphQL searchStocks 재사용, StockSearchAdd 와 같은 디바운스).
// 6자리 코드를 치고 Enter 를 누르면 검색 결과 없이도 바로 조회한다(상장폐지 종목 확인용).
export default function VerifyStockPicker({ onPick }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      setSearched(false)
      return
    }
    let alive = true
    setSearched(false)
    const timer = window.setTimeout(() => {
      setSearching(true)
      searchStocks(q)
        .then((rows) => {
          if (alive) setResults(rows.filter((r) => r.country === 'KR').slice(0, MAX_RESULTS))
        })
        .catch(() => {
          if (alive) setResults([])
        })
        .finally(() => {
          if (alive) {
            setSearching(false)
            setSearched(true)
          }
        })
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query])

  const pick = (ticker: string) => {
    onPick(ticker.toUpperCase())
    setQuery('')
    setResults([])
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        value={query}
        aria-label="종목 검색"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && TICKER_RE.test(query.trim())) pick(query.trim())
        }}
        placeholder="종목명 또는 6자리 코드(Enter)"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      {query.trim() && searching && <p className="mt-1 text-xs text-slate-400">검색 중…</p>}
      {query.trim() && !searching && searched && results.length === 0 && (
        <p className="mt-1 text-xs text-slate-400">국내 종목 결과가 없어요</p>
      )}
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onClick={() => pick(r.symbol)}
                className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 text-xs text-slate-400">{r.symbol}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
