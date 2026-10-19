import fs from 'fs';
import path from 'path';

import type { FundReport } from './types';
import { formatValue, parseAmount, toReportView, type ReportView, type ViewRow } from './view';

const FX = path.join(__dirname, '..', '__fixtures__');
const fixture = (f: string): FundReport => JSON.parse(fs.readFileSync(path.join(FX, `${f}.json`), 'utf8'));

describe('formatValue — 표시 포맷 규칙', () => {
  it('금액: 쉼표 + 원, ₩ 접두는 떼고 원본은 raw 로', () => {
    expect(formatValue('현재평가금', '132,950,396')).toEqual({ text: '132,950,396', unit: '원', tone: '', raw: '132,950,396' });
    expect(formatValue('출금 가능금액', '₩699,709,989')).toEqual({ text: '699,709,989', unit: '원', tone: '', raw: '₩699,709,989' });
    expect(formatValue('전월말 평가금', '1234567')).toMatchObject({ text: '1,234,567', unit: '원' });
  });

  it('음수는 U+2212, 부호 대상(손익·입출금·수익율)은 + 도 붙인다', () => {
    expect(formatValue('현재평가금', '-1,000').text).toBe('−1,000');
    expect(formatValue('총 손익금', '902,290,411')).toMatchObject({ text: '+902,290,411', tone: 'up' });
    expect(formatValue('당일 손익금', '-741,863')).toMatchObject({ text: '−741,863', tone: 'down' });
  });

  it('0 은 부호 없이, 색은 zero', () => {
    expect(formatValue('월 손익금', '0')).toMatchObject({ text: '0', unit: '원', tone: 'zero' });
    expect(formatValue('월간 입출금 총계', '0')).toMatchObject({ text: '0', tone: '' });
  });

  it('입출금은 부호만 있고 색은 없다', () => {
    expect(formatValue('월간 입출금 총계', '-6,000,000')).toMatchObject({ text: '−6,000,000', tone: '' });
    expect(formatValue('입출금 총계', '852,600,000')).toMatchObject({ text: '+852,600,000', tone: '' });
  });

  it('목표값은 부호·색 제외', () => {
    expect(formatValue('남은목표금액', '29,079,218')).toMatchObject({ text: '29,079,218', tone: '' });
    expect(formatValue('(3)목표 수익율', '80.48%')).toEqual({ text: '80.48', unit: '%', tone: '', raw: '80.48%' });
  });

  it('퍼센트: 소수 2자리 반올림 + 부호·색', () => {
    expect(formatValue('누적수익율', '53.3334%')).toEqual({ text: '+53.33', unit: '%', tone: 'up', raw: '53.3334%' });
    expect(formatValue('누적수익율', '-1.005%')).toMatchObject({ text: '−1.00', tone: 'down' });
    expect(formatValue('누적수익율', '0.0040%')).toMatchObject({ text: '0.00', tone: 'zero' });
    expect(formatValue('대출이자율', '70.0000%')).toMatchObject({ text: '70.00', unit: '%', tone: '' });
    expect(formatValue('누적수익율', '7%').text).toBe('+7.00');
  });

  it('날짜: YYYY.MM.DD', () => {
    expect(formatValue('초기화/시작일', '2026년 1월 5일')).toEqual({ text: '2026.01.05', unit: '', tone: '', raw: '2026년 1월 5일' });
    expect(formatValue('은퇴시기', '2040년 12월 31일').text).toBe('2040.12.31');
  });

  it('경과일수: N일, CODE·그룹 구분코드: 그대로', () => {
    expect(formatValue('경과일수', '1644')).toMatchObject({ text: '1,644', unit: '일', tone: '' });
    expect(formatValue('CODE', '263')).toEqual({ text: '263', unit: '', tone: '', raw: '263' });
    expect(formatValue('그룹 구분코드', '11')).toMatchObject({ text: '11', unit: '' });
  });

  it('그 밖의 값은 그대로', () => {
    expect(formatValue('펀드 정보', '데이 트레이딩')).toEqual({ text: '데이 트레이딩', unit: '', tone: '', raw: '데이 트레이딩' });
  });
});

const allRows = (v: ReportView): ViewRow[] =>
  v.sections.flatMap((s) =>
    s.kind === 'accounts'
      ? s.accounts.flatMap((a) => [...(a.hero ? [a.hero] : []), ...a.summary, ...a.rows, ...a.details])
      : s.kind === 'steps'
        ? s.steps.flatMap((st) => st.rows)
        : s.rows,
  );

