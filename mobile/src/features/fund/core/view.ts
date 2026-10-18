// 리포트 화면 모델(B안 정렬 그리드 카드) — 표시 포맷을 여기서 한 번만 적용하고 웹·앱은 그리기만 한다.
// 원본 값은 raw 로 남겨 title(툴팁)에 쓴다. web_client/src/lib/fundCore 와 동일.
// 규칙: docs/superpowers/specs/fund-report-design/README.md "표시 포맷 규칙"
import type { Account, FundReport, Link, Pair } from './types';

export type Tone = 'up' | 'down' | 'zero' | '';
export type ViewCell = { text: string; unit: string; tone: Tone; raw: string };
export type ViewRow = { label: string; value: ViewCell; highlight?: boolean };
export type AccountView = {
  name: string;
  since: string; // 포맷된 초기화/시작일
  hero: ViewRow | null; // 크게 보여줄 값
  summary: ViewRow[]; // hero 아래 한 줄 요약(총 손익금 · 누적수익율)
  rows: ViewRow[];
  details: ViewRow[]; // CODE·그룹 구분코드 — 접어서
  memo: { title: string; lines: string[] } | null;
};
export type NoticeView = { label: string; message: string; signals: string; links: Link[] };
export type AccountsView = {
  kind: 'accounts';
  title: string;
  group: string;
  evalDate: string; // 포맷된 섹션 최종평가일
  accounts: AccountView[];
  notes: { title: string; items: string[]; links: Link[] }[];
};
export type StepsView = { kind: 'steps'; title: string; steps: { no: string; name: string; rows: ViewRow[] }[]; links: Link[] };
export type CertView = { kind: 'cert'; title: string; company: string; rows: ViewRow[] };
export type SectionView = AccountsView | StepsView | CertView;
export type ReportView = { title: string; evalDate: string; notice: NoticeView | null; sections: SectionView[] };

const CODE_KEYS = ['CODE', '그룹 구분코드'];
const DAY_KEYS = ['경과일수'];
const HERO_KEYS = ['현재평가금', '수익측정가치'];
const SUMMARY_KEYS = ['총 손익금', '누적수익율'];
const SINCE_KEY = '초기화/시작일';
const MINUS = '−';

const RE_INT = /^₩?-?[\d,]+$/;
const RE_PCT = /^-?\d+(\.\d+)?%$/;
const RE_DATE = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/;

const isSigned = (k: string) => /손익|입출금|수익율/.test(k) && !k.includes('목표');
const isToned = (k: string) => /손익|수익율/.test(k) && !k.includes('목표');
const comma = (d: string) => d.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function signed(key: string, neg: boolean, zero: boolean, body: string): string {
  if (zero) return body;
  if (neg) return MINUS + body;
  return isSigned(key) ? `+${body}` : body;
}
const toneOf = (key: string, neg: boolean, zero: boolean): Tone =>
  isToned(key) ? (zero ? 'zero' : neg ? 'down' : 'up') : '';

/** 항목 이름(key)에 따라 값 하나를 화면용으로 포맷 */
export function formatValue(key: string, raw: string): ViewCell {
  const cell = (text: string, unit = '', tone: Tone = ''): ViewCell => ({ text, unit, tone, raw });
  if (RE_INT.test(raw)) {
    if (CODE_KEYS.includes(key)) return cell(raw);
    const digits = raw.replace(/\D/g, '');
    if (DAY_KEYS.includes(key)) return cell(comma(digits), '일');
    const neg = raw.includes('-');
    const zero = /^0+$/.test(digits);
    return cell(signed(key, neg, zero, comma(digits)), '원', toneOf(key, neg, zero));
  }
  if (RE_PCT.test(raw)) {
    const n = parseFloat(raw);
    const zero = Math.abs(n) < 0.005;
    return cell(signed(key, n < 0, zero, Math.abs(n).toFixed(2)), '%', toneOf(key, n < 0, zero));
  }
  const d = RE_DATE.exec(raw);
  if (d) return cell(`${d[1]}.${d[2].padStart(2, '0')}.${d[3].padStart(2, '0')}`);
  return cell(raw);
}

const row = ([label, raw]: Pair): ViewRow => ({ label, value: formatValue(label, raw) });
const safeLinks = (links: Link[]): Link[] => links.filter(([, href]) => /^https?:\/\//i.test(href));
const fmtDate = (raw: string) => (raw ? formatValue('', raw).text : '');

function accountView(a: Account): AccountView {
  const pairs = [...a.values, ...a.remarks];
  const has = (k: string) => pairs.some(([key]) => key === k);
  const heroKey = HERO_KEYS.find(has);
  const heroPair = pairs.find(([k]) => k === heroKey);
  const summaryKeys = heroKey ? SUMMARY_KEYS : []; // 대표값이 없으면 요약 항목은 일반 행으로
  const sincePair = pairs.find(([k]) => k === SINCE_KEY);
  return {
    name: a.name,
    since: sincePair ? fmtDate(sincePair[1]) : '',
    hero: heroPair ? row(heroPair) : null,
    summary: summaryKeys.flatMap((k) => pairs.filter(([key]) => key === k).slice(0, 1).map(row)),
    rows: pairs
      .filter(([k]) => k !== heroKey && !summaryKeys.includes(k) && k !== SINCE_KEY && !CODE_KEYS.includes(k))
      .map(row),
    details: pairs.filter(([k]) => CODE_KEYS.includes(k)).map(row),
    memo: a.remarkText,
  };
}

/** 파싱된 리포트 → 화면 모델(포맷 적용·링크 필터 완료) */
export function toReportView(report: FundReport): ReportView {
  const n = report.notice;
  const firstEval = report.sections.find((s) => s.kind === 'accounts' && s.evalDate);
  return {
    title: report.title,
    evalDate: firstEval?.kind === 'accounts' ? fmtDate(firstEval.evalDate) : '',
    notice: n && {
      label: n.label,
      message: n.message,
      signals: n.signals.length
        ? `${n.signalsLabel} ${n.signals.map(([k, v]) => `${k} ${v}`).join(' · ')}`.trim()
        : '',
      links: safeLinks(n.links),
    },
    sections: report.sections.map((s): SectionView => {
      switch (s.kind) {
        case 'accounts':
          return {
            kind: 'accounts',
            title: s.title,
            group: s.group,
            evalDate: fmtDate(s.evalDate),
            accounts: s.accounts.map(accountView),
            notes: s.notes.map((nb) => ({
              title: nb.title,
              items: nb.items.map((segs) => segs.map(([t]) => t).join('')),
              links: safeLinks(nb.links),
            })),
          };
        case 'steps':
          return {
            kind: 'steps',
            title: s.title,
            steps: s.steps.map((st) => ({
              no: st.no,
              name: st.name,
              rows: st.items.map(([k, v, hl]) => ({ ...row([k, v]), highlight: hl })),
            })),
            links: safeLinks(s.links),
          };
        case 'cert':
          return { kind: 'cert', title: s.title, company: s.company.join(' '), rows: s.fields.map(row) };
      }
    }),
  };
}
