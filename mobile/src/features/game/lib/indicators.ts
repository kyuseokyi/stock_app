// 게임 차트 보조지표(이동평균선·볼린저밴드) 순수 함수 + View 꺾은선용 선분 좌표.
// 입력은 종가 배열(오래된 → 최신). 기간보다 앞 구간은 null(선이 그 지점부터 시작).

export const MA_PERIODS = [5, 20, 60] as const;
export const BB_PERIOD = 20;
export const BB_K = 2;

/** 단순이동평균 — 직전 period 개 종가 평균 */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export interface Band {
  upper: number;
  middle: number;
  lower: number;
}

/** 볼린저밴드 — 중심=SMA(period), 상·하단=중심 ± k×모표준편차(MTS 관례) */
export function bollinger(values: number[], period: number = BB_PERIOD, k: number = BB_K): (Band | null)[] {
  return sma(values, period).map((middle, i) => {
    if (middle === null) return null;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - middle) ** 2;
    const sd = Math.sqrt(sq / period);
    return { upper: middle + k * sd, middle, lower: middle - k * sd };
  });
}

export interface Point {
  x: number;
  y: number;
}

/** 1px 높이 View 로 그리는 선분 — 중점에 놓고 angleDeg 만큼 회전(RN 회전 중심 = View 중앙) */
export interface Segment {
  left: number;
  top: number;
  width: number;
  angleDeg: number;
}

/** 이웃한 두 점(둘 다 값 있을 때만)을 잇는 선분 목록 */
export function lineSegments(points: (Point | null)[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === null || b === null) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const width = Math.hypot(dx, dy);
    segs.push({
      left: (a.x + b.x) / 2 - width / 2,
      top: (a.y + b.y) / 2 - 0.5,
      width,
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }
  return segs;
}
