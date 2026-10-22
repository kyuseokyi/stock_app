import {
  addFund,
  defaultName,
  displayName,
  MAX_FUNDS,
  MAX_NAME,
  mergeFundLists,
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

  it('펀드 주소가 아닌 항목은 걸러낸다', () => {
    const raw = JSON.stringify([
      { id: 'a', name: '', url: url(1) },
      { id: 'b', name: '', url: 'javascript:alert(1)' },
      { id: 'c', name: '', url: 'https://evil.com/x.htm' },
    ]);
    expect(parseFundList(raw)).toEqual([{ id: 'a', name: '', url: url(1) }]);
  });
});

describe('mergeFundLists(옛 기기 목록 가져오기)', () => {
  const e = (id: string, n: number): FundEntry => ({ id, name: `펀드${n}`, url: url(n) });

  it('내 목록을 앞에, 옛 목록을 뒤에 붙인다(옛 id 그대로 — 캐시·기록 파일이 id 기준)', () => {
    const r = mergeFundLists([e('m1', 1)], [e('o2', 2), e('o3', 3)]);
    expect(r.funds).toEqual([e('m1', 1), e('o2', 2), e('o3', 3)]);
    expect(r).toMatchObject({ added: 2, skipped: 0, duplicates: [], dropped: [] });
  });

  it('URL 이 같은 옛 펀드는 넣지 않고 어느 펀드로 합쳐야 하는지 알려 준다', () => {
    const r = mergeFundLists([e('m1', 1)], [e('o1', 1), e('o2', 2)]);
    expect(r.funds.map((f) => f.id)).toEqual(['m1', 'o2']);
    expect(r.duplicates).toEqual([{ legacy: e('o1', 1), mine: e('m1', 1) }]);
    expect(r.added).toBe(1);
  });

  it('옛 목록 안의 URL 중복도 하나만', () => {
    const r = mergeFundLists([], [e('o1', 1), e('o1b', 1)]);
    expect(r.funds.map((f) => f.id)).toEqual(['o1']);
    expect(r.duplicates).toEqual([{ legacy: e('o1b', 1), mine: e('o1', 1) }]);
  });

  it(`MAX_FUNDS(${MAX_FUNDS}) 까지만 — 넘친 개수와 펀드를 돌려준다`, () => {
    const mine = Array.from({ length: MAX_FUNDS - 1 }, (_, i) => e(`m${i}`, i));
    const legacy = [e('o100', 100), e('o101', 101), e('o102', 102)];
    const r = mergeFundLists(mine, legacy);
    expect(r.funds).toHaveLength(MAX_FUNDS);
    expect(r.funds[MAX_FUNDS - 1].id).toBe('o100');
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(2);
    expect(r.dropped.map((f) => f.id)).toEqual(['o101', 'o102']);
  });

  it('같은 id 가 이미 내 목록에 있으면(가져오기 도중 중단 후 재시도) 그대로 둔다 — 멱등', () => {
    const first = mergeFundLists([e('m1', 1)], [e('o2', 2)]);
    const again = mergeFundLists(first.funds, [e('o2', 2)]);
    expect(again.funds).toEqual(first.funds);
    expect(again).toMatchObject({ added: 0, skipped: 0, duplicates: [], dropped: [] });
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const mine = [e('m1', 1)];
    mergeFundLists(mine, [e('o2', 2)]);
    expect(mine).toEqual([e('m1', 1)]);
  });
});
