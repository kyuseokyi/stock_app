import { useEffect, useRef } from 'react'
import { CrosshairMode, createChart, type UTCTimestamp } from 'lightweight-charts'
import type { QuizCandle } from '../../types/game'

// 퀴즈용 미니 캔들 차트 — 날짜를 숨기므로 시간축은 순번(1..N), 가격은 서버 정규화 값(첫 종가=100).
// 시간축·크로스헤어 라벨을 숨기고 스크롤/확대를 막아 "차트 모양"만 보이게 한다.
const UP = '#f04452'
const DOWN = '#3182f6'

/** 순번 → 차트 시간값. UTCTimestamp 는 number 브랜드 타입이라 생성 함수가 없어 단언이 유일한 방법이다 */
const seqTime = (i: number): UTCTimestamp => (i + 1) as UTCTimestamp

export default function QuizMiniChart({ candles }: { candles: QuizCandle[] }) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b95a1' },
      grid: { vertLines: { visible: false }, horzLines: { color: '#f2f4f6' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelVisible: false },
        horzLine: { labelVisible: false },
      },
      rightPriceScale: { borderColor: '#e5e8eb' },
      timeScale: { visible: false },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (p: number) => p.toFixed(1) },
    })
    const series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    })
    series.setData(candles.map((c, i) => ({ time: seqTime(i), open: c.open, high: c.high, low: c.low, close: c.close })))
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [candles])

  return <div ref={boxRef} className="h-[220px] w-full overflow-hidden rounded-card border border-line bg-white" />
}
