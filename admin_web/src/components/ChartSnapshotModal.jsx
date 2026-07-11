import { useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'

// 모의 OHLC 데이터 생성 (관리자 스냅샷 데모용)
function buildMockData(days = 40) {
  const dates = []
  const candles = [] // [open, close, low, high]
  let price = 50000
  for (let i = 0; i < days; i++) {
    const open = price
    const change = (Math.random() - 0.48) * 2000
    const close = Math.max(1000, open + change)
    const high = Math.max(open, close) + Math.random() * 800
    const low = Math.min(open, close) - Math.random() * 800
    const d = new Date(2026, 0, 1 + i)
    dates.push(`${d.getMonth() + 1}/${d.getDate()}`)
    candles.push([Math.round(open), Math.round(close), Math.round(low), Math.round(high)])
    price = close
  }
  return { dates, candles }
}

function movingAverage(candles, n) {
  return candles.map((_, i) => {
    if (i < n - 1) return '-'
    let sum = 0
    for (let j = 0; j < n; j++) sum += candles[i - j][1]
    return Math.round(sum / n)
  })
}

export default function ChartSnapshotModal({ open, onClose, onInsert }) {
  const chartRef = useRef(null)
  const { dates, candles } = useMemo(() => buildMockData(), [open])

  const option = useMemo(
    () => ({
      animation: false,
      grid: { left: 50, right: 20, top: 40, bottom: 30 },
      title: { text: '샘플 종목 (모의 데이터)', left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { data: ['캔들', 'MA5', 'MA20'], top: 20, right: 10 },
      xAxis: { type: 'category', data: dates, boundaryGap: true, axisLine: { lineStyle: { color: '#94a3b8' } } },
      yAxis: { scale: true, splitLine: { lineStyle: { color: '#f1f5f9' } } },
      series: [
        {
          name: '캔들',
          type: 'candlestick',
          data: candles,
          itemStyle: {
            color: '#ef4444', color0: '#3b82f6',
            borderColor: '#ef4444', borderColor0: '#3b82f6',
          },
        },
        { name: 'MA5', type: 'line', data: movingAverage(candles, 5), smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#f59e0b' } },
        { name: 'MA20', type: 'line', data: movingAverage(candles, 20), smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#8b5cf6' } },
      ],
    }),
    [dates, candles],
  )

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
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">차트 삽입</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="rounded-lg border border-slate-200">
          <ReactECharts ref={chartRef} option={option} style={{ height: 320, width: '100%' }} />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          이 차트를 이미지로 캡처해 본문에 삽입합니다. (모의 데이터 · 추후 실제 종목 연동)
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            취소
          </button>
          <button onClick={handleInsert} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            본문에 삽입
          </button>
        </div>
      </div>
    </div>
  )
}
