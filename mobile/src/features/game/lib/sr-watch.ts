// 지지·저항 터치·돌파·이탈 감지(화면 안) — I/O 없는 상태 객체(설계 2026-10-27 §5).
// 선마다 '마지막으로 띠 밖에서 머문 쪽'을 기억해, 띠(±오차)에 들어오면 터치, 반대쪽으로 넘어가면 돌파·이탈.
// 웹 web_client/src/lib/srWatch.ts 와 같은 코드.
import { formatPrice } from './format';
import { krxTick } from './krx-tick';
import type { SrKey, SrLevel } from './sr-levels';

export const SR_COOLDOWN_MS = 600_000; // 같은 선·같은 이벤트 재알림 간격(10분)
export const SR_EPS_RATIO = 0.0015; // 오차 = max(호가 단위, 선 가격 × 0.15%)

export type SrEventType = 'SUPPORT_TOUCH' | 'SUPPORT_BREAKDOWN' | 'RESISTANCE_TOUCH' | 'RESISTANCE_BREAKOUT';

export interface SrEvent {
  type: SrEventType;
  key: SrKey;
  levelPrice: number;
  price: number;
  /** 선 이름(지표 레벨이면 20일선 등) — 없으면 화면이 역할 이름을 쓴다 */
  name?: string;
}

export type SrZone = 'above' | 'below' | 'near';
type Side = 'above' | 'below';

export const srEps = (level: number): number => Math.max(krxTick(level), level * SR_EPS_RATIO);

export function zoneOf(price: number, level: number): SrZone {
  const eps = srEps(level);
  if (price > level + eps) return 'above';
  if (price < level - eps) return 'below';
  return 'near';
}

function classify(lastSide: Side | null, zone: SrZone): SrEventType | null {
  if (lastSide === null) return null;
  if (zone === 'near') return lastSide === 'above' ? 'SUPPORT_TOUCH' : 'RESISTANCE_TOUCH';
  if (zone === 'below' && lastSide === 'above') return 'SUPPORT_BREAKDOWN';
  if (zone === 'above' && lastSide === 'below') return 'RESISTANCE_BREAKOUT';
  return null;
}

export class SrWatcher {
  private state = new Map<SrKey, { zone: SrZone; lastSide: Side | null; level: number }>();
  private fired = new Map<string, number>(); // `${key}:${type}` → 마지막 발생 시각

  /** 틱마다 호출 — 이번 틱에 생긴 이벤트(대개 0~1개) */
  update(levels: SrLevel[], price: number, nowMs: number): SrEvent[] {
    const out: SrEvent[] = [];
    const seen = new Set<SrKey>();
    for (const lv of levels) {
      seen.add(lv.key);
      const zone = zoneOf(price, lv.price);
      const prev = this.state.get(lv.key);
      // 처음 보는 선, 또는 선 자체가 오차보다 크게 뛴 경우(스크롤로 POC 이동·새 봉 시작 등) — 기준만 다시.
      // 가격은 그대로인데 선이 넘어와 생기는 가짜 돌파·이탈을 막는다. 틱마다의 작은 이평 변화는 오차 안이라 그대로 판정
      if (prev === undefined || Math.abs(lv.price - prev.level) > srEps(lv.price)) {
        this.state.set(lv.key, { zone, lastSide: zone === 'near' ? null : zone, level: lv.price });
        continue;
      }
      if (zone !== prev.zone) {
        const type = classify(prev.lastSide, zone);
        if (type !== null && this.take(`${lv.key}:${type}`, nowMs)) {
          out.push({ type, key: lv.key, levelPrice: lv.price, price, ...(lv.name !== undefined ? { name: lv.name } : {}) });
        }
      }
      this.state.set(lv.key, { zone, lastSide: zone === 'near' ? prev.lastSide : zone, level: lv.price });
    }
    for (const k of [...this.state.keys()]) if (!seen.has(k)) this.state.delete(k);
    return out;
  }

  /** 포지션 없음·화면 벗어남 — 다음 update 부터 기준을 새로 잡는다(재알림 간격 기록은 유지) */
  reset(): void {
    this.state.clear();
  }

  private take(id: string, nowMs: number): boolean {
    const last = this.fired.get(id);
    if (last !== undefined && nowMs - last < SR_COOLDOWN_MS) return false;
    this.fired.set(id, nowMs);
    return true;
  }
}

export interface SrCopy {
  title: string;
  body: string;
}

/** 대응 시트 문구(원 문서 03 §4 기반). name = 넓은 화면 이름(20선·BB상단·매물대) */
export function srEventCopy(type: SrEventType, name: string, levelPrice: number): SrCopy {
  const at = `${name}(${formatPrice(levelPrice)}원)`;
  switch (type) {
    case 'RESISTANCE_TOUCH':
      return { title: `🔔 [저항선 도달] ${at} 터치`, body: '매물 압박으로 단기 조정이 나올 수 있어요.' };
    case 'RESISTANCE_BREAKOUT':
      return { title: `🚀 [저항선 돌파] ${at} 상향 돌파`, body: '저항이 뚫리면 다음엔 지지선이 될 수 있어요.' };
    case 'SUPPORT_TOUCH':
      return { title: `🔔 [지지선 도달] ${at} 터치`, body: '반등이 나올 수 있는 자리예요.' };
    case 'SUPPORT_BREAKDOWN':
      return { title: `⚠️ [지지선 이탈] ${at} 하향 이탈`, body: '지지가 깨지면 추가 하락 위험이 커요.' };
  }
}
