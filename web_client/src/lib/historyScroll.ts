import type { IChartApi, LogicalRange } from 'lightweight-charts'

// 차트를 왼쪽 끝까지 끌면 과거 캔들을 이어 받는다(일봉 차트 공용).
// 보이는 구간 왼쪽이 첫 캔들에서 EDGE_BARS 안으로 들어오면 loadOlder 1회 — 진행 중엔 중복 요청 안 함,
// loadOlder 가 false(더 없음)를 주면 그 차트에선 다시 요청하지 않는다. 실패는 다음 스크롤 때 다시 시도.

/** 첫 캔들까지 이만큼 남으면 미리 요청 */
const EDGE_BARS = 10

export function watchLeftEdge(
  chart: IChartApi,
  loadOlder: () => Promise<boolean>,
  onBusy?: (busy: boolean) => void,
): () => void {
  let busy = false
  let done = false
  let alive = true
  // 사용자가 차트를 누르거나(드래그·터치) 휠을 굴린 뒤부터 — 처음 화면 맞춤·크기 맞춤만으로 요청하지 않게
  let armed = false
  const arm = () => {
    armed = true
  }
  const el = chart.chartElement()
  el.addEventListener('pointerdown', arm)
  el.addEventListener('wheel', arm, { passive: true })
  const onRange = (r: LogicalRange | null) => {
    if (!r || !armed || busy || done || r.from > EDGE_BARS) return
    busy = true
    onBusy?.(true)
    loadOlder()
      .then((more) => {
        if (!more && alive) {
          done = true
          chart.applyOptions({ timeScale: { fixLeftEdge: true } }) // 더 없음 — 첫 캔들 왼쪽 빈 공간으로 밀리지 않게
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!alive) return
        busy = false
        onBusy?.(false)
      })
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)
  return () => {
    alive = false
    el.removeEventListener('pointerdown', arm)
    el.removeEventListener('wheel', arm)
    chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
  }
}

/**
 * 앞에 added 개를 붙이는 setData(apply) 동안 보던 캔들을 그대로 보이게 한다.
 * 라이브러리가 오른쪽 기준으로 화면을 유지해 이미 밀려 있으면 그대로 두고, 아니면 붙인 개수만큼 옮긴다.
 */
export function prependKeepingView(chart: IChartApi, added: number, apply: () => void) {
  const ts = chart.timeScale()
  const before = ts.getVisibleLogicalRange()
  apply()
  const after = ts.getVisibleLogicalRange()
  if (before && after && Math.abs(after.from - before.from - added) > 0.5) {
    ts.setVisibleLogicalRange({ from: before.from + added, to: before.to + added })
  }
}

/** 과거 행 + 기존 행 — 날짜가 겹치면 기존 것을 남긴다(오름차순 유지) */
export function mergeOlder<T extends { date: string }>(older: T[], rows: T[]): T[] {
  const first = rows[0]?.date
  return [...older.filter((c) => first === undefined || c.date < first), ...rows]
}
