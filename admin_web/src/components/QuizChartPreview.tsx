import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import type { QuizSnapshotCandle } from '../types/game'

interface OhlcCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
}

interface QuizChartPreviewProps {
  snapshot: QuizSnapshotCandle[] // 문제 구간(기준일까지)
  future: OhlcCandle[] // 기준일 이후(정답 구간) — 비어 있으면 문제 구간만 표시
  baseDate: string
  horizon: number // 예측 기간(거래일) — 범례 문구
}

const toOhlc = (c: OhlcCandle): [number, number, number, number] => [c.open, c.close, c.low, c.high]

/** 퀴즈 차트 미리보기 — 문제 구간(빨강/파랑) + 기준일 세로선 + 이후 구간(주황/보라). */
export default function QuizChartPreview({ snapshot, future, baseDate, horizon }: QuizChartPreviewProps) {
  const futureName = `이후 ${horizon}거래일`
  const option = useMemo<EChartsOption>(() => {
    const dates = [...snapshot.map((c) => c.date), ...future.map((c) => c.date)]
    // 빈 자리('-' 4개) — 두 캔들 시리즈가 같은 x축을 나눠 쓴다
    const blanks = (n: number): string[][] => Array.from({ length: n }, () => ['-', '-', '-', '-'])
    return {
      animation: false,
      grid: { left: 8, right: 56, top: 24, bottom: 28 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { top: 0, data: ['문제 구간', futureName] },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { formatter: (v: string) => v.slice(5) },
      },
      yAxis: { scale: true, position: 'right' },
      series: [
        {
          name: '문제 구간',
          type: 'candlestick',
          data: [...snapshot.map(toOhlc), ...blanks(future.length)],
          itemStyle: { color: '#ef4444', color0: '#3b82f6', borderColor: '#ef4444', borderColor0: '#3b82f6' },
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: '#0f172a', type: 'dashed' },
            label: { formatter: '기준일' },
            data: [{ xAxis: baseDate }],
          },
        },
        {
          name: futureName,
          type: 'candlestick',
          data: [...blanks(snapshot.length), ...future.map(toOhlc)],
          itemStyle: { color: '#f59e0b', color0: '#8b5cf6', borderColor: '#f59e0b', borderColor0: '#8b5cf6' },
        },
      ],
    }
  }, [snapshot, future, baseDate, futureName])

  return <ReactECharts option={option} notMerge style={{ height: 320, width: '100%' }} />
}
