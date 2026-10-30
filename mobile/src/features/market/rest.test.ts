import { normalizeHeatmap, normalizeInvestorFlow, normalizeMorningBrief, normalizeMovers, num } from './rest-normalize';

describe('num', () => {
  it('유한한 숫자·숫자 문자열만 통과', () => {
    expect(num(1.5)).toBe(1.5);
    expect(num('2.5')).toBe(2.5);
    expect(num(NaN)).toBeNull();
    expect(num(Infinity)).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num('')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
  });
});

describe('normalizeMorningBrief', () => {
  it('brief 가 null·없음·헤드라인 빈 값이면 null', () => {
    expect(normalizeMorningBrief({ brief: null })).toBeNull();
    expect(normalizeMorningBrief(null)).toBeNull();
    expect(normalizeMorningBrief({})).toBeNull();
    expect(normalizeMorningBrief({ brief: { headline: '  ' } })).toBeNull();
  });
  it('필드를 camelCase 로 바꾸고 잘못된 섹터·체크포인트는 버린다', () => {
    const b = normalizeMorningBrief({
      brief: {
        date: '2026-10-30',
        headline: ' 나스닥 +1.4% ',
        us_market_summary: '빅테크 강세',
        kr_impact_summary: null,
        bullish_sectors: [{ sector: '반도체', reason: 'HBM' }, { reason: '섹터 없음' }, 'x'],
        bearish_sectors: 'oops',
        macro_checkpoints: ['환율 1,380원', 3, ''],
        created_at: '2026-10-30T08:30:00+09:00',
      },
    });
    expect(b).toEqual({
      date: '2026-10-30',
      headline: '나스닥 +1.4%',
      usMarketSummary: '빅테크 강세',
      krImpactSummary: '',
      bullishSectors: [{ sector: '반도체', reason: 'HBM' }],
      bearishSectors: [],
      macroCheckpoints: ['환율 1,380원'],
      createdAt: '2026-10-30T08:30:00+09:00',
    });
  });
});

describe('normalizeMovers', () => {
  it('빈 응답·이상한 값도 같은 모양', () => {
    expect(normalizeMovers(null)).toEqual({ updatedAt: null, gainers: [], losers: [], keywords: [] });
    expect(normalizeMovers({ gainers: 'x', losers: null })).toEqual({ updatedAt: null, gainers: [], losers: [], keywords: [] });
  });
  it('종목 정규화 — ticker 없는 항목 제외, 숫자 아닌 가격은 null, reliability 허용값만', () => {
    const m = normalizeMovers({
      updated_at: '2026-10-30T15:30:00+09:00',
      gainers: [
        { ticker: '005930', stock_name: '삼성전자', price: 71200, change_rate: 29.9, reason_summary: 'HBM 승인', category: '수주계약', reliability: '상', risk_warning: null },
        { ticker: '', stock_name: '빈 티커' },
        { ticker: '000660', price: 'NaN', change_rate: '12.5', reliability: '최상' },
      ],
      losers: [],
      keywords: [{ keyword: '#HBM', background: '수요 급증', tickers: ['000660', 7] }, { keyword: '' }],
    });
    expect(m.updatedAt).toBe('2026-10-30T15:30:00+09:00');
    expect(m.gainers).toHaveLength(2);
    expect(m.gainers[0]).toEqual({
      ticker: '005930', stockName: '삼성전자', price: 71200, changeRate: 29.9,
      reasonSummary: 'HBM 승인', category: '수주계약', reliability: '상', riskWarning: null,
    });
    expect(m.gainers[1]).toMatchObject({ ticker: '000660', stockName: '000660', price: null, changeRate: 12.5, reliability: null });
    expect(m.keywords).toEqual([{ keyword: 'HBM', background: '수요 급증', tickers: ['000660'] }]);
  });
  it('각 목록은 최대 10개', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ticker: String(i), change_rate: i }));
    expect(normalizeMovers({ gainers: many, losers: many }).gainers).toHaveLength(10);
  });
});

describe('normalizeInvestorFlow', () => {
  it('빈 응답', () => {
    expect(normalizeInvestorFlow({})).toEqual({
      date: null, source: null, foreignTop: [], institutionTop: [], pensionTop: [], doubleBuy: [], aiComment: null, updatedAt: null,
    });
  });
  it('금액이 숫자가 아니면 그 항목 제외, source 허용값만', () => {
    const f = normalizeInvestorFlow({
      date: '2026-10-30',
      source: 'kis',
      foreign_top: [{ ticker: '005930', name: '삼성전자', net_amount: 123_400_000_000 }, { ticker: '1', net_amount: 'x' }],
      institution_top: null,
      pension_top: [],
      double_buy: [{ ticker: '000660', name: 'SK하이닉스', foreign_amount: 1e10, institution_amount: '5e9' }, { ticker: '2', foreign_amount: 1 }],
      ai_comment: ' 외인 반도체 매수 ',
      updated_at: '2026-10-30T18:10:00+09:00',
    });
    expect(f.source).toBe('kis');
    expect(f.foreignTop).toEqual([{ ticker: '005930', name: '삼성전자', netAmount: 123_400_000_000 }]);
    expect(f.institutionTop).toEqual([]);
    expect(f.doubleBuy).toEqual([{ ticker: '000660', name: 'SK하이닉스', foreignAmount: 1e10, institutionAmount: 5e9 }]);
    expect(f.aiComment).toBe('외인 반도체 매수');
    expect(normalizeInvestorFlow({ source: 'krx' }).source).toBeNull();
  });
});

describe('normalizeHeatmap', () => {
  it('크기 0·음수·숫자 아님 그룹과 종목은 빠지고 기타 칸(ticker "")은 남는다', () => {
    const h = normalizeHeatmap({
      date: '2026-10-30',
      groups: [
        {
          id: 'G1', name: '반도체', chg: 2.1, size: 100,
          stocks: [
            { ticker: '005930', name: '삼성전자', chg: 1.2, size: 60 },
            { ticker: '', name: '기타 12종목', chg: null, size: 10 },
            { ticker: 'X', name: '0 크기', chg: 1, size: 0 },
          ],
        },
        { id: 'G2', name: '빈', chg: 1, size: 0, stocks: [] },
        { id: 'G3', name: '이상', chg: 'x', size: 'NaN' },
        { id: 7, name: '숫자 id', chg: 'x', size: 5 },
      ],
    });
    expect(h.date).toBe('2026-10-30');
    expect(h.groups.map((g) => g.id)).toEqual(['G1', '7']);
    expect(h.groups[0].stocks.map((s) => s.ticker)).toEqual(['005930', '']);
    expect(h.groups[1].chg).toBeNull();
    expect(h.groups[1].stocks).toEqual([]);
  });
  it('null 응답', () => {
    expect(normalizeHeatmap(null)).toEqual({ date: null, groups: [] });
  });
});
