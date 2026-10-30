import {
  createAnalysisLoader,
  createLimiter,
  createTtlCache,
  isAnalyzableTicker,
  normalizeScreenerAnalysis,
  redFlagBadge,
  type ScreenerAnalysis,
} from './ai-analysis';

const raw = {
  ticker: '005930',
  hook_summary: ' 수출 단가 인상에 따른 본업 성장 ',
  growth_quality: '본업성장',
  financial_quality_note: '영업이익 중심 증가',
  red_flag_level: 'WARNING',
  red_flags: ['CB 전환물량 12% 대기', 3, '', null, '대주주 지분 매각'],
  date: '2026-10-30',
  created_at: '2026-10-30T16:10:00+09:00',
};

const sample = (over: Partial<ScreenerAnalysis> = {}): ScreenerAnalysis => ({
  ticker: '005930',
  hookSummary: '요약',
  growthQuality: null,
  financialQualityNote: '',
  redFlagLevel: 'CLEAN',
  redFlags: [],
  date: '2026-10-30',
  ...over,
});

/** 대기 중인 프로미스 콜백을 모두 흘려보낸다 */
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('isAnalyzableTicker', () => {
  it('6자리 영숫자만 허용', () => {
    expect(isAnalyzableTicker('005930')).toBe(true);
    expect(isAnalyzableTicker('0088M0')).toBe(true);
    expect(isAnalyzableTicker('05930')).toBe(false);
    expect(isAnalyzableTicker('005930A')).toBe(false);
    expect(isAnalyzableTicker('00-930')).toBe(false);
  });
});

describe('normalizeScreenerAnalysis', () => {
  it('analysis 가 null·없음·객체가 아니면 null', () => {
    expect(normalizeScreenerAnalysis({ analysis: null })).toBeNull();
    expect(normalizeScreenerAnalysis({})).toBeNull();
    expect(normalizeScreenerAnalysis(null)).toBeNull();
    expect(normalizeScreenerAnalysis({ analysis: ['x'] })).toBeNull();
  });
  it('camelCase 로 바꾸고 red_flags 는 비어 있지 않은 문자열만 남긴다', () => {
    expect(normalizeScreenerAnalysis({ analysis: raw })).toEqual({
      ticker: '005930',
      hookSummary: '수출 단가 인상에 따른 본업 성장',
      growthQuality: '본업성장',
      financialQualityNote: '영업이익 중심 증가',
      redFlagLevel: 'WARNING',
      redFlags: ['CB 전환물량 12% 대기', '대주주 지분 매각'],
      date: '2026-10-30',
    });
  });
  it('허용값 밖의 실적 품질·지뢰 단계는 null, red_flags 가 배열이 아니면 빈 배열', () => {
    const a = normalizeScreenerAnalysis({
      analysis: { ...raw, growth_quality: '좋음', red_flag_level: 'SAFE', red_flags: 'oops' },
    });
    expect(a?.growthQuality).toBeNull();
    expect(a?.redFlagLevel).toBeNull();
    expect(a?.redFlags).toEqual([]);
  });
  it('지뢰 단계는 소문자도 받는다', () => {
    expect(normalizeScreenerAnalysis({ analysis: { ...raw, red_flag_level: 'danger' } })?.redFlagLevel).toBe('DANGER');
  });
  it('포착 사유도 지뢰 단계도 없으면 null', () => {
    expect(normalizeScreenerAnalysis({ analysis: { ...raw, hook_summary: ' ', red_flag_level: '?' } })).toBeNull();
  });
});

describe('redFlagBadge', () => {
  it('단계별 색 계열과 문구', () => {
    expect(redFlagBadge(sample())).toEqual({ tone: 'safe', text: 'CLEAN 안전' });
    expect(redFlagBadge(sample({ redFlagLevel: 'WARNING', redFlags: ['CB 12%', '기타'] }))).toEqual({
      tone: 'caution',
      text: 'WARNING CB 12%',
    });
    expect(redFlagBadge(sample({ redFlagLevel: 'DANGER', redFlags: ['감사의견 한정'] }))).toEqual({
      tone: 'danger',
      text: 'DANGER 감사의견 한정',
    });
  });
  it('사유가 없으면 단계만, 단계가 없으면 null', () => {
    expect(redFlagBadge(sample({ redFlagLevel: 'WARNING' }))?.text).toBe('WARNING');
    expect(redFlagBadge(sample({ redFlagLevel: null }))).toBeNull();
  });
});

