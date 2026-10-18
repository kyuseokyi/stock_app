import fs from 'fs';
import path from 'path';

import { findMissing, parseFundReport } from './parse';
import { isFundError, type FundReport } from './types';

const FX = path.join(__dirname, '..', '__fixtures__');
const read = (f: string) => fs.readFileSync(path.join(FX, f), 'utf8');

describe('parseFundReport — convert.py 교차 검증', () => {
  it.each(['current', 'legacy'])('%s 양식: convert.py JSON 과 같고 누락이 없다', (name) => {
    const { report, missing } = parseFundReport(read(`${name}.html`));
    expect(report).toEqual(JSON.parse(read(`${name}.json`)));
    expect(missing).toEqual([]);
  });
});

describe('parseFundReport — 형식 오류', () => {
  it('섹션이 하나도 없으면 format 오류', () => {
    expect.assertions(1);
    try {
      parseFundReport('<html><body><table><tr><td>x</td></tr></table></body></html>');
    } catch (e) {
      expect(isFundError(e, 'format')).toBe(true);
    }
  });
});

describe('findMissing', () => {
  const empty: FundReport = { title: '', investorNo: '', investorName: '', notice: null, sections: [] };

  it('원본 셀의 숫자·2글자 이상 단어가 결과에 없으면 숫자 먼저, 정렬해서 돌려준다', () => {
    expect(findMissing(['총 손익금 1,234', '2. 항목 9%'], empty)).toEqual(['1,234', '9%', '손익금', '항목']);
  });

  it('목록 번호("1. ")와 템플릿 라벨(최종평가일)은 검사하지 않는다', () => {
    expect(findMissing(['1. 최종평가일'], empty)).toEqual([]);
  });

  it('결과에 있으면 빈 배열', () => {
    const r = { ...empty, title: '손익금 1,234' };
    expect(findMissing(['손익금 1,234'], r)).toEqual([]);
  });
});
