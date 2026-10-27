import type { SrLevel } from './sr-levels';
import { SR_COOLDOWN_MS, srEps, srEventCopy, SrWatcher, zoneOf } from './sr-watch';

// 50,000원 선: 호가 100 > 0.15%(75) → 오차 100. 띠 = 49,900~50,100
const L: SrLevel = { key: 'trendHigh', role: 'resistance', price: 50_000, color: '#x' };
const types = (evs: { type: string }[]) => evs.map((e) => e.type);

describe('srEps·zoneOf', () => {
  test('오차 = max(호가, 0.15%)', () => {
    expect(srEps(50_000)).toBe(100);
    expect(srEps(100_000)).toBe(150);
    expect(srEps(1_000)).toBe(1.5);
  });
  test('띠 경계는 near', () => {
    expect(zoneOf(50_100, 50_000)).toBe('near');
    expect(zoneOf(50_101, 50_000)).toBe('above');
    expect(zoneOf(49_900, 50_000)).toBe('near');
    expect(zoneOf(49_899, 50_000)).toBe('below');
  });
});

describe('SrWatcher', () => {
  test('처음 보는 선은 기준만 잡고 이벤트 없음', () => {
    const w = new SrWatcher();
    expect(w.update([L], 51_000, 0)).toEqual([]);
  });
  test('위 → 띠 안 = 지지 터치, 이어서 아래 = 지지 이탈', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    expect(w.update([L], 50_050, 1)).toEqual([{ type: 'SUPPORT_TOUCH', key: 'trendHigh', levelPrice: 50_000, price: 50_050 }]);
    expect(types(w.update([L], 49_800, 2))).toEqual(['SUPPORT_BREAKDOWN']);
  });
  test('아래 → 띠 안 = 저항 터치, 이어서 위 = 저항 돌파', () => {
    const w = new SrWatcher();
    w.update([L], 49_000, 0);
    expect(types(w.update([L], 49_950, 1))).toEqual(['RESISTANCE_TOUCH']);
    expect(types(w.update([L], 50_200, 2))).toEqual(['RESISTANCE_BREAKOUT']);
  });
  test('위 → 아래 한 번에 = 이탈만', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    expect(types(w.update([L], 49_000, 1))).toEqual(['SUPPORT_BREAKDOWN']);
  });
  test('띠 안에서 오르내림은 이벤트 없음', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    w.update([L], 50_050, 1);
    expect(w.update([L], 49_950, 2)).toEqual([]);
    expect(w.update([L], 50_080, 3)).toEqual([]);
  });
  test('띠 안 → 원래 쪽 복귀는 이벤트 없음, 같은 이벤트는 10분 뒤 다시', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    expect(types(w.update([L], 50_050, 1))).toEqual(['SUPPORT_TOUCH']);
    expect(w.update([L], 50_500, 2)).toEqual([]);
    expect(w.update([L], 50_050, 3)).toEqual([]); // 10분 안
    w.update([L], 50_500, 4);
    expect(types(w.update([L], 50_050, 1 + SR_COOLDOWN_MS))).toEqual(['SUPPORT_TOUCH']);
  });
  test('처음이 띠 안이면 띠 밖으로 나간 뒤부터 판정', () => {
    const w = new SrWatcher();
    w.update([L], 50_000, 0);
    expect(w.update([L], 50_050, 1)).toEqual([]);
    expect(w.update([L], 49_000, 2)).toEqual([]); // 어느 쪽에서 왔는지 모름
    expect(types(w.update([L], 49_950, 3))).toEqual(['RESISTANCE_TOUCH']);
  });
  test('목록에서 빠진 선은 상태를 버리고 다시 들어오면 기준부터', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    expect(w.update([], 50_050, 1)).toEqual([]);
    expect(w.update([L], 50_050, 2)).toEqual([]);
  });
  test('reset 하면 모두 기준부터', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    w.reset();
    expect(w.update([L], 50_050, 1)).toEqual([]);
  });
  test('선이 오차보다 크게 뛰면(스크롤로 POC 이동 등) 이벤트 없이 기준만 다시', () => {
    const w = new SrWatcher();
    const line = (price: number): SrLevel => ({ key: 'trendLow', role: 'resistance', price, color: '#x' });
    w.update([line(50_000)], 51_000, 0); // 가격이 선 위
    expect(w.update([line(52_000)], 51_000, 1)).toEqual([]); // 가격은 그대로, 선이 위로 뜀 → 이탈 아님
    expect(types(w.update([line(52_000)], 51_950, 2))).toEqual(['RESISTANCE_TOUCH']); // 새 기준(아래)에서 판정
  });
  test('오차 안의 작은 선 움직임(틱마다 이평 변화)은 그대로 판정', () => {
    const w = new SrWatcher();
    w.update([L], 51_000, 0);
    const moved: SrLevel = { ...L, price: 50_050 }; // 50원 이동 < 오차 100
    expect(types(w.update([moved], 50_100, 1))).toEqual(['SUPPORT_TOUCH']);
  });
});

describe('srEventCopy', () => {
  test('문구', () => {
    expect(srEventCopy('SUPPORT_BREAKDOWN', '20선', 72_000)).toEqual({
      title: '⚠️ [지지선 이탈] 20선(72,000원) 하향 이탈',
      body: '지지가 깨지면 추가 하락 위험이 커요.',
    });
    expect(srEventCopy('RESISTANCE_TOUCH', 'BB상단', 74_200).title).toBe('🔔 [저항선 도달] BB상단(74,200원) 터치');
  });
});
