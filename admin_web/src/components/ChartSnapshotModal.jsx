import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { getChartData, searchStocks } from '../api/stockClient'

// 기본 조회 기간: 최근 3개월
function defaultRange() {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - 3)
  const iso = (d) => d.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}

const MARKET_BADGE = {
  KOSPI: 'bg-red-50 text-red-600',
  KOSDAQ: 'bg-orange-50 text-orange-600',
  NASDAQ: 'bg-blue-50 text-blue-600',
  NYSE: 'bg-indigo-50 text-indigo-600',
  INDEX: 'bg-emerald-50 text-emerald-600',
}

function buildOption(chart) {
  const dates = chart.candles.map((c) => c.date.slice(5)) // MM-DD
  const candles = chart.candles.map((c) => [c.open, c.close, c.low, c.high])
  return {
    animation: false,
    grid: { left: 55, right: 20, top: 45, bottom: 30 },
    title: {
      text: `${chart.name} (${chart.symbol})`,
      left: 'center',
      textStyle: { fontSize: 14 },
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { data: ['캔들', 'MA5', 'MA20'], top: 22, right: 10 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#94a3b8' } },
    },
    yAxis: { scale: true, splitLine: { lineStyle: { color: '#f1f5f9' } } },
    series: [
      {
        name: '캔들',
        type: 'candlestick',
        data: candles,
        itemStyle: {
          color: '#ef4444',
          color0: '#3b82f6',
          borderColor: '#ef4444',
          borderColor0: '#3b82f6',
        },
      },
      {
        name: 'MA5',
        type: 'line',
        data: chart.ma5,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: '#f59e0b' },
      },
      {
        name: 'MA20',
        type: 'line',
        data: chart.ma20,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, color: '#8b5cf6' },
      },
    ],
  }
}

export default function ChartSnapshotModal({ open, onClose, onInsert }) {
  const chartRef = useRef(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [range, setRange] = useState(defaultRange)
  const [chart, setChart] = useState(null)
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 검색어 debounce → searchStocks
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      searchStocks(query.trim())
        .then(setResults)
        .catch(() => setError('종목 검색에 실패했습니다. (stock_api 8002 확인)'))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const loadChart = async (stock, r) => {
    setLoading(true)
    setError('')
    try {
      const data = await getChartData(stock.symbol, r.start, r.end)
      if (!data || data.candles.length === 0) {
        setChart(null)
        setError('해당 기간의 데이터가 없습니다.')
      } else {
        setChart(data)
      }
    } catch {
      setError('차트 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (stock) => {
    setSelected(stock)
    setResults([])
    setQuery(stock.name)
    loadChart(stock, range)
  }

  const handleRangeChange = (field, val) => {
    const next = { ...range, [field]: val }
    setRange(next)
    if (selected) loadChart(selected, next)
  }

  const option = useMemo(() => (chart ? buildOption(chart) : null), [chart])

  if (!open) return null

  const handleInsert = () => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const dataURL = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
    onInsert(dataURL)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">차트 삽입 — 종목 검색</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 검색 */}
        <div className="relative">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelected(null)
            }}
            placeholder="국내외 종목·지수 검색 (예: 삼성, AAPL, KOSPI)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {!selected && results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.map((s) => (
                <li key={s.symbol}>
                  <button
                    onClick={() => handleSelect(s)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-800">
                      {s.name} <span className="text-slate-400">{s.symbol}</span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        MARKET_BADGE[s.market] || 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {s.market}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searching && !selected && (
            <p className="absolute right-3 top-2.5 text-xs text-slate-400">검색 중…</p>
          )}
        </div>

        {/* 기간 */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="text-slate-500">기간</label>
          <input
            type="date"
            value={range.start}
            onChange={(e) => handleRangeChange('start', e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1"
          />
          <span className="text-slate-400">~</span>
          <input
            type="date"
            value={range.end}
            onChange={(e) => handleRangeChange('end', e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1"
          />
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {/* 차트 */}
        <div className="mt-3 min-h-[320px] flex-1 rounded-lg border border-slate-200">
          {loading ? (
            <p className="py-32 text-center text-sm text-slate-400">차트 불러오는 중…</p>
          ) : option ? (
            <ReactECharts ref={chartRef} option={option} style={{ height: 320, width: '100%' }} />
          ) : (
            <p className="py-32 text-center text-sm text-slate-400">
              종목을 검색해 선택하면 차트가 표시됩니다.
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            onClick={handleInsert}
            disabled={!chart}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            본문에 삽입
          </button>
        </div>
      </div>
    </div>
  )
}
