import {
  BB_LINE_COLOR,
  pickSrLevels,
  POC_RESIST_COLOR,
  POC_SUPPORT_COLOR,
  srAxisTitle,
  srCandidates,
  srName,
  srSignature,
  type SrCandidate,
  type SrLevel,
} from './sr-levels';

const MA = [5, 20, 60] as const;
const COLORS = ['#a', '#b', '#c'] as const;
const c = (key: SrCandidate['key'], price: number): SrCandidate => ({ key, price, color: '#x' });

describe('pickSrLevels', () => {
  test('현재가 위로 가까운 저항 2개, 아래로 가까운 지지 2개', () => {
    const got = pickSrLevels(
      [c('ma5', 101), c('ma20', 103), c('ma60', 99), c('bbUpper', 110), c('bbLower', 90), c('poc', 98)],
      100,
    );
    expect(got.map((l) => [l.key, l.role])).toEqual([
      ['ma5', 'resistance'],
      ['ma20', 'resistance'],
      ['ma60', 'support'],
      ['poc', 'support'],
    ]);
  });
  test('현재가와 같은 값은 저항', () => {
    expect(pickSrLevels([c('ma5', 100)], 100)[0].role).toBe('resistance');
  });
  test('같은 가격은 앞 순서(ma5→…→poc) 하나만', () => {
    const got = pickSrLevels([c('poc', 105), c('ma20', 105)], 100);
    expect(got.map((l) => l.key)).toEqual(['ma20']);
  });
  test('NaN·0 이하는 버림', () => {
    expect(pickSrLevels([c('ma5', Number.NaN), c('ma20', 0), c('ma60', -1)], 100)).toEqual([]);
  });
});

describe('srCandidates', () => {
  const values = { ma5: 101, ma20: 102, ma60: 103, bbUpper: 110, bbLower: 90 };
  test('켜진 지표만', () => {
    const got = srCandidates({ values, ma: false, bb: true, poc: null, maColors: COLORS }, 100);
    expect(got.map((x) => x.key)).toEqual(['bbUpper', 'bbLower']);
    expect(got[0].color).toBe(BB_LINE_COLOR);
  });
  test('이평 색은 칸 순서대로', () => {
    const got = srCandidates({ values, ma: true, bb: false, poc: null, maColors: COLORS }, 100);
    expect(got.map((x) => [x.key, x.color])).toEqual([
      ['ma5', '#a'],
      ['ma20', '#b'],
      ['ma60', '#c'],
    ]);
  });
  test('값 없는 이평은 빠짐', () => {
    const got = srCandidates({ values: { ma5: 101 }, ma: true, bb: false, poc: null, maColors: COLORS }, 100);
    expect(got.map((x) => x.key)).toEqual(['ma5']);
  });
  test('POC 색은 현재가 위(저항) 주황, 아래(지지) 보라', () => {
    const up = srCandidates({ values: {}, ma: false, bb: false, poc: 105, maColors: COLORS }, 100);
    const down = srCandidates({ values: {}, ma: false, bb: false, poc: 95, maColors: COLORS }, 100);
    expect(up[0]).toEqual({ key: 'poc', price: 105, color: POC_RESIST_COLOR });
    expect(down[0].color).toBe(POC_SUPPORT_COLOR);
  });
});

describe('이름·라벨', () => {
  const lv = (key: SrLevel['key'], role: SrLevel['role']): SrLevel => ({ key, role, price: 1, color: '#x' });
  test('srName', () => {
    expect(srName('ma20', MA, false)).toBe('20선');
    expect(srName('ma20', MA, true)).toBe('20');
    expect(srName('bbUpper', MA, false)).toBe('BB상단');
    expect(srName('bbLower', MA, true)).toBe('BB-');
    expect(srName('poc', MA, false)).toBe('매물대');
    expect(srName('poc', MA, true)).toBe('POC');
  });
  test('srAxisTitle', () => {
    expect(srAxisTitle(lv('ma20', 'resistance'), MA, false)).toBe('[저항] 20선');
    expect(srAxisTitle(lv('poc', 'support'), MA, true)).toBe('지지 POC');
  });
});

describe('srSignature', () => {
  test('호가 안의 작은 변화는 같은 서명', () => {
    const a: SrLevel[] = [{ key: 'ma5', role: 'resistance', price: 71_210, color: '#x' }];
    const b: SrLevel[] = [{ key: 'ma5', role: 'resistance', price: 71_240, color: '#x' }];
    expect(srSignature(a)).toBe(srSignature(b));
  });
  test('역할이 바뀌면 다른 서명', () => {
    const a: SrLevel[] = [{ key: 'ma5', role: 'resistance', price: 100, color: '#x' }];
    const b: SrLevel[] = [{ key: 'ma5', role: 'support', price: 100, color: '#x' }];
    expect(srSignature(a)).not.toBe(srSignature(b));
  });
});
