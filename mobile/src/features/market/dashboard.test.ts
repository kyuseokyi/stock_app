import {
  closeBasis,
  formatBasis,
  formatEok,
  formatShortDate,
  heatLevel,
  indexBasisTime,
  indexHeaderBasis,
  latestTime,
  marketSession,
  parseKst,
  splitCarousel,
  topStocks,
} from './dashboard';

describe('formatBasis (KST 기준 시각)', () => {
  it('오프셋 있는 ISO', () => {
    expect(formatBasis('2026-10-30T15:30:12+09:00')).toBe('10.30 15:30 기준');
    expect(formatBasis('2026-10-30T06:30:00Z')).toBe('10.30 15:30 기준');
  });
  it('오프셋 없는 문자열은 KST 로 본다', () => {
    expect(formatBasis('2026-10-30T09:05:00')).toBe('10.30 09:05 기준');
    expect(formatBasis('2026-10-30 23:59')).toBe('10.30 23:59 기준');
  });
  it('자정 넘김(UTC 전날 → KST 다음날)', () => {
    expect(formatBasis('2026-10-29T15:10:00Z')).toBe('10.30 00:10 기준');
  });
  it('읽을 수 없으면 null', () => {
    expect(formatBasis(null)).toBeNull();
    expect(formatBasis('어제')).toBeNull();
  });
});

describe('formatShortDate', () => {
  it("'YYYY-MM-DD' → 'MM.DD'", () => {
    expect(formatShortDate('2026-10-30')).toBe('10.30');
    expect(formatShortDate(null)).toBe('');
  });
});

describe('latestTime · indexBasisTime', () => {
  it('가장 최근 시각을 고른다(형식 섞여도)', () => {
    expect(latestTime(['2026-10-30T15:30:00+09:00', null, '2026-10-30T07:00:00Z', 'x'])).toBe('2026-10-30T07:00:00Z');
    expect(latestTime([null, undefined])).toBeNull();
  });
  it('국내 지수 — 장중이면 asOf, 확정이면 15:30, 해외는 null', () => {
    expect(indexBasisTime({ region: 'KR', date: '2026-10-30', live: true, asOf: '11:30' })).toBe('2026-10-30T11:30:00+09:00');
    expect(indexBasisTime({ region: 'KR', date: '2026-10-30', live: false, asOf: null })).toBe('2026-10-30T15:30:00+09:00');
    expect(indexBasisTime({ region: 'US', date: '2026-10-29', live: false, asOf: null })).toBeNull();
    expect(parseKst(indexBasisTime({ region: 'KR', date: '2026-10-30', live: true, asOf: '11:30' }))).toBe(Date.UTC(2026, 9, 30, 2, 30));
  });
});

describe('marketSession (장운영 뱃지)', () => {
  const kst = (iso: string) => new Date(`${iso}+09:00`);
  it('국내 지수 없으면 null', () => {
    expect(marketSession([{ region: 'US', live: false }], kst('2026-10-30T10:00:00'))).toBeNull();
  });
  it('장중 값이면 정규장', () => {
    expect(marketSession([{ region: 'KR', live: true }], kst('2026-10-30T10:00:00'))).toBe('정규장');
  });
  it('평일 09:00 전은 장 시작 전, 장 후·주말은 장마감', () => {
    const kr = [{ region: 'KR', live: false }];
    expect(marketSession(kr, kst('2026-10-30T08:10:00'))).toBe('장 시작 전'); // 금
    expect(marketSession(kr, kst('2026-10-30T16:00:00'))).toBe('장마감');
    expect(marketSession(kr, kst('2026-10-31T08:10:00'))).toBe('장마감'); // 토
  });
});

describe('formatEok (억 단위)', () => {
  it('부호·콤마', () => {
    expect(formatEok(123_456_000_000)).toBe('+1,235억');
    expect(formatEok(-5_600_000_000)).toBe('-56억');
  });
  it('1억 미만은 소수 한 자리, 0 은 부호 없음', () => {
    expect(formatEok(30_000_000)).toBe('+0.3억');
    expect(formatEok(-1_000_000)).toBe('0억');
    expect(formatEok(0)).toBe('0억');
  });
  it('1조 이상은 조', () => {
    expect(formatEok(1_234_000_000_000)).toBe('+1.2조');
    expect(formatEok(-999_960_000_000)).toBe('-1.0조');
  });
});

