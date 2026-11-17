import {
  currentFeaturedTab,
  featuredCaption,
  featuredEmptyText,
  featuredMoreText,
  featuredRows,
  featuredTabText,
  featuredTabs,
  hasFeatured,
  viMeta,
} from './featured';
import { normalizeFeatured } from './rest-normalize';

const EMPTY = normalizeFeatured({});

const RAW = {
  date: '2026-11-16',
  highs: { count: 35, items: [{ ticker: '000660', name: 'SK하이닉스', market: 'KOSPI', close: 200000, change_rate: 5.123 }] },
  lows: { count: 0, items: [] },
  vi: {
    date: '2026-11-17',
    updated_at: '2026-11-17T10:05:00+09:00',
    count: 1,
    items: [{ ticker: '005930', name: '삼성전자', time: '09:15:03', kind: '동적', direction: 'up', price: 67000, rate: 3.3, count: 2 }],
  },
};

describe('normalizeFeatured', () => {
  it('빈 응답·잘못된 값은 빈 모양, vi 는 null', () => {
    expect(EMPTY).toEqual({ date: null, highs: { count: 0, items: [] }, lows: { count: 0, items: [] }, vi: null });
    expect(normalizeFeatured({ highs: 'x', lows: { items: [1, {}], count: 'a' }, vi: [] })).toEqual(EMPTY);
  });
  it('필드를 camelCase 로, 방향·횟수 보정', () => {
    const f = normalizeFeatured(RAW);
    expect(f.highs.items[0]).toEqual({ ticker: '000660', name: 'SK하이닉스', market: 'KOSPI', close: 200000, changeRate: 5.123 });
    expect(f.highs.count).toBe(35);
    expect(f.vi?.items[0].direction).toBe('up');
    const odd = normalizeFeatured({ vi: { items: [{ ticker: 'A', direction: 'side', count: 0 }] } });
    expect(odd.vi?.items[0]).toMatchObject({ direction: null, count: 1 });
    expect(odd.vi?.count).toBe(1);
  });
});

describe('오늘 특징주 카드 규칙(렌더 대신 — 빈 상태·VI 숨김)', () => {
  const f = normalizeFeatured(RAW);
  it('VI 탭은 데이터가 있을 때만, 사라지면 신고가로 되돌림', () => {
    expect(featuredTabs(f)).toEqual(['highs', 'lows', 'vi']);
    expect(featuredTabs({ ...f, vi: null })).toEqual(['highs', 'lows']);
    expect(currentFeaturedTab('vi', { ...f, vi: null })).toBe('highs');
    expect(currentFeaturedTab('lows', f)).toBe('lows');
  });
  it('카드는 신고저가나 VI 중 하나라도 있을 때만', () => {
    expect(hasFeatured(EMPTY)).toBe(false);
    expect(hasFeatured(undefined)).toBe(false);
    expect(hasFeatured({ ...EMPTY, date: '2026-11-16' })).toBe(true);
    expect(hasFeatured({ ...EMPTY, vi: { date: null, updatedAt: null, count: 0, items: [] } })).toBe(true);
  });
  it('빈 상태 문구', () => {
    expect(featuredEmptyText('highs', f)).toBe('오늘 신고가 종목이 없어요');
    expect(featuredEmptyText('lows', f)).toBe('오늘 신저가 종목이 없어요');
    expect(featuredEmptyText('vi', f)).toBe('오늘 VI 발동 종목이 아직 없어요');
    expect(featuredEmptyText('highs', EMPTY)).toContain('장 마감 뒤 계산');
    expect(featuredRows('lows', f)).toEqual({ total: 0, shown: 0 });
  });
  it('탭 글자·기준·더 보기·VI 보조 글자', () => {
    expect(featuredTabText('highs', f)).toBe('신고가 35');
    expect(featuredTabText('lows', f)).toBe('신저가');
    expect(featuredTabText('vi', f)).toBe('VI 발동 1');
    expect(featuredCaption('highs', f, '2026-11-16')).toBe('11.16 종가 기준');
    expect(featuredCaption('highs', f, '2026-11-17')).toBe('전 거래일(11.16) 종가 기준');
    expect(featuredCaption('vi', f)).toBe('11.17 10:05 기준');
    expect(featuredRows('highs', f)).toEqual({ total: 35, shown: 1 });
    expect(featuredMoreText(35, 20)).toBe('전체 35종목 중 20종목');
    expect(featuredMoreText(3, 3)).toBeNull();
    expect(viMeta(f.vi!.items[0])).toBe('동적 · 상승 · 2회');
    expect(viMeta({ ...f.vi!.items[0], kind: '', direction: null, count: 1 })).toBe('');
  });
});
