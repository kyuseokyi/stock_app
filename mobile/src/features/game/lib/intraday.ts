// 게임 차트 분봉(1·5·15·60분) 순수 함수 — 버킷 시작 계산·틱 병합·응답 정규화·KST 축 라벨.
// t 는 버킷 시작 UTC epoch seconds(서버 GET /api/game/candles 와 같은 기준).
import type { ChartInterval, IntradayCandle, IntradayInterval } from '../types';

const KST_OFFSET_SEC = 9 * 3600;

/** 차트 단위 칩 순서·라벨 */
export const CHART_INTERVALS: readonly {
  value: ChartInterval;
  label: string;
}[] = [
  { value: 'day', label: '일' },
  { value: '1m', label: '1분' },
  { value: '5m', label: '5분' },
  { value: '15m', label: '15분' },
  { value: '60m', label: '60분' },
];

const INTERVAL_MINUTES: Record<IntradayInterval, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '60m': 60,
};

export const isChartInterval = (v: unknown): v is ChartInterval =>
  v === 'day' || v === '1m' || v === '5m' || v === '15m' || v === '60m';

/** 분봉 단위의 초 길이 */
export const intervalSeconds = (interval: IntradayInterval): number => INTERVAL_MINUTES[interval] * 60;

/** nowMs 가 속한 버킷의 시작(UTC epoch seconds). KST 벽시계 기준으로 정렬(예: 5분봉 09:00·09:05 …) */
export function bucketStartSec(nowMs: number, interval: IntradayInterval): number {
  const step = intervalSeconds(interval);
  const kstSec = Math.floor(nowMs / 1000) + KST_OFFSET_SEC;
  return Math.floor(kstSec / step) * step - KST_OFFSET_SEC;
}

/**
 * 틱 가격을 마지막 분봉에 병합(원본 불변).
 * 마지막 캔들 버킷이 bucketSec 이상이면(시계 오차 포함) 그 캔들에 병합, 없거나 과거면 새 버킷 캔들 생성(volume 0).
 */
export function mergeTickIntraday(last: IntradayCandle | null, bucketSec: number, price: number): IntradayCandle {
  if (last && last.t >= bucketSec) {
    return {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    };
  }
  return {
    t: bucketSec,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
  };
}

/** 분봉 배열에 틱 반영(새 배열). 같은 버킷이면 마지막 교체, 새 버킷이면 뒤에 추가 */
export function applyTickIntraday(candles: IntradayCandle[], bucketSec: number, price: number): IntradayCandle[] {
  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  const next = mergeTickIntraday(last, bucketSec, price);
  return last !== null && next.t === last.t ? [...candles.slice(0, -1), next] : [...candles, next];
}

const toFinite = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** GET /api/game/candles 응답 → 유효한 캔들만 t 오름차순(숫자 문자열도 허용). 형식이 아니면 [] */
export function normalizeIntradayCandles(raw: unknown): IntradayCandle[] {
  const rows = typeof raw === 'object' && raw !== null ? (raw as { candles?: unknown }).candles : null;
  if (!Array.isArray(rows)) return [];
  const out: IntradayCandle[] = [];
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const t = toFinite(o.t);
    const open = toFinite(o.open);
    const high = toFinite(o.high);
    const low = toFinite(o.low);
    const close = toFinite(o.close);
    if (t === null || open === null || high === null || low === null || close === null) continue;
    out.push({ t, open, high, low, close, volume: toFinite(o.volume) ?? 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** epoch seconds → KST 'HH:mm' */
export function kstHm(tSec: number): string {
  const d = new Date((tSec + KST_OFFSET_SEC) * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 'YYYY-MM-DD' → 'MM/DD' (일봉 축 라벨) */
export const dayLabel = (date: string): string => `${date.slice(5, 7)}/${date.slice(8, 10)}`;

/** 축 라벨용 인덱스 — 처음·가운데·끝(개수에 따라 중복 제거) */
export function axisLabelIndexes(count: number): number[] {
  if (count <= 0) return [];
  return Array.from(new Set([0, Math.floor((count - 1) / 2), count - 1]));
}