describe('heatLevel (히트맵 색 단계)', () => {
  it('없음·0 근처는 flat', () => {
    expect(heatLevel(null)).toEqual({ tone: 'flat', level: 0 });
    expect(heatLevel(0.04)).toEqual({ tone: 'flat', level: 0 });
    expect(heatLevel(NaN)).toEqual({ tone: 'flat', level: 0 });
  });
  it('크기에 따라 3단계', () => {
    expect(heatLevel(0.5)).toEqual({ tone: 'up', level: 0 });
    expect(heatLevel(1)).toEqual({ tone: 'up', level: 1 });
    expect(heatLevel(-2.9)).toEqual({ tone: 'down', level: 1 });
    expect(heatLevel(-3)).toEqual({ tone: 'down', level: 2 });
    expect(heatLevel(12)).toEqual({ tone: 'up', level: 2 });
  });
});

describe('topStocks', () => {
  it("기타 칸 제외, 크기 큰 순 5개", () => {
    const stocks = [
      { ticker: 'A', name: 'A', chg: 1, size: 10 },
      { ticker: '', name: '기타 9종목', chg: null, size: 999 },
      { ticker: 'B', name: 'B', chg: 1, size: 50 },
      { ticker: 'C', name: 'C', chg: 1, size: 30 },
      { ticker: 'D', name: 'D', chg: 1, size: 20 },
      { ticker: 'E', name: 'E', chg: 1, size: 5 },
      { ticker: 'F', name: 'F', chg: 1, size: 1 },
    ];
    const g = { stocks };
    expect(topStocks(g).map((s) => s.ticker)).toEqual(['B', 'C', 'D', 'A', 'E']);
    expect(g.stocks[0].ticker).toBe('A'); // 원본 순서 유지
  });
});

describe('splitCarousel', () => {
  it('정해진 순서로 캐러셀, 나머지는 rest', () => {
    const codes = ['US:VIX', 'FX:USDKRW', 'KR:2001', 'US:SPX', 'KR:0001', 'US:COMP'];
    const { carousel, rest } = splitCarousel(codes.map((code) => ({ code })));
    expect(carousel.map((i) => i.code)).toEqual(['KR:0001', 'US:COMP', 'US:SPX', 'FX:USDKRW']);
    expect(rest.map((i) => i.code)).toEqual(['US:VIX', 'KR:2001']);
  });
});

describe('closeBasis', () => {
  it('날짜만 주면 MM.DD 종가 기준', () => {
    expect(closeBasis('2026-10-30')).toBe('10.30 종가 기준');
  });
  it('오늘 날짜면 그대로', () => {
    expect(closeBasis('2026-11-02', '2026-11-02')).toBe('11.02 종가 기준');
  });
  it('오늘이 아니면 전 거래일 표시', () => {
    expect(closeBasis('2026-10-30', '2026-11-02')).toBe('전 거래일(10.30) 종가 기준');
  });
  it('날짜가 없으면 null', () => {
    expect(closeBasis(null)).toBeNull();
    expect(closeBasis(undefined, '2026-11-02')).toBeNull();
    expect(closeBasis('', '2026-11-02')).toBeNull();
  });
});

describe('indexHeaderBasis', () => {
  const kr = (over: Partial<{ date: string; live: boolean; asOf: string | null }> = {}) => ({
    region: 'KR', date: '2026-11-02', live: false, asOf: null, ...over,
  });
  const us = { region: 'US', date: '2026-11-03', live: false, asOf: null };

  it('장중이면 가장 늦은 시각을 지수 장중으로', () => {
    expect(indexHeaderBasis([kr({ live: true, asOf: '14:30' }), kr({ live: true, asOf: '14:32' }), us])).toBe('지수 장중 14:32 기준');
  });
  it('장중인데 시각을 모르면 시각 없이', () => {
    expect(indexHeaderBasis([kr({ live: true })])).toBe('지수 장중');
  });
  it('장 마감 후엔 그날 15:30', () => {
    expect(indexHeaderBasis([kr()])).toBe('지수 11.02 15:30 기준');
  });
  it('미국·환율 날짜는 쓰지 않는다', () => {
    expect(indexHeaderBasis([kr(), us])).toBe('지수 11.02 15:30 기준');
  });
  it('국내 지수가 없으면 null', () => {
    expect(indexHeaderBasis([us])).toBeNull();
    expect(indexHeaderBasis([])).toBeNull();
  });
});
