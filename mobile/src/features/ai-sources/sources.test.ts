import { formatSourceDate, normalizeSources } from './sources';

describe('normalizeSources', () => {
  it('없거나 배열이 아니면 빈 배열', () => {
    expect(normalizeSources(undefined)).toEqual([]);
    expect(normalizeSources(null)).toEqual([]);
    expect(normalizeSources('x')).toEqual([]);
    expect(normalizeSources({})).toEqual([]);
  });
  it('camelCase 로 바꾸고 제목·주소가 빈 항목과 http(s) 아닌 주소는 버린다', () => {
    expect(
      normalizeSources([
        { title: ' 삼성전자 HBM 승인 ', url: 'https://news.example.com/a', pub_date: '2026-11-12T23:30:00Z' },
        { title: '', url: 'https://x.com' },
        { title: '스크립트', url: 'javascript:alert(1)' },
        { title: '날짜 없음', url: 'http://n.example.com/b', pub_date: null },
        'oops',
      ]),
    ).toEqual([
      { title: '삼성전자 HBM 승인', url: 'https://news.example.com/a', pubDate: '2026-11-12T23:30:00Z' },
      { title: '날짜 없음', url: 'http://n.example.com/b', pubDate: null },
    ]);
  });
  it('최대 3개', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, url: `https://e.com/${i}` }));
    expect(normalizeSources(many)).toHaveLength(3);
  });
});

describe('formatSourceDate', () => {
  it('KST 기준 M.D — UTC 전날 밤은 다음 날로', () => {
    expect(formatSourceDate('2026-11-12T23:30:00Z')).toBe('11.13');
    expect(formatSourceDate('2026-11-13T09:00:00+09:00')).toBe('11.13');
    expect(formatSourceDate('2026-01-05')).toBe('1.5');
  });
  it('없거나 잘못된 값은 빈 문자열', () => {
    expect(formatSourceDate(null)).toBe('');
    expect(formatSourceDate(undefined)).toBe('');
    expect(formatSourceDate('not-a-date')).toBe('');
  });
});
