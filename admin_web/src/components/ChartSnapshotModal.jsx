import { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { getChartData, searchStocks } from '../api/stockClient'
import { useChartDrawings } from '../hooks/useChartDrawings'

const clampIdx = (i, len) => Math.max(0, Math.min(len - 1, Math.round(i)))

// 드로잉 도형(데이터좌표) → ECharts markLine/markArea/markPoint 로 변환.
// 데이터 좌표 native 라 리로드/리사이즈에도 정합, getDataURL 캡처에 포함된다.
function buildMarks(chart, shapes, preview) {
  const dates = chart.candles.map((c) => c.date.slice(5))
  const digits = chart.currency === 'KRW' ? 0 : 2
  const fmt = (v) =>
    Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })

  const hlines = shapes.filter((s) => s.type === 'hline')
  const rects = shapes.filter((s) => s.type === 'rect')
  const texts = shapes.filter((s) => s.type === 'text')
  const allRects = preview ? [...rects, preview] : rects

  const markLine = hlines.length
    ? {
        symbol: 'none',
        silent: true,
        data: hlines.map((h) => ({
          yAxis: h.price,
          label: { formatter: fmt(h.price), position: 'end', color: '#e11d48' },
        })),
        lineStyle: { color: '#e11d48', width: 1.2 },
      }
    : undefined

  const markArea = allRects.length
    ? {
        silent: true,
        itemStyle: {
          color: 'rgba(59,130,246,0.12)',
          borderColor: '#3b82f6',
          borderWidth: 1,
        },
        data: allRects.map((r) => [
          { xAxis: dates[clampIdx(r.xi1, dates.length)], yAxis: Math.max(r.y1, r.y2) },
          { xAxis: dates[clampIdx(r.xi2, dates.length)], yAxis: Math.min(r.y1, r.y2) },
        ]),
      }
    : undefined

  const markPoint = texts.length
    ? {
        symbol: 'circle',
        symbolSize: 5,
        itemStyle: { color: '#0f172a' },
        data: texts.map((t) => ({
          coord: [dates[clampIdx(t.xi, dates.length)], t.price],
          value: t.text,
          label: {
            formatter: t.text,
            position: 'top',
            color: '#0f172a',
            backgroundColor: 'rgba(255,255,255,0.85)',
            borderColor: '#94a3b8',
            borderWidth: 1,
            borderRadius: 3,
            padding: [2, 4],
            fontSize: 12,
          },
        })),
      }
    : undefined

  return { markLine, markArea, markPoint }
}

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

const MA_ORDER_BADGE = {
  PERFECT: { label: '정배열', cls: 'bg-red-50 text-red-600' },
  REVERSE: { label: '역배열', cls: 'bg-blue-50 text-blue-600' },
  MIXED: { label: '혼조', cls: 'bg-slate-100 text-slate-500' },
}

// 매물대(Volume Profile): 우측에 가격대별 누적 거래량을 반투명 가로막대로 렌더
function volumeProfileSeries(vp) {
  const maxVol = Math.max(1, ...vp.map((b) => b.volume))
  return {
    name: '매물대',
    type: 'custom',
    z: 1,
    silent: true,
    // y축(가격) 범위를 왜곡하지 않도록 데이터는 '가격값'으로 둔다.
    // (거래량은 아래 renderItem에서 클로저의 vp로 읽음)
    data: vp.map((b) => b.priceHigh),
    renderItem: (params, api) => {
      const bin = vp[params.dataIndex]
      const yHigh = api.coord([0, bin.priceHigh])[1]
      const yLow = api.coord([0, bin.priceLow])[1]
      const cs = params.coordSys
      const w = (bin.volume / maxVol) * (cs.width * 0.28)
      const top = Math.min(yHigh, yLow)
      const h = Math.max(1, Math.abs(yLow - yHigh) - 1)
      // 좌측 끝(cs.x)에서 오른쪽으로 뻗는 가로막대
      return {
        type: 'rect',
        shape: { x: cs.x, y: top, width: w, height: h },
        style: { fill: 'rgba(100,116,139,0.28)' },
      }
    },
  }
}

