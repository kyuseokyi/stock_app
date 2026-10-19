import { useEffect, useState } from 'react'
import { searchStocks } from '../../api/stockClient'
import type { Stock } from '../../types/stock'

const DEBOUNCE_MS = 300
const MAX_RESULTS = 8

interface Props {
  disabled: boolean
  existing: string[] // 이미 포함된(제외 아님) 종목 코드
  onAdd: (ticker: string, reason: string | null) => Promise<boolean>
}

// 국내 종목만(테마는 국내 보통주 대상). 검색은 기존 GraphQL searchStocks 재사용.
export default function StockSearchAdd({ disabled, existing, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [picked, setPicked] = useState<Stock | null>(null)
  const [reason, setReason] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false) // 마지막 검색이 끝났는지

  useEffect(() => {
    const q = query.trim()
    if (picked || !q) {
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
  }, [query, picked])

  const submit = async () => {
    if (!picked) return
    if (await onAdd(picked.symbol, reason.trim() || null)) {
      setPicked(null)
      setQuery('')
      setReason('')
    }
  }

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="mb-2 text-sm font-semibold text-slate-700">종목 추가</p>
      {picked ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm">
            <b>{picked.name}</b> <span className="text-xs text-slate-400">{picked.symbol}</span>
          </span>
          <input
            value={reason}
            aria-label="편입 사유"
            onChange={(e) => setReason(e.target.value)}
            placeholder="편입 사유(선택) — 예: HBM 장비 공급"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void submit()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              추가
            </button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <input
            value={query}
            aria-label="종목 검색"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="종목명 또는 코드 검색"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {query.trim() && searching && <p className="mt-1 text-xs text-slate-400">검색 중…</p>}
          {query.trim() && !searching && searched && results.length === 0 && (
            <p className="mt-1 text-xs text-slate-400">국내 종목 결과가 없어요</p>
          )}
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((r) => {
                const already = existing.includes(r.symbol)
                return (
                  <li key={r.symbol}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => {
                        setPicked(r)
                        setResults([])
                      }}
                      className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40"
                    >
                      <span>
                        {r.name} <span className="text-xs text-slate-400">{r.symbol}</span>
                      </span>
                      {already && <span className="text-xs text-slate-500">이미 포함</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
