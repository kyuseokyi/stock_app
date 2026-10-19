import current from '../__fixtures__/current.json';
import legacy from '../__fixtures__/legacy.json';
import {
  emptyHistory,
  mergeAccounts,
  mergePoint,
  parseHistory,
  snapshotOf,
  toIsoDate,
  type FundHistory,
  type HistoryPoint,
} from './history';
import type { FundReport } from './types';

const URL1 = 'https://fund.ivyro.net/dataroom/om_data/t1.htm';
const pt = (date: string, value: number | null, recordedAt = 1): HistoryPoint => ({ date, value, day: 1, month: 2, recordedAt });

describe('toIsoDate', () => {
  it('원본 한글 날짜를 모양만 보고 YYYY-MM-DD 로', () => {
    expect(toIsoDate('2026년 10월 9일')).toBe('2026-10-09');
    expect(toIsoDate('3072년 90월 99일')).toBe('3072-90-99'); // 가린 픽스처 — 범위 검사 안 함
    expect(toIsoDate('2026-10-09')).toBe('2026-10-09');
    expect(toIsoDate('어제')).toBeNull();
  });
});

describe('snapshotOf', () => {
  it('current 픽스처 — 첫 accounts 섹션의 계좌별 세 값', () => {
    const s = snapshotOf(current as FundReport, 100);
    expect(s?.date).toBe('3072-90-99');
    expect(s?.points['총 계']).toEqual({ date: '3072-90-99', value: 132950396, day: 741863, month: 7799528, recordedAt: 100 });
    expect(s?.points['홍길동(월초700)']).toEqual({ date: '3072-90-99', value: 752340496, day: 383414, month: 4582934, recordedAt: 100 });
  });

  it('legacy 픽스처도 읽는다', () => {
    const s = snapshotOf(legacy as FundReport, 5);
    expect(s?.date).toBe('9074-03-05');
    expect(s?.points['홍길동']?.value).toBe(487019615);
  });

  it('못 읽는 값은 null, 세 값이 모두 없으면 그 계좌는 뺀다, 같은 이름은 첫 번째만', () => {
    const r: FundReport = {
      title: 't', investorNo: '', investorName: '', notice: null,
      sections: [{
        kind: 'accounts', title: 'a', evalDate: '2026년 10월 9일', group: '', notes: [],
        accounts: [
          { name: 'A', values: [['현재평가금', '₩1,000'], ['당일 손익금', '-50'], ['월 손익금', '??']], remarks: [], remarkText: null },
          { name: 'B', values: [['기타', '1']], remarks: [], remarkText: null },
          { name: 'A', values: [['현재평가금', '9']], remarks: [], remarkText: null },
        ],
      }],
    };
    expect(snapshotOf(r, 1)).toEqual({
      date: '2026-10-09',
      points: { A: { date: '2026-10-09', value: 1000, day: -50, month: null, recordedAt: 1 } },
    });
  });

  it('최종평가일이 없으면 null', () => {
    expect(snapshotOf({ title: '', investorNo: '', investorName: '', notice: null, sections: [] }, 1)).toBeNull();
  });
});

describe('mergePoint', () => {
  it('새 날짜는 추가(added) 하고 날짜 오름차순을 지킨다', () => {
    const h: FundHistory = { v: 1, url: URL1, accounts: { A: [pt('2026-10-08', 1)] } };
    const r = mergePoint(h, { date: '2026-10-07', points: { A: pt('2026-10-07', 2) } });
    expect(r.added).toBe(true);
    expect(r.history.accounts.A.map((p) => p.date)).toEqual(['2026-10-07', '2026-10-08']);
  });

  it('같은 날짜는 새 값으로 교체(added=false)', () => {
    const h: FundHistory = { v: 1, url: URL1, accounts: { A: [pt('2026-10-08', 1, 9)] } };
    const r = mergePoint(h, { date: '2026-10-08', points: { A: pt('2026-10-08', 5, 1) } });
    expect(r.added).toBe(false);
    expect(r.history.accounts.A).toEqual([pt('2026-10-08', 5, 1)]);
  });

  it('__proto__ 같은 계좌명은 무시', () => {
    const points = JSON.parse('{"__proto__":{"date":"2026-10-08","value":1,"day":1,"month":1,"recordedAt":1}}');
    const r = mergePoint(emptyHistory(URL1), { date: '2026-10-08', points });
    expect(Object.keys(r.history.accounts)).toEqual([]);
  });
});

describe('mergeAccounts', () => {
  it('합집합, 같은 날짜는 recordedAt 이 늦은 쪽, 바뀐 수를 센다(멱등)', () => {
    const base = { A: [pt('2026-10-01', 1, 5), pt('2026-10-02', 2, 5)] };
    const extra = { A: [pt('2026-10-02', 9, 9), pt('2026-10-03', 3, 1)], B: [pt('2026-10-01', 7)] };
    const r1 = mergeAccounts(base, extra);
    expect(r1.changed).toBe(3);
    expect(r1.accounts.A.map((p) => p.value)).toEqual([1, 9, 3]);
    expect(r1.accounts.B).toHaveLength(1);
    expect(mergeAccounts(r1.accounts, extra).changed).toBe(0);
  });
});

describe('parseHistory', () => {
  it('깨진 파일·잘못된 점은 버린다', () => {
    expect(parseHistory(null, URL1)).toEqual(emptyHistory(URL1));
    expect(parseHistory('{', URL1)).toEqual(emptyHistory(URL1));
    expect(parseHistory('{"v":2,"accounts":{}}', URL1)).toEqual(emptyHistory(URL1));
    const raw = JSON.stringify({
      v: 1,
      url: 'x',
      accounts: { A: [pt('2026-10-02', 2), { date: '10/02', value: 1 }, pt('2026-10-01', null)], B: 'nope' },
    });
    const h = parseHistory(raw, URL1);
    expect(h.url).toBe(URL1); // 저장소가 아는 url 을 쓴다
    expect(h.accounts).toEqual({ A: [pt('2026-10-01', null), pt('2026-10-02', 2)] });
  });
});

describe('기본 속성 이름 계좌', () => {
  it('parseHistory — toString 계좌를 유지하고 던지지 않는다', () => {
    const raw = JSON.stringify({ v: 1, accounts: { toString: [pt('2026-10-01', 1)] } });
    expect(parseHistory(raw, URL1).accounts).toEqual({ toString: [pt('2026-10-01', 1)] });
  });

  it('mergePoint — valueOf 계좌를 추가한다', () => {
    const r = mergePoint(emptyHistory(URL1), { date: '2026-10-08', points: { valueOf: pt('2026-10-08', 1) } });
    expect(r.added).toBe(true);
    expect(r.history.accounts.valueOf).toEqual([pt('2026-10-08', 1)]);
  });
});
