import { useEffect, useRef } from 'react'
import { CrosshairMode, createChart, type UTCTimestamp } from 'lightweight-charts'
import type { QuizCandle } from '../../types/game'
import { sma } from '../../lib/indicators'
import { THEME } from '../../lib/themeColors'

// 퀴즈용 미니 캔들 차트 — 날짜를 숨기므로 시간축은 순번(1..N), 가격은 서버 정규화 값(첫 종가=100).
// 시간축·크로스헤어 라벨을 숨기고 스크롤/확대를 막아 "차트 모양"만 보이게 한다.
// 5·20일 이동평균선과 아래쪽 거래량 막대를 함께 그린다. future(정답 공개 후 이후 봉)는 옅은 색으로 이어 붙인다.
const UP = THEME.up
const DOWN = THEME.down
const FUTURE_ALPHA = '66' // 이후 봉 투명도(hex alpha)
// eslint-disable-next-line react-refresh/only-export-components -- 차트 색 상수를 같은 파일에서 공유(개발 중 Fast Refresh 에만 영향)
export const QUIZ_MA_COLORS = { 5: '#14b8a6', 20: '#f97316' } as const // TradingChart MA 색과 같음
const NO_FUTURE: QuizCandle[] = [] // 기본값을 상수로 — 렌더마다 새 배열이면 effect 가 매초(타이머) 차트를 다시 만든다

/** 순번 → 차트 시간값. UTCTimestamp 는 number 브랜드 타입이라 생성 함수가 없어 단언이 유일한 방법이다 */
const seqTime = (i: number): UTCTimestamp => (i + 1) as UTCTimestamp

const tone = (c: QuizCandle): string => (c.close >= c.open ? UP : DOWN)

export default function QuizMiniChart({
  candles,
  future = NO_FUTURE,
}: {
  candles: QuizCandle[]
  future?: QuizCandle[]
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: THEME.inkMuted },
      grid: { vertLines: { visible: false }, horzLines: { color: THEME.canvas } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelVisible: false },
        horzLine: { labelVisible: false },
      },
      rightPriceScale: { borderColor: THEME.line, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { visible: false },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (p: number) => p.toFixed(1) },
    })
    const all = [...candles, ...future]
    const isFuture = (i: number) => i >= candles.length

    // 거래량 — 별도 축(라벨 숨김)으로 아래 20%에
    const volume = chart.addHistogramSeries({ priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false })
    volume.setData(
      all.flatMap((c, i) =>
        c.volume === undefined ? [] : [{ time: seqTime(i), value: c.volume, color: tone(c) + (isFuture(i) ? '33' : '55') }],
      ),
    )

    const series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    })
    series.setData(all.map((c, i) => {
      const bar = { time: seqTime(i), open: c.open, high: c.high, low: c.low, close: c.close }
      if (!isFuture(i)) return bar
      const color = tone(c) + FUTURE_ALPHA
      return { ...bar, color, borderColor: color, wickColor: color }
    }))

    const closes = all.map((c) => c.close)
    const line = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
    for (const period of [5, 20] as const) {
      const ma = chart.addLineSeries({ ...line, color: QUIZ_MA_COLORS[period] })
      ma.setData(sma(closes, period).flatMap((v, i) => (v === null ? [] : [{ time: seqTime(i), value: v }])))
    }
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [candles, future])

  return <div ref={boxRef} className="h-[240px] w-full overflow-hidden rounded-card border border-line bg-surface" />
}
