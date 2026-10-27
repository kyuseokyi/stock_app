// 차트 게임 지지·저항 목록 — 켜진 지표의 마지막 값 중 현재가 위·아래로 가까운 2개씩(설계 2026-10-27 §3).
// 웹 web_client/src/lib/srLevels.ts 와 같은 규칙(웹은 lastSrValues 를 더 가진다).
import { roundToTick } from './krx-tick';

export type SrKey = 'ma5' | 'ma20' | 'ma60' | 'bbUpper' | 'bbLower' | 'poc';
export type SrRole = 'support' | 'resistance';

export interface SrCandidate {
  key: SrKey;
  price: number;
  color: string;
}

export interface SrLevel extends SrCandidate {
  role: SrRole;
}

/** 지표 마지막 값(이평 첫째·둘째·셋째 칸, 볼린저 상·하단) */
export type SrValues = Partial<Record<'ma5' | 'ma20' | 'ma60' | 'bbUpper' | 'bbLower', number>>;

/** 같은 가격이면 앞 순서 하나만 남긴다 */
export const SR_ORDER: readonly SrKey[] = ['ma5', 'ma20', 'ma60', 'bbUpper', 'bbLower', 'poc'];
export const SR_PER_SIDE = 2;
export const BB_LINE_COLOR = '#6366f1';
export const POC_RESIST_COLOR = '#f59e0b';
export const POC_SUPPORT_COLOR = '#8b5cf6';

const MA_KEYS = ['ma5', 'ma20', 'ma60'] as const;
const MA_SLOT: Record<(typeof MA_KEYS)[number], number> = { ma5: 0, ma20: 1, ma60: 2 };

export interface SrInputs {
  values: SrValues;
  /** 이동평균 칩 */
  ma: boolean;
  /** 볼린저 칩 */
  bb: boolean;
  /** 매물대 POC(매물대 칩이 꺼졌거나 아직 모르면 null) */
  poc: number | null;
  /** 이평 칸별 선 색 [첫째, 둘째, 셋째] */
  maColors: readonly string[];
}

/** 켜진 지표의 마지막 값 → 후보. POC 색은 현재가 위(저항)면 주황, 아래(지지)면 보라 */
export function srCandidates({ values, ma, bb, poc, maColors }: SrInputs, lastPrice: number): SrCandidate[] {
  const out: SrCandidate[] = [];
  if (ma) {
    MA_KEYS.forEach((key, i) => {
      const v = values[key];
      if (v !== undefined) out.push({ key, price: v, color: maColors[i] });
    });
  }
  if (bb) {
    if (values.bbUpper !== undefined) out.push({ key: 'bbUpper', price: values.bbUpper, color: BB_LINE_COLOR });
    if (values.bbLower !== undefined) out.push({ key: 'bbLower', price: values.bbLower, color: BB_LINE_COLOR });
  }
  if (poc !== null) out.push({ key: 'poc', price: poc, color: poc >= lastPrice ? POC_RESIST_COLOR : POC_SUPPORT_COLOR });
  return out;
}

/** 현재가 이상 = 저항(가까운 순 2개), 미만 = 지지(가까운 순 2개). 저항 먼저, 그다음 지지 */
export function pickSrLevels(candidates: SrCandidate[], lastPrice: number): SrLevel[] {
  const ordered = candidates
    .filter((x) => Number.isFinite(x.price) && x.price > 0)
    .sort((a, b) => SR_ORDER.indexOf(a.key) - SR_ORDER.indexOf(b.key));
  const seen = new Set<number>();
  const uniq: SrCandidate[] = [];
  for (const x of ordered) {
    if (seen.has(x.price)) continue;
    seen.add(x.price);
    uniq.push(x);
  }
  const resist = uniq
    .filter((x) => x.price >= lastPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, SR_PER_SIDE)
    .map((x): SrLevel => ({ ...x, role: 'resistance' }));
  const support = uniq
    .filter((x) => x.price < lastPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, SR_PER_SIDE)
    .map((x): SrLevel => ({ ...x, role: 'support' }));
  return [...resist, ...support];
}

/** 지표 이름 — 넓게: 20선·BB상단·매물대 / 좁게: 20·BB+·POC */
export function srName(key: SrKey, maPeriods: readonly number[], short: boolean): string {
  switch (key) {
    case 'ma5':
    case 'ma20':
    case 'ma60': {
      const p = maPeriods[MA_SLOT[key]];
      return short ? String(p) : `${p}선`;
    }
    case 'bbUpper':
      return short ? 'BB+' : 'BB상단';
    case 'bbLower':
      return short ? 'BB-' : 'BB하단';
    case 'poc':
      return short ? 'POC' : '매물대';
  }
}

/** 가격축 라벨 — 넓게: [저항] 20선 / 좁게: 저항 20 (가격 숫자는 축 라벨에 이미 있음) */
export function srAxisTitle(level: SrLevel, maPeriods: readonly number[], short: boolean): string {
  const role = level.role === 'support' ? '지지' : '저항';
  const name = srName(level.key, maPeriods, short);
  return short ? `${role} ${name}` : `[${role}] ${name}`;
}

/** 다시 그릴지 판단용 — 키·역할·호가 반올림 가격이 같으면 같은 서명 */
export function srSignature(levels: SrLevel[]): string {
  return levels.map((l) => `${l.key}:${l.role}:${roundToTick(l.price)}`).join('|');
}
