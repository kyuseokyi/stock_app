import { readFileSync } from 'fs';
import { join } from 'path';
import { TextDecoder as NodeTextDecoder } from 'util'; // Expo 가 전역 TextDecoder 를 utf-8 전용으로 덮어쓴다

import { createDisclosureSource, fetchDisclosureHtml, findDisclosureDay, isoOfEvalDate, DISCLOSURE_URL } from './disclosure';

const html = new NodeTextDecoder('euc-kr').decode(readFileSync(join(__dirname, '../__fixtures__/disclosure.euckr.htm')));

describe('isoOfEvalDate', () => {
  it('리포트 기준일 원본 → YYYY-MM-DD', () => {
    expect(isoOfEvalDate('2026년 11월 2일')).toBe('2026-11-02');
    expect(isoOfEvalDate(' 2026년11월12일 ')).toBe('2026-11-12');
    expect(isoOfEvalDate('')).toBe('');
    expect(isoOfEvalDate('2026.11.12')).toBe('');
  });
});

describe('findDisclosureDay', () => {
  it('이번 달 일간 표에서 같은 날짜 줄의 당일 연환산·장중 거래내용', () => {
    expect(findDisclosureDay(html, '2026-11-12')).toEqual({
      date: '2026-11-12',
      annual: '52.7599%',
      note: '한국도 미국도 반등신호 건드림, 금융투자는 너무 흔드는데….',
    });
  });

  it('지난 달 일간 표의 날짜도 찾는다(월초)', () => {
    expect(findDisclosureDay(html, '2026-10-30')).toMatchObject({ annual: '25.9176%' });
  });

  it('없는 날짜·주말·잘못된 날짜는 null', () => {
    expect(findDisclosureDay(html, '2026-11-08')).toBeNull();
    expect(findDisclosureDay(html, '')).toBeNull();
    expect(findDisclosureDay(html, '2026년 11월 12일')).toBeNull();
  });

  it('줄 모양이 기대와 다르면(칸 부족·연환산 칸이 % 아님) null', () => {
    const row = (cells: string[]) => `<table><tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr></table>`;
    expect(findDisclosureDay(row(['2026-11-12', '목요일', '1', '0.1%', '5%']), '2026-11-12')).toBeNull();
    const shifted = ['2026-11-12', '목요일', '1', '0.1%', '하락장', '', '', '', '', '', '', '', '메모'];
    expect(findDisclosureDay(row(shifted), '2026-11-12')).toBeNull();
  });

  it('장중 거래내용이 비어 있으면 빈 문자열', () => {
    const cells = ['2026-11-12', '목요일', '1', '0.1%', '-5.5%', '', '', '', '', '', '', '', ''];
    const r = `<table><tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr></table>`;
    expect(findDisclosureDay(r, '2026-11-12')).toEqual({ date: '2026-11-12', annual: '-5.5%', note: '' });
  });
});

describe('fetchDisclosureHtml', () => {
  it('시트 주소를 바이트로 받아 decode 결과를 돌려준다', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(3) })) as unknown as typeof fetch;
    await expect(fetchDisclosureHtml((b) => `len${b.byteLength}`, 1000, fetchImpl)).resolves.toBe('len3');
    expect((fetchImpl as jest.Mock).mock.calls[0][0]).toBe(DISCLOSURE_URL);
  });

  it('응답 실패면 거부', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(fetchDisclosureHtml(() => '', 1000, fetchImpl)).rejects.toThrow('404');
  });
});

describe('createDisclosureSource', () => {
  it('ttl 안에서는 한 번만 받고, 지나면 다시 받는다', async () => {
    let t = 0;
    let calls = 0;
    const load = jest.fn(async (): Promise<string> => `v${++calls}`);
    const src = createDisclosureSource(load, () => t, 100);
    await expect(src.get()).resolves.toBe('v1');
    t = 50;
    await expect(src.get()).resolves.toBe('v1');
    t = 150;
    await expect(src.get()).resolves.toBe('v2');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidate 하면 ttl 안이라도 다시 받는다', async () => {
    let calls = 0;
    const src = createDisclosureSource(async () => `v${++calls}`, () => 0);
    await expect(src.get()).resolves.toBe('v1');
    src.invalidate();
    await expect(src.get()).resolves.toBe('v2');
  });

  it('실패는 기억하지 않는다', async () => {
    let n = 0;
    const src = createDisclosureSource(async () => (n++ === 0 ? Promise.reject(new Error('x')) : 'ok'), () => 0);
    await expect(src.get()).rejects.toThrow('x');
    await expect(src.get()).resolves.toBe('ok');
  });
});
