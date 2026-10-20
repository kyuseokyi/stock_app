import {
  dayLabel,
  errorCode,
  formatAmount,
  formatChg,
  formatIndex,
  formatMacro,
  groupByDate,
  hasMoreGroups,
  mergeGroupPage,
  shiftDate,
  sparkPoints,
  sparkTone,
  splitEvents,
  toneOf,
} from './format';
import type { CalendarEvent, GroupItem } from './types';

const ev = (date: string, title = 't'): CalendarEvent => ({
  date, title, category: '공모주', ticker: null, name: null, detail: '',
});
const gi = (id: string): GroupItem => ({
  id, name: id, members: 1, chg: 0, value: 0, up: 0, down: 0, flat: 0, leader: null, rank: 1, streak: 0,
});

describe('금액·등락률·지수 표시', () => {
  it('금액은 조·억으로 줄이고 그 아래는 원', () => {
    expect(formatAmount(1_234_000_000_000)).toBe('1.2조');
    expect(formatAmount(345_600_000_000)).toBe('3,456억');
    expect(formatAmount(98_765)).toBe('98,765원');
  });
  it('등락률은 소수 한 자리·부호, 없으면 –', () => {
    expect(formatChg(1.234)).toBe('+1.2%');
    expect(formatChg(-0.06)).toBe('-0.1%');
    expect(formatChg(0.04)).toBe('0.0%');
    expect(formatChg(null)).toBe('–');
  });
  it('등락 색 구분', () => {
    expect(toneOf(2)).toBe('up');
    expect(toneOf(-1)).toBe('down');
    expect(toneOf(0)).toBe('flat');
    expect(toneOf(null)).toBe('flat');
  });
  it('지수는 콤마 + 소수 최대 두 자리(뒤 0 생략)', () => {
    expect(formatIndex(2601.5)).toBe('2,601.5');
    expect(formatIndex(808.891)).toBe('808.89');
    expect(formatIndex(1333)).toBe('1,333');
  });
  it('거시 지표 — 천 명 단위는 정수 콤마, 나머지는 소수 두 자리', () => {
    expect(formatMacro(256_123.4, '천 명')).toBe('256,123천 명');
    expect(formatMacro(4.1234, '%')).toBe('4.12%');
  });
});

describe('미니 추세선', () => {
  it('점이 2개 미만이면 null', () => {
    expect(sparkPoints([])).toBeNull();
    expect(sparkPoints([5])).toBeNull();
  });
  it('최소·최대를 아래·위 끝에 맞춘다(높이 30, 위아래 2 여백)', () => {
    expect(sparkPoints([1, 3])).toBe('0,28 100,2');
  });
  it('평평한 선은 바닥에 가로줄', () => {
    expect(sparkPoints([7, 7, 7])).toBe('0,28 50,28 100,28');
  });
  it('추세 색은 마지막 ≥ 첫 값이면 up', () => {
    expect(sparkTone([1, 2])).toBe('up');
    expect(sparkTone([2, 2])).toBe('up');
    expect(sparkTone([3, 1])).toBe('down');
  });
});

describe('일정', () => {
  it('날짜 더하기·빼기(월 경계 포함)', () => {
    expect(shiftDate('2026-10-20', 60)).toBe('2026-12-19');
    expect(shiftDate('2026-10-03', -7)).toBe('2026-09-26');
  });
  it('오늘 기준으로 지난 일정과 앞으로의 일정을 나눈다(오늘은 앞으로)', () => {
    const { past, upcoming } = splitEvents([ev('2026-10-18'), ev('2026-10-20'), ev('2026-10-25')], '2026-10-20');
    expect(past.map((e) => e.date)).toEqual(['2026-10-18']);
    expect(upcoming.map((e) => e.date)).toEqual(['2026-10-20', '2026-10-25']);
  });
  it('날짜별로 묶되 순서를 유지한다', () => {
    const g = groupByDate([ev('2026-10-20', 'a'), ev('2026-10-20', 'b'), ev('2026-10-21', 'c')]);
    expect(g.map((x) => [x.date, x.events.map((e) => e.title)])).toEqual([
      ['2026-10-20', ['a', 'b']],
      ['2026-10-21', ['c']],
    ]);
  });
  it('날짜 라벨 — 요일, 오늘 표시', () => {
    expect(dayLabel('2026-10-20', '2026-10-20')).toBe('10월 20일 (화) · 오늘');
    expect(dayLabel('2026-10-25', '2026-10-20')).toBe('10월 25일 (일)');
  });
});

describe('순위 더 불러오기', () => {
  it('이어 붙일 때 같은 id 는 한 번만', () => {
    expect(mergeGroupPage([gi('a'), gi('b')], [gi('b'), gi('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('끝 판정 — 받은 수가 한 페이지(30)보다 적거나 total 에 닿으면 끝', () => {
    expect(hasMoreGroups(30, 100, 30)).toBe(true);
    expect(hasMoreGroups(45, 100, 15)).toBe(false);
    expect(hasMoreGroups(60, 60, 30)).toBe(false);
  });
});

describe('오류 코드', () => {
  it('HTTP 상태가 있으면 HTTP nnn, 없으면 NETWORK', () => {
    expect(errorCode({ response: { status: 502 } })).toBe('HTTP 502');
    expect(errorCode(new Error('Network request failed'))).toBe('NETWORK');
  });
});
