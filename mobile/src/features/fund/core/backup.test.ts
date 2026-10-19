import { buildBackup, mergeBackup, parseBackup, shouldAutoBackup, type Backup, type LocalData } from './backup';
import { MAX_FUNDS } from './funds';
import type { HistoryPoint } from './history';

const u = (n: number) => `https://fund.ivyro.net/dataroom/om_data/t${n}.htm`;
const pt = (date: string, value: number, recordedAt = 1): HistoryPoint => ({ date, value, day: null, month: null, recordedAt });
let seq = 0;
const newId = () => `new${++seq}`;

describe('buildBackup', () => {
  it('로컬만 있으면 로컬 목록·기록 그대로', () => {
    const local: LocalData = { funds: [{ id: 'a', name: 'A', url: u(1) }], histories: { [u(1)]: { X: [pt('2026-10-01', 1)] } } };
    expect(buildBackup(local, null, 7)).toEqual({
      v: 1, exportedAt: 7, funds: [{ name: 'A', url: u(1) }], history: { [u(1)]: { X: [pt('2026-10-01', 1)] } },
    });
  });

  it('Drive 합본 — Drive 에만 있는 펀드·기록도 남긴다(재설치 직후 덮어쓰기 보호)', () => {
    const local: LocalData = { funds: [{ id: 'a', name: 'A', url: u(1) }], histories: { [u(1)]: { X: [pt('2026-10-09', 9, 9)] } } };
    const remote: Backup = {
      v: 1, exportedAt: 1,
      funds: [{ name: 'A옛', url: u(1) }, { name: 'B', url: u(2) }],
      history: { [u(1)]: { X: [pt('2026-10-01', 1)] }, [u(2)]: { Y: [pt('2026-10-01', 2)] } },
    };
    const b = buildBackup(local, remote, 10);
    expect(b.funds).toEqual([{ name: 'A', url: u(1) }, { name: 'B', url: u(2) }]); // 이름은 로컬 우선
    expect(b.history[u(1)].X.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-09']);
    expect(b.history[u(2)].Y).toHaveLength(1);
  });
});

describe('parseBackup', () => {
  it('최상위가 깨졌으면 null', () => {
    expect(parseBackup('{')).toBeNull();
    expect(parseBackup('{"v":2,"funds":[]}')).toBeNull();
    expect(parseBackup('{"v":1}')).toBeNull();
  });

  it('잘못된 펀드·주소·기록은 버린다', () => {
    const raw = JSON.stringify({
      v: 1, exportedAt: 3,
      funds: [{ name: 'A', url: u(1) }, { name: 'evil', url: 'https://evil.example/x.htm' }, { url: u(1) }, { name: 5, url: u(2) }],
      history: { [u(1)]: { X: [pt('2026-10-01', 1), { date: 'bad' }] }, 'https://evil.example/x.htm': { X: [pt('2026-10-01', 1)] } },
    });
    expect(parseBackup(raw)).toEqual({
      v: 1, exportedAt: 3,
      funds: [{ name: 'A', url: u(1) }, { name: '', url: u(2) }],
      history: { [u(1)]: { X: [pt('2026-10-01', 1)] } },
    });
  });
});

describe('mergeBackup', () => {
  const backup: Backup = {
    v: 1, exportedAt: 1,
    funds: [{ name: 'A', url: u(1) }, { name: 'B', url: u(2) }],
    history: { [u(1)]: { X: [pt('2026-10-01', 1)] }, [u(2)]: { Y: [pt('2026-10-02', 2)] } },
  };

  it('URL 기준으로 없는 펀드만 추가하고 기록을 합친다 — 두 번 해도 같다', () => {
    const local: LocalData = { funds: [{ id: 'a', name: '내A', url: u(1) }], histories: {} };
    const r1 = mergeBackup(local, backup, newId);
    expect(r1.funds.map((f) => [f.name, f.url])).toEqual([['내A', u(1)], ['B', u(2)]]);
    expect(r1.funds[1].id).toMatch(/^new/);
    expect(r1).toMatchObject({ addedFunds: 1, skippedFunds: 0, mergedPoints: 2 });
    const r2 = mergeBackup({ funds: r1.funds, histories: r1.histories }, backup, newId);
    expect(r2).toMatchObject({ addedFunds: 0, skippedFunds: 0, mergedPoints: 0 });
    expect(r2.funds).toEqual(r1.funds);
  });

  it(`${MAX_FUNDS}개 한도를 넘는 펀드는 건너뛰고 그 기록도 넣지 않는다`, () => {
    const funds = Array.from({ length: MAX_FUNDS }, (_, i) => ({ id: `f${i}`, name: '', url: u(100 + i) }));
    const r = mergeBackup({ funds, histories: {} }, backup, newId);
    expect(r.funds).toHaveLength(MAX_FUNDS);
    expect(r).toMatchObject({ addedFunds: 0, skippedFunds: 2, mergedPoints: 0 });
  });
});

describe('shouldAutoBackup', () => {
  const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime(); // 기기 로컬 시각
  it('한 번도 안 했거나 기기 날짜가 바뀌었으면 true', () => {
    expect(shouldAutoBackup(null, at(19, 9))).toBe(true);
    expect(shouldAutoBackup(at(18, 23), at(19, 0))).toBe(true);
    expect(shouldAutoBackup(at(19, 1), at(19, 23))).toBe(false);
  });
});

describe('기본 속성 이름 계좌', () => {
  it('parseBackup — hasOwnProperty 계좌가 있어도 던지지 않는다', () => {
    const raw = JSON.stringify({
      v: 1, exportedAt: 1, funds: [{ name: 'A', url: u(1) }],
      history: { [u(1)]: { hasOwnProperty: [pt('2026-10-01', 1)] } },
    });
    expect(parseBackup(raw)?.history[u(1)].hasOwnProperty).toEqual([pt('2026-10-01', 1)]);
  });
});
