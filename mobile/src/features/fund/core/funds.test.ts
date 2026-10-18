import {
  addFund,
  defaultName,
  displayName,
  MAX_FUNDS,
  MAX_NAME,
  parseFundList,
  removeFund,
  renameFund,
  type FundEntry,
} from './funds';
import { isFundError, type FundReport } from './types';

const url = (n: number) => `https://fund.ivyro.net/dataroom/om_data/f${n}.htm`;

describe('addFund', () => {
  it('이름을 다듬어(20자) 끝에 추가한다', () => {
    const list = addFund([], { name: `  ${'가'.repeat(25)} `, url: ` ${url(1)} ` }, 'a');
    expect(list).toEqual([{ id: 'a', name: '가'.repeat(MAX_NAME), url: url(1) }]);
  });

  it('같은 URL 은 거부', () => {
    const list = addFund([], { name: '', url: url(1) }, 'a');
    expect(() => addFund(list, { name: '', url: url(1) }, 'b')).toThrow('이미 등록한 주소예요.');
  });

  it(`${MAX_FUNDS}개를 넘으면 거부`, () => {
    let list: FundEntry[] = [];
    for (let i = 0; i < MAX_FUNDS; i += 1) list = addFund(list, { name: '', url: url(i) }, `id${i}`);
    expect.assertions(1);
    try {
      addFund(list, { name: '', url: url(99) }, 'x');
    } catch (e) {
      expect(isFundError(e, 'input')).toBe(true);
    }
  });
});

describe('목록 조작', () => {
  const list: FundEntry[] = [
    { id: 'a', name: '', url: url(1) },
    { id: 'b', name: '둘', url: url(2) },
  ];

  it('removeFund / renameFund', () => {
    expect(removeFund(list, 'a').map((f) => f.id)).toEqual(['b']);
    expect(renameFund(list, 'a', ' 하나 ')[0].name).toBe('하나');
  });

  it('displayName 은 빈 이름에 기본 문구', () => {
    expect(displayName(list[0])).toBe('이름 없는 펀드');
    expect(displayName(list[1])).toBe('둘');
  });

  it('defaultName 은 투자자 번호 우선', () => {
    const r: FundReport = { title: '(12)홍길동', investorNo: '12', investorName: '홍길동', notice: null, sections: [] };
    expect(defaultName(r)).toBe('펀드 12');
    expect(defaultName({ ...r, investorNo: '' })).toBe('(12)홍길동');
  });
});

describe('parseFundList', () => {
  it('깨진 값은 빈 목록, 잘못된 항목은 걸러낸다', () => {
    expect(parseFundList(null)).toEqual([]);
    expect(parseFundList('{')).toEqual([]);
    expect(parseFundList('{"a":1}')).toEqual([]);
    expect(parseFundList(JSON.stringify([{ id: 'a', name: '', url: url(1) }, { id: 1 }, null]))).toEqual([
      { id: 'a', name: '', url: url(1) },
    ]);
  });
});