describe('createTtlCache', () => {
  it('만료 전에는 null 값도 돌려주고, 만료되면 지운다', () => {
    let t = 0;
    const c = createTtlCache<string | null>(() => t);
    c.set('a', null, 100);
    expect(c.get('a')).toEqual({ value: null });
    t = 99;
    expect(c.get('a')).toEqual({ value: null });
    t = 100;
    expect(c.get('a')).toBeUndefined();
    expect(c.size()).toBe(0);
    expect(c.get('없음')).toBeUndefined();
  });
});

describe('createLimiter', () => {
  it('동시에 max 개까지만 실행하고 끝나면 다음 것을 순서대로 시작한다', async () => {
    const limiter = createLimiter(2);
    const started: number[] = [];
    const resolvers: (() => void)[] = [];
    const tasks = [0, 1, 2, 3].map((i) =>
      limiter.run(
        () =>
          new Promise<number>((res) => {
            started.push(i);
            resolvers[i] = () => res(i);
          }),
      ),
    );
    expect(started).toEqual([0, 1]);
    expect(limiter.stats()).toEqual({ running: 2, waiting: 2 });
    resolvers[1]();
    await flush();
    expect(started).toEqual([0, 1, 2]);
    resolvers[0]();
    resolvers[2]();
    await flush();
    resolvers[3]();
    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3]);
    expect(limiter.stats()).toEqual({ running: 0, waiting: 0 });
  });
  it('실패한 작업도 자리를 비운다', async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limiter.run(() => Promise.resolve(1))).resolves.toBe(1);
  });
});

describe('createAnalysisLoader', () => {
  it('같은 종목은 진행 중 요청을 공유하고, 결과(null 포함)는 만료 전까지 다시 요청하지 않는다', async () => {
    let t = 0;
    const fetcher = jest.fn(async (ticker: string) => (ticker === '000001' ? sample() : null));
    const loader = createAnalysisLoader({ fetcher, ttlMs: 1000, failTtlMs: 10, maxConcurrent: 4, now: () => t });
    const [a, b] = await Promise.all([loader.load('000001'), loader.load('000001')]);
    expect(a).toEqual(sample());
    expect(b).toBe(a);
    expect(await loader.load('000002')).toBeNull();
    expect(await loader.load('000002')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(loader.peek('000002')).toEqual({ value: null });
    t = 1000;
    await loader.load('000001');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('실패는 던지지 않고 null + onError, 짧은 시간 뒤 다시 시도한다', async () => {
    let t = 0;
    const onError = jest.fn();
    const fetcher = jest.fn().mockRejectedValueOnce(new Error('네트워크')).mockResolvedValueOnce(sample());
    const loader = createAnalysisLoader({ fetcher, ttlMs: 1000, failTtlMs: 10, maxConcurrent: 4, now: () => t, onError });
    expect(await loader.load('000001')).toBeNull();
    expect(onError).toHaveBeenCalledWith('000001', expect.any(Error));
    expect(await loader.load('000001')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    t = 10;
    expect(await loader.load('000001')).toEqual(sample());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('동시 요청 수를 제한한다', async () => {
    let active = 0;
    let peak = 0;
    const fetcher = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await flush();
      active -= 1;
      return null;
    };
    const loader = createAnalysisLoader({ fetcher, ttlMs: 1000, failTtlMs: 10, maxConcurrent: 4 });
    await Promise.all(Array.from({ length: 12 }, (_, i) => loader.load(String(i).padStart(6, '0'))));
    expect(peak).toBe(4);
  });
});
