// 시황 대시보드(개요 칩) 표시용 순수 함수 — 기준 시각·장운영 뱃지·억 단위·히트맵 색 단계·지수 캐러셀 분류.
// RN·네트워크 의존 없음(테스트 대상).
import type { HeatmapGroup, HeatmapStock } from './rest-types';
import type { MarketIndex } from './types';

const KST_OFFSET_MS = 9 * 3_600_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 시각 문자열 → KST 기준 epoch(ms). 실패하면 null.
 * - 오프셋 있는 ISO('…+09:00'·'…Z')는 그대로 해석
 * - 오프셋 없는 'YYYY-MM-DDTHH:MM[:SS]'(또는 공백 구분)는 이미 KST 로 본다(기기 시간대에 휘둘리지 않게)
 */
export function parseKst(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  const naive = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(t);
  if (naive) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = naive;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) - KST_OFFSET_MS;
  }
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/** epoch(ms) → KST 'MM.DD HH:MM' */
function kstLabel(ms: number): string {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** 시각 → '10.30 15:30 기준' (KST). 읽을 수 없으면 null */
export function formatBasis(s: string | null | undefined): string | null {
  const ms = parseKst(s);
  return ms == null ? null : `${kstLabel(ms)} 기준`;
}

/** 'YYYY-MM-DD' → '10.30' (모양이 다르면 받은 그대로) */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}.${m[2]}` : iso;
}

/** 국내 지수 기준 시각 — 장중이면 date + asOf, 확정이면 그날 15:30 */
export function indexBasisTime(ix: Pick<MarketIndex, 'region' | 'date' | 'live' | 'asOf'>): string | null {
  if (ix.region !== 'KR' || !ix.date) return null;
  const hm = ix.live && ix.asOf && /^\d{2}:\d{2}$/.test(ix.asOf) ? ix.asOf : '15:30';
  return `${ix.date.slice(0, 10)}T${hm}:00+09:00`;
}

/** 후보 시각 중 가장 최근 것(읽을 수 있는 것만). 없으면 null */
export function latestTime(candidates: (string | null | undefined)[]): string | null {
  let best: { s: string; ms: number } | null = null;
  for (const s of candidates) {
    const ms = parseKst(s);
    if (ms != null && (best == null || ms > best.ms)) best = { s: s as string, ms };
  }
  return best?.s ?? null;
}

export type MarketSession = '정규장' | '장 시작 전' | '장마감';

/**
 * 장운영 뱃지 — 국내 지수가 장중 값(live)이면 정규장, 아니면 평일 09:00 전은 '장 시작 전', 그 밖은 장마감.
 * 국내 지수가 하나도 없으면(개요 미수신) null — 잘못된 '장마감' 표시를 막는다. VI 는 데이터가 없어 다루지 않는다.
 */
export function marketSession(indices: Pick<MarketIndex, 'region' | 'live'>[], now: Date = new Date()): MarketSession | null {
  const kr = indices.filter((i) => i.region === 'KR');
  if (kr.length === 0) return null;
  if (kr.some((i) => i.live)) return '정규장';
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  const dow = k.getUTCDay();
  const minutes = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (dow >= 1 && dow <= 5 && minutes < 9 * 60) return '장 시작 전';
  return '장마감';
}

const comma = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * 순매수 금액(원) → 부호 붙은 억 단위: '+1,234억' · '-56억' · '+0.3억' · '+1.2조'.
 * 1억 미만은 소수 한 자리, 1조 이상은 조 단위 소수 한 자리. 0 은 '0억'.
 */
export function formatEok(won: number): string {
  const eok = won / 1e8;
  const sign = eok > 0 ? '+' : eok < 0 ? '-' : '';
  const a = Math.abs(eok);
  if (Math.round(a) >= 10_000) return `${sign}${(a / 10_000).toFixed(1)}조`;
  if (a >= 0.95) return `${sign}${comma(Math.round(a))}억`;
  const r = Math.round(a * 10) / 10;
  return r === 0 ? '0억' : `${sign}${r.toFixed(1)}억`;
}

export type HeatTone = 'up' | 'down' | 'flat';
export interface HeatLevel {
  tone: HeatTone;
  /** 0(옅음) · 1(중간) · 2(진함) */
  level: 0 | 1 | 2;
}

/** 히트맵 칸 색 단계 — |등락률| < 0.05 또는 없음은 flat, 1% 미만 0단계 · 3% 미만 1단계 · 그 이상 2단계 */
export function heatLevel(chg: number | null | undefined): HeatLevel {
  if (chg == null || !Number.isFinite(chg) || Math.abs(chg) < 0.05) return { tone: 'flat', level: 0 };
  const a = Math.abs(chg);
  return { tone: chg > 0 ? 'up' : 'down', level: a < 1 ? 0 : a < 3 ? 1 : 2 };
}

/** 그룹 소속 종목 Top N — '기타' 칸(ticker '') 제외, 크기(시총·거래대금) 큰 순 */
export function topStocks(group: Pick<HeatmapGroup, 'stocks'>, n = 5): HeatmapStock[] {
  return group.stocks
    .filter((s) => s.ticker !== '')
    .sort((a, b) => b.size - a.size)
    .slice(0, n);
}

/** 지수 캐러셀 순서 — 국내 2 · 미국 3 · 환율 */
export const CAROUSEL_CODES = ['KR:0001', 'KR:1001', 'US:COMP', 'US:SPX', 'US:SOX', 'FX:USDKRW'];

/** 캐러셀(정해진 순서) / 나머지(돈의 흐름·기타 지수 칸으로) 로 나눈다 */
export function splitCarousel<T extends Pick<MarketIndex, 'code'>>(indices: T[]): { carousel: T[]; rest: T[] } {
  const carousel = CAROUSEL_CODES.map((c) => indices.find((i) => i.code === c)).filter((i): i is T => i != null);
  const rest = indices.filter((i) => !CAROUSEL_CODES.includes(i.code));
  return { carousel, rest };
}
