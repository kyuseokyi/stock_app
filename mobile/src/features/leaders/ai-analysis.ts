// 주도주 AI 정성 분석(포착 사유·지뢰 감지) — 순수 함수(네트워크·RN 의존 없음, 테스트 대상).
// 응답 정규화 · 뱃지 문구 · 세션 캐시(만료) · 동시 요청 수 제한 로더.

export type GrowthQuality = '본업성장' | '일회성이익' | '불확실';
export type RedFlagLevel = 'CLEAN' | 'WARNING' | 'DANGER';

export type ScreenerAnalysis = {
  ticker: string;
  hookSummary: string;
  growthQuality: GrowthQuality | null;
  financialQualityNote: string;
  redFlagLevel: RedFlagLevel | null;
  redFlags: string[];
  date: string;
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const GROWTH: readonly GrowthQuality[] = ['본업성장', '일회성이익', '불확실'];
const LEVELS: readonly RedFlagLevel[] = ['CLEAN', 'WARNING', 'DANGER'];

/** 백엔드가 받는 티커 형식(6자리 영숫자) — 아니면 요청하지 않는다(422 방지) */
export const isAnalyzableTicker = (ticker: string): boolean => /^[0-9A-Za-z]{6}$/.test(ticker);

/**
 * GET /ai/screener-analysis/{ticker} → 분석(없으면 null).
 * 허용값 밖의 growth_quality·red_flag_level 은 null(해당 태그·뱃지를 숨김), red_flags 는 문자열만 남긴다.
 * 포착 사유도 지뢰 단계도 없으면 보여 줄 게 없으므로 null.
 */
export function normalizeScreenerAnalysis(raw: unknown): ScreenerAnalysis | null {
  const a = isObj(raw) ? raw.analysis : null;
  if (!isObj(a)) return null;
  const growth = str(a.growth_quality);
  const level = str(a.red_flag_level).toUpperCase();
  const hookSummary = str(a.hook_summary);
  const redFlagLevel = (LEVELS as readonly string[]).includes(level) ? (level as RedFlagLevel) : null;
  if (!hookSummary && !redFlagLevel) return null;
  return {
    ticker: str(a.ticker),
    hookSummary,
    growthQuality: (GROWTH as readonly string[]).includes(growth) ? (growth as GrowthQuality) : null,
    financialQualityNote: str(a.financial_quality_note),
    redFlagLevel,
    redFlags: (Array.isArray(a.red_flags) ? a.red_flags : []).map(str).filter(Boolean),
    date: str(a.date),
  };
}

export type BadgeTone = 'safe' | 'caution' | 'danger';

/** 지뢰 뱃지 — CLEAN "CLEAN 안전" / WARNING·DANGER 는 첫 번째 사유를 붙인다(없으면 단계만) */
export function redFlagBadge(a: Pick<ScreenerAnalysis, 'redFlagLevel' | 'redFlags'>): { tone: BadgeTone; text: string } | null {
  if (a.redFlagLevel === 'CLEAN') return { tone: 'safe', text: 'CLEAN 안전' };
  const first = a.redFlags[0];
  if (a.redFlagLevel === 'WARNING') return { tone: 'caution', text: first ? `WARNING ${first}` : 'WARNING' };
  if (a.redFlagLevel === 'DANGER') return { tone: 'danger', text: first ? `DANGER ${first}` : 'DANGER' };
  return null;
}

/** 만료가 있는 메모리 캐시 — null 값도 저장한다(“분석 없음”도 다시 묻지 않게) */
export function createTtlCache<T>(now: () => number = Date.now) {
  const map = new Map<string, { value: T; expiresAt: number }>();
  return {
    /** 살아 있으면 { value }, 없거나 만료면 undefined(만료 항목은 지운다) */
    get(key: string): { value: T } | undefined {
      const e = map.get(key);
      if (!e) return undefined;
      if (now() >= e.expiresAt) {
        map.delete(key);
        return undefined;
      }
      return { value: e.value };
    },
    set(key: string, value: T, ttlMs: number): void {
      map.set(key, { value, expiresAt: now() + ttlMs });
    },
    clear(): void {
      map.clear();
    },
    size(): number {
      return map.size;
    },
  };
}

/** 동시에 max 개까지만 실행하고 나머지는 들어온 순서대로 기다리게 한다 */
export function createLimiter(max: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  const pump = () => {
    while (running < max && queue.length > 0) {
      running += 1;
      queue.shift()!();
    }
  };
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          task()
            .then(resolve, reject)
            .finally(() => {
              running -= 1;
              pump();
            });
        });
        pump();
      });
    },
    /** 테스트·진단용: 실행 중 / 대기 중 개수 */
    stats: () => ({ running, waiting: queue.length }),
  };
}

type LoaderOptions = {
  fetcher: (ticker: string) => Promise<ScreenerAnalysis | null>;
  /** 성공 결과(null 포함) 보관 시간 */
  ttlMs: number;
  /** 실패 보관 시간 — 짧게 두어 스크롤할 때마다 실패 요청이 반복되지 않게 */
  failTtlMs: number;
  maxConcurrent: number;
  now?: () => number;
  onError?: (ticker: string, e: unknown) => void;
};

/**
 * 티커별 분석 로더 — 캐시 → 진행 중 요청 공유 → 동시성 제한 순으로 거친다.
 * 실패는 던지지 않고 null 로 돌려준다(카드가 깨지지 않게, onError 로 기록만).
 */
export function createAnalysisLoader(opts: LoaderOptions) {
  const cache = createTtlCache<ScreenerAnalysis | null>(opts.now);
  const limiter = createLimiter(opts.maxConcurrent);
  const inflight = new Map<string, Promise<ScreenerAnalysis | null>>();
  return {
    peek: (ticker: string) => cache.get(ticker),
    load(ticker: string): Promise<ScreenerAnalysis | null> {
      const hit = cache.get(ticker);
      if (hit) return Promise.resolve(hit.value);
      const running = inflight.get(ticker);
      if (running) return running;
      const p = limiter
        .run(() => opts.fetcher(ticker))
        .then(
          (value) => {
            cache.set(ticker, value, opts.ttlMs);
            return value;
          },
          (e: unknown) => {
            opts.onError?.(ticker, e);
            cache.set(ticker, null, opts.failTtlMs);
            return null;
          },
        )
        .finally(() => inflight.delete(ticker));
      inflight.set(ticker, p);
      return p;
    },
    clear: () => cache.clear(),
  };
}