describe.each(['current', 'legacy'])('toReportView — %s 픽스처', (name) => {
  const report = fixture(name);
  const view = toReportView(report);

  it('제목·기준일(포맷)·섹션 수', () => {
    expect(view.title).toBe(report.title);
    expect(view.evalDate).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    expect(view.sections.map((s) => s.kind)).toEqual(report.sections.map((s) => s.kind));
  });

  it('모든 계좌에 대표값(hero)이 있고 시작일은 포맷된다', () => {
    for (const s of view.sections) {
      if (s.kind !== 'accounts') continue;
      expect(s.evalDate).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
      for (const a of s.accounts) {
        expect(['현재평가금', '수익측정가치']).toContain(a.hero?.label);
        expect(a.since).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
        const labels = a.rows.map((r) => r.label);
        for (const k of [a.hero?.label, '총 손익금', '누적수익율', '초기화/시작일', 'CODE', '그룹 구분코드'])
          expect(labels).not.toContain(k);
        for (const d of a.details) expect(['CODE', '그룹 구분코드']).toContain(d.label);
      }
    }
  });

  it('값에 ₩ 가 없고 퍼센트는 모두 소수 2자리', () => {
    const rows = allRows(view);
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      expect(r.value.text).not.toContain('₩');
      if (r.value.unit === '%') expect(r.value.text).toMatch(/^[+−]?\d+\.\d{2}$/);
      expect(r.value.raw).not.toBe('');
    }
  });

  it('공지 문구와 신호', () => {
    expect(view.notice?.label).toBe(report.notice?.label);
    expect(view.notice?.message).toBe(report.notice?.message);
    expect(view.notice?.signals).toContain(report.notice?.signals[0][1]);
  });

  it('메모·확인사항·사실증명', () => {
    const acc = view.sections.find((s) => s.kind === 'accounts');
    expect(acc?.kind === 'accounts' && acc.accounts[0].memo?.lines.length).toBeGreaterThan(0);
    expect(acc?.kind === 'accounts' && acc.notes[0].items[0]).toMatch(/^"입출금 총계" 항목은/);
    const cert = view.sections.find((s) => s.kind === 'cert');
    expect(cert?.kind === 'cert' && cert.rows.length).toBeGreaterThan(0);
  });
});

describe('toReportView — 링크·대표값 없음', () => {
  const base = fixture('current');

  it('링크는 http(s) 만 남긴다', () => {
    const r: FundReport = {
      ...base,
      notice: base.notice && { ...base.notice, links: [['ok', 'https://a.example'], ['bad', 'javascript:alert(1)']] },
      sections: [
        { kind: 'steps', title: 's', steps: [], links: [['ok', 'http://b.example'], ['bad', 'data:text/html,x']] },
        {
          kind: 'accounts',
          title: 'a',
          evalDate: '',
          group: '',
          accounts: [],
          notes: [{ title: 'n', items: [], links: [['bad', '/relative'], ['ok', 'HTTPS://c.example']] }],
        },
      ],
    };
    const v = toReportView(r);
    expect(v.notice?.links).toEqual([['ok', 'https://a.example']]);
    expect(v.sections[0].kind === 'steps' && v.sections[0].links).toEqual([['ok', 'http://b.example']]);
    expect(v.sections[1].kind === 'accounts' && v.sections[1].notes[0].links).toEqual([['ok', 'HTTPS://c.example']]);
    expect(v.evalDate).toBe('');
  });

  it('대표값이 없으면 요약 항목은 일반 행으로 남는다', () => {
    const v = toReportView({
      ...base,
      sections: [
        {
          kind: 'accounts',
          title: 'a',
          evalDate: '2026년 10월 17일',
          group: 'g',
          accounts: [
            { name: 'x', values: [['총 손익금', '10'], ['누적수익율', '1%']], remarks: [], remarkText: null },
          ],
          notes: [],
        },
      ],
    });
    const s = v.sections[0];
    expect(s.kind === 'accounts' && s.accounts[0]).toMatchObject({
      hero: null,
      summary: [],
      since: '',
      rows: [{ label: '총 손익금' }, { label: '누적수익율' }],
    });
    expect(v.evalDate).toBe('2026.10.17');
  });
});

describe('parseAmount', () => {
  it('원본 금액 문자열 → 숫자', () => {
    expect(parseAmount('₩12,345,000')).toBe(12345000);
    expect(parseAmount('-15,000')).toBe(-15000);
    expect(parseAmount(' 0 ')).toBe(0);
    expect(parseAmount('1.5%')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});
