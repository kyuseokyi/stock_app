import { evalDateOf, formatChecked, fundStatusLine } from './display';
import type { FundReport } from './types';

describe('formatChecked', () => {
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
  it('같은 날이면 시:분', () => {
    expect(formatChecked(at(18, 9, 5), at(18, 23, 0))).toBe('09:05');
  });
  it('다른 날이면 월/일 시:분', () => {
    expect(formatChecked(at(17, 15, 30), at(18, 8, 0))).toBe('10/17 15:30');
  });
});

describe('evalDateOf', () => {
  it('첫 자금 현황 섹션의 최종평가일, 없으면 빈 문자열', () => {
    const r: FundReport = {
      title: '',
      investorNo: '',
      investorName: '',
      notice: null,
      sections: [
        { kind: 'cert', title: '', companyLabel: '', company: [], fields: [] },
        { kind: 'accounts', title: '', evalDate: '2026-10-17', group: '', accounts: [], notes: [] },
      ],
    };
    expect(evalDateOf(r)).toBe('2026-10-17');
    expect(evalDateOf({ ...r, sections: [] })).toBe('');
  });
});

describe('fundStatusLine', () => {
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
  const report = (evalDate: string): FundReport => ({
    title: '',
    investorNo: '',
    investorName: '',
    notice: null,
    sections: evalDate ? [{ kind: 'accounts', title: '', evalDate, group: '', accounts: [], notes: [] }] : [],
  });
  it('캐시가 없으면 빈 문자열', () => {
    expect(fundStatusLine(null, at(19, 9, 0))).toBe('');
  });
  it('기준일 + 확인 시각', () => {
    expect(fundStatusLine({ fetchedAt: at(19, 14, 5), report: report('2026년 10월 19일') }, at(19, 15, 0))).toBe(
      '기준일 2026.10.19 · 14:05 확인',
    );
  });
  it('기준일이 없으면 확인 시각만(다른 날은 월/일)', () => {
    expect(fundStatusLine({ fetchedAt: at(18, 9, 0), report: report('') }, at(19, 9, 0))).toBe('10/18 09:00 확인');
  });
});