// 이중 추세선(평행 채널): 기준선 P1-P2 + 폭(widthPct, 기준가 대비 %)로 평행선 지정.
// 폭 부호로 위/아래 방향 결정, 중심선은 두 선의 중간. 구간 [iL,iR]에만 값(밖은 null).
function computeChannelLines(ch, dates) {
  const n = dates.length
  const { x1, y1, x2, y2, widthPct = 2 } = ch
  if (Math.abs(x2 - x1) < 0.5) return null // 수직/퇴화 방지
  const m = (y2 - y1) / (x2 - x1)
  const base = (i) => y1 + m * (i - x1)
  const ref = (y1 + y2) / 2 // 기준가(폭 % 산정용)
  const dy = ref * (widthPct / 100)
  const iL = clampIdx(Math.min(x1, x2), n)
  const iR = clampIdx(Math.max(x1, x2), n)

  const mk = (offset) =>
    dates.map((_, i) => (i >= iL && i <= iR ? Math.round((base(i) + offset) * 100) / 100 : null))
  return { baseLine: mk(0), parallel: mk(dy), center: mk(dy / 2) }
}

function channelSeries(chart, channels, previewChannel) {
  const dates = chart.candles.map((c) => c.date.slice(5))
  const all = previewChannel ? [...channels, previewChannel] : channels
  const out = []
  all.forEach((ch, idx) => {
    const lines = computeChannelLines(ch, dates)
    if (!lines) return
    const seg = (suffix, data, type) => ({
      name: `_ch${idx}_${suffix}`, // legend.data 에 없으므로 범례엔 숨김
      type: 'line',
      data,
      showSymbol: false,
      silent: true,
      connectNulls: false,
      lineStyle: { color: '#2563eb', width: 1.3, type },
    })
    out.push(seg('base', lines.baseLine, 'solid'))
    out.push(seg('par', lines.parallel, 'solid'))
    out.push(seg('mid', lines.center, 'dashed'))
  })
  return out
}

