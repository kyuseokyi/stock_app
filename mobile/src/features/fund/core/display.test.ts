import { evalDateOf, formatChecked } from './display';
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