function buildOption(chart, shapes = [], preview = null, channelPreview = null) {
  const dates = chart.candles.map((c) => c.date.slice(5)) // MM-DD
  const candles = chart.candles.map((c) => [c.open, c.close, c.low, c.high])
  const bb = chart.bollinger
  const { markLine, markArea, markPoint } = buildMarks(chart, shapes, preview)
  const channels = shapes.filter((s) => s.type === 'channel')
  const chSeries = channelSeries(chart, channels, channelPreview)
  return {
    animation: false,
    grid: { left: 15, right: 60, top: 45, bottom: 30 },
    title: {
      text: `${chart.name} (${chart.symbol})`,
      left: 'center',
      textStyle: { fontSize: 14 },
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: {
      data: ['캔들', 'MA5', 'MA20', 'MA50', 'MA120', 'BB상단', 'BB하단', '매물대'],
      top: 22,
      right: 10,
      type: 'scroll',
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#94a3b8' } },
    },
    yAxis: {
      scale: true,
      position: 'right',
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    series: [
      volumeProfileSeries(chart.volumeProfile),
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
        markLine,
        markArea,
        markPoint,
      },
      { name: 'MA5', type: 'line', data: chart.ma5, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#f59e0b' } },
      { name: 'MA20', type: 'line', data: chart.ma20, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#8b5cf6' } },
      { name: 'MA50', type: 'line', data: chart.ma50, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#10b981' } },
      { name: 'MA120', type: 'line', data: chart.ma120, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#64748b' } },
      {
        name: 'BB상단',
        type: 'line',
        data: bb?.upper ?? [],
        showSymbol: false,
        lineStyle: { width: 1, type: 'solid', color: '#0ea5e9' },
      },
      {
        name: 'BB중심',
        type: 'line',
        data: bb?.mid ?? [],
        showSymbol: false,
        lineStyle: { width: 1, type: 'solid', color: '#0ea5e9', opacity: 0.6 },
      },
      {
        name: 'BB하단',
        type: 'line',
        data: bb?.lower ?? [],
        showSymbol: false,
        lineStyle: { width: 1, type: 'solid', color: '#0ea5e9' },
        areaStyle: undefined,
      },
      ...chSeries,
    ],
  }
}

export default function ChartSnapshotModal({ open, onClose, onInsert }) {
  const chartRef = useRef(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [range, setRange] = useState(defaultRange)
  const [bbStdDev, setBbStdDev] = useState(2.0)
  const [chart, setChart] = useState(null)
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 드로잉
  const { tool, toggleTool, setTool, shapes, addShape, removeShape, updateShape, clearAll } =
    useChartDrawings()
  const [preview, setPreview] = useState(null) // 사각형 드래그 미리보기
  const [channelPreview, setChannelPreview] = useState(null) // 채널 미리보기
  const [channelWidth, setChannelWidth] = useState(2.0) // 채널 폭(%)
  const [textInput, setTextInput] = useState(null) // { px, py, xi, price }
  const toolRef = useRef(tool)
  toolRef.current = tool
  const channelWidthRef = useRef(channelWidth)
  channelWidthRef.current = channelWidth
  const dragStartRef = useRef(null) // 사각형 드래그 시작점
  const chPtsRef = useRef([]) // 채널 기준선 진행 점들
  const lastChannelIdRef = useRef(null) // 마지막 생성 채널(폭 슬라이더 대상)

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

  const loadChart = async (stock, r, std) => {
    setLoading(true)
    setError('')
    try {
      const data = await getChartData(stock.symbol, r.start, r.end, std)
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
    loadChart(stock, range, bbStdDev)
  }

  const handleRangeChange = (field, val) => {
    const next = { ...range, [field]: val }
    setRange(next)
    if (selected) loadChart(selected, next, bbStdDev)
  }

  const handleBbChange = (val) => {
    setBbStdDev(val)
    if (selected) loadChart(selected, range, val)
  }

  // 채널 폭(%) 조절 → 마지막 생성 채널을 실시간 갱신(다음 채널의 기본값도 됨)
  const handleChannelWidth = (val) => {
    setChannelWidth(val)
    const id = lastChannelIdRef.current
    if (id && shapes.some((s) => s.id === id)) updateShape(id, { widthPct: val })
  }

  const option = useMemo(
    () => (chart ? buildOption(chart, shapes, preview, channelPreview) : null),
    [chart, shapes, preview, channelPreview],
  )

  // 차트 인스턴스 준비 시 zrender 드로잉 핸들러 바인딩(마운트마다 1회)
  const handleChartReady = (inst) => {
    const zr = inst.getZr()

    // zrender 이벤트는 offsetX/offsetY 또는 zrX/zrY 로 좌표를 준다(버전차 폴백)
    const toData = (e) => {
      const px = e.offsetX ?? e.zrX
      const py = e.offsetY ?? e.zrY
      if (px == null || py == null) return null
      const p = inst.convertFromPixel({ gridIndex: 0 }, [px, py])
      if (!p || Number.isNaN(p[0]) || Number.isNaN(p[1])) return null
      return { xi: p[0], price: p[1], px, py }
    }

    zr.on('click', (e) => {
      const t = toolRef.current
      if (t !== 'channel' && chPtsRef.current.length) {
        chPtsRef.current = []
        setChannelPreview(null)
      }
      if (!t || t === 'rect') return
      const p = toData(e)
      if (!p) return
      if (t === 'hline') addShape({ type: 'hline', price: p.price })
      else if (t === 'text')
        setTextInput({ px: p.px, py: p.py, xi: p.xi, price: p.price })
      else if (t === 'channel') {
        const pts = [...chPtsRef.current, { xi: p.xi, price: p.price }]
        chPtsRef.current = pts
        if (pts.length === 2) {
          // 기준선 2점 완성 → 현재 폭(%)으로 채널 생성. 폭은 슬라이더로 조절.
          const created = addShape({
            type: 'channel',
            x1: pts[0].xi, y1: pts[0].price,
            x2: pts[1].xi, y2: pts[1].price,
            widthPct: channelWidthRef.current,
          })
          lastChannelIdRef.current = created.id
          chPtsRef.current = []
          setChannelPreview(null)
        }
      }
    })

    zr.on('mousedown', (e) => {
      if (toolRef.current !== 'rect') return
      const p = toData(e)
      if (!p) return
      dragStartRef.current = { xi: p.xi, price: p.price }
      setPreview(null)
    })

    zr.on('mousemove', (e) => {
      const t = toolRef.current
      const p = toData(e)
      if (!p) return
      const drag = dragStartRef.current
      if (t === 'rect' && drag) {
        setPreview({ type: 'rect', xi1: drag.xi, y1: drag.price, xi2: p.xi, y2: p.price })
      } else if (t === 'channel' && chPtsRef.current.length === 1) {
        // 1점 찍은 상태: 커서를 기준선 끝점으로 채널 미리보기(현재 폭 적용)
        const a = chPtsRef.current[0]
        setChannelPreview({
          x1: a.xi, y1: a.price,
          x2: p.xi, y2: p.price,
          widthPct: channelWidthRef.current,
        })
      }
    })

    zr.on('mouseup', (e) => {
      const drag = dragStartRef.current
      if (toolRef.current !== 'rect' || !drag) return
      const p = toData(e)
      if (p) {
        addShape({ type: 'rect', xi1: drag.xi, y1: drag.price, xi2: p.xi, y2: p.price })
      }
      dragStartRef.current = null
      setPreview(null)
    })
  }

  if (!open) return null

  const commitText = (val) => {
    if (textInput && val.trim()) {
      addShape({ type: 'text', xi: textInput.xi, price: textInput.price, text: val.trim() })
    }
    setTextInput(null)
  }

  const handleInsert = () => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const dataURL = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' })
    onInsert(dataURL)
    clearAll()
    setTool(null)
    setPreview(null)
    setChannelPreview(null)
    chPtsRef.current = []
    lastChannelIdRef.current = null
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
            onKeyDown={(e) => {
              // 부모 폼 submit(→모달 닫힘) 방지. Enter 시 첫 검색결과 선택
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!selected && results.length > 0) handleSelect(results[0])
              }
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

        {/* 기간 + 볼린저 편차 + 정배열/역배열 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
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

          <div className="flex items-center gap-2">
            <label className="text-slate-500">볼린저 σ</label>
            <input
              type="number"
              min="0.5"
              max="4"
              step="0.1"
              value={bbStdDev}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isNaN(v) && v > 0) handleBbChange(v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault()
              }}
              className="w-16 rounded-lg border border-slate-300 px-2 py-1 tabular-nums"
            />
          </div>

          {chart && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                MA_ORDER_BADGE[chart.maOrder]?.cls || MA_ORDER_BADGE.MIXED.cls
              }`}
              title="MA5·20·50·120 배열 상태"
            >
              {MA_ORDER_BADGE[chart.maOrder]?.label || '혼조'}
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {/* 드로잉 툴바 */}
        {chart && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">그리기</span>
            {[
              { key: 'hline', label: '수평선 ─' },
              { key: 'channel', label: '이중추세선 ⧉' },
              { key: 'rect', label: '사각형 ▭' },
              { key: 'text', label: '텍스트 T' },
            ].map((b) => (
              <button
                key={b.key}
                onClick={() => toggleTool(b.key)}
                className={`rounded-lg border px-2.5 py-1 ${
                  tool === b.key
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {b.label}
              </button>
            ))}
            {shapes.length > 0 && (
              <button
                onClick={clearAll}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-500 hover:bg-slate-50"
              >
                전체지우기
              </button>
            )}
            {tool === 'channel' && (
              <span className="flex items-center gap-2">
                <label className="text-slate-500">폭</label>
                <input
                  type="range"
                  min="-10"
                  max="10"
                  step="0.5"
                  value={channelWidth}
                  onChange={(e) => handleChannelWidth(Number(e.target.value))}
                  className="accent-indigo-500"
                />
                <span className="w-10 tabular-nums text-slate-600">
                  {channelWidth.toFixed(1)}%
                </span>
              </span>
            )}
            {tool && (
              <span className="text-xs text-slate-400">
                {tool === 'hline' && '차트를 클릭해 수평선을 추가'}
                {tool === 'channel' && '기준선 2점 클릭 → 폭 슬라이더로 조절'}
                {tool === 'rect' && '드래그해 사각형 영역을 지정'}
                {tool === 'text' && '클릭한 위치에 텍스트를 입력'}
              </span>
            )}
          </div>
        )}

        {/* 그린 항목 칩 (개별 삭제) */}
        {shapes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shapes.map((s, i) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                {s.type === 'hline' && `수평선 ${i + 1}`}
                {s.type === 'channel' && `추세선 ${i + 1}`}
                {s.type === 'rect' && `사각형 ${i + 1}`}
                {s.type === 'text' && `텍스트: ${s.text}`}
                <button
                  onClick={() => removeShape(s.id)}
                  className="text-slate-400 hover:text-red-500"
                  aria-label="삭제"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 차트 */}
        <div
          className="relative mt-3 min-h-[320px] flex-1 rounded-lg border border-slate-200"
          style={{ cursor: tool ? 'crosshair' : 'default' }}
        >
          {loading ? (
            <p className="py-32 text-center text-sm text-slate-400">차트 불러오는 중…</p>
          ) : option ? (
            <ReactECharts
              ref={chartRef}
              option={option}
              notMerge
              lazyUpdate={false}
              onChartReady={handleChartReady}
              style={{ height: 320, width: '100%' }}
            />
          ) : (
            <p className="py-32 text-center text-sm text-slate-400">
              종목을 검색해 선택하면 차트가 표시됩니다.
            </p>
          )}

          {/* 텍스트 입력 오버레이 (임시 — 확정 시 차트에 markPoint로 배치) */}
          {textInput && (
            <input
              autoFocus
              defaultValue=""
              placeholder="텍스트 입력 후 Enter"
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText(e.target.value)
                else if (e.key === 'Escape') setTextInput(null)
              }}
              onBlur={(e) => commitText(e.target.value)}
              style={{
                position: 'absolute',
                left: Math.min(textInput.px, 360),
                top: textInput.py,
              }}
              className="z-10 w-40 rounded border border-indigo-400 bg-white px-2 py-1 text-xs shadow"
            />
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
