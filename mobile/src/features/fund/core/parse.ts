// 격자 → 섹션 추출 + 누락 검증. fund_report/convert.py 의 extract_* · convert 를 그대로 옮긴 것.
// 값은 원본 문자열 그대로(재포맷 없음). 결과 JSON 모양을 바꾸면 PARSER_VERSION(refresh.ts)을 올릴 것.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { Grid, tokenize, type Cell } from './grid';
import {
  fundError,
  type Account,
  type AccountsSection,
  type CertSection,
  type FundReport,
  type Link,
  type NoteBlock,
  type Notice,
  type Pair,
  type ParseResult,
  type Seg,
  type StepItem,
  type StepsSection,
} from './types';

const NUM_RE = /-?[0-9][0-9,]*(?:\.[0-9]+)?%?/g;
const WORD_RE = /[가-힣A-Za-z]{2,}/g;
const TEMPLATE_WORDS = new Set(['최종평가일']); // 화면이 직접 그리는 라벨 — 글자 검증 제외
const STEP_RE = /^\[\d+단계\]/;
const ACCOUNTS_ANCHOR = '자금 현황 분석';
const CERT_ANCHOR = '회사 정보';

const stripBrackets = (s: string): string => s.replace(/^[[\]]+|[[\]]+$/g, '');
const nfc = (s: string): string => (typeof s.normalize === 'function' ? s.normalize('NFC') : s);

function extractNotice(g: Grid): Notice | null {
  const head = g.all().find((x) => x.text === '공지사항');
  if (!head) return null;
  const out: Notice = {
    label: head.text,
    signalsLabel: '',
    signals: [],
    message: '',
    servicesLabel: '',
    services: [],
    links: [],
  };
  for (let r = head.r; r < head.r + head.rowspan; r += 1) {
    const row = g.row(r).filter((x) => x !== head);
    for (let i = 0; i < row.length; i += 1) {
      const cell = row[i];
      const t = cell.text;
      if (cell.links.length) {
        out.links.push(...cell.links);
        continue;
      }
      // "[시장흐름=단기:붕괴신호|...]" + 다음 셀 메시지, 또는 "파동방향=[단기:...|...] | 메시지" 한 셀
      const m = /^\[?([^=[\]]+)=\[?([^\]]+)\]\s*(?:\|\s*(.*))?$/s.exec(t);
      let sm: RegExpExecArray | null = null;
      if (m && !out.signals.length) {
        out.signalsLabel = m[1].trim();
        out.signals = m[2]
          .split('|')
          .filter((p) => p.includes(':'))
          .map((p): Pair => {
            const k = p.indexOf(':');
            return [p.slice(0, k).trim(), p.slice(k + 1).trim()];
          });
        out.message = (m[3] ?? '').trim() || (i + 1 < row.length ? row[i + 1].text : '');
      } else if ((sm = /^([^=[\]]+)=((?:\s*\[[^\]]+\])+)\s*$/.exec(t)) && !out.servicesLabel) {
        // "지원관리=[보유주식 분석 방] [장기투자 관리 방] ..." 한 셀
        out.servicesLabel = sm[1].trim();
        out.services = [...sm[2].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1].trim());
      } else if (/^\[.+\]$/.test(t) && !out.servicesLabel) {
        out.servicesLabel = stripBrackets(t);
        if (i + 1 < row.length) {
          out.services = row[i + 1].text
            .split('|')
            .map((s) => s.trim())
            .filter((s) => s);
        }
      }
    }
  }
  return out;
}

function sectionRanges(g: Grid): [Cell, number, number][] {
  const heads = g
    .all()
    .filter((x) => x.text.startsWith('■'))
    .sort((a, b) => a.r - b.r || a.c - b.c);
  return heads.map((h, i): [Cell, number, number] => [h, h.r, i + 1 < heads.length ? heads[i + 1].r : g.nrows]);
}

function evalDate(g: Grid, r: number): string {
  const row = g.row(r);
  for (let i = 0; i < row.length; i += 1) {
    if (row[i].text.startsWith('최종평가일') && i + 1 < row.length) return row[i + 1].text;
  }
  return '';
}

const secTitle = (head: Cell): string => head.text.replace(/^■+/, '').trim();

function noteBlock(g: Grid, b: Cell): NoteBlock {
  const items: Seg[][] = [];
  const links: Link[] = [];
  for (let rr = b.r; rr < b.r + b.rowspan; rr += 1) {
    for (const x of g.row(rr)) {
      if (x.c === 0) continue;
      links.push(...x.links);
      if (!x.links.length && x.text) {
        const segs = x.segs.map(([t, bold]): Seg => [t.replace(/ /g, ' ').replace(/[ \t]+/g, ' '), bold]);
        segs[0][0] = segs[0][0].replace(/^[ ￭]+/, '');
        segs[segs.length - 1][0] = segs[segs.length - 1][0].replace(/\s+$/, '');
        items.push(segs.filter((s) => s[0]));
      }
    }
  }
  return { title: b.text, items, links };
}

function extractAccounts(g: Grid, head: Cell, r0: number, r1: number): AccountsSection {
  // 표 머리: "자금 현황 분석" 왼쪽 칸이 구분 라벨("구분" / "모"펀드 / "자"펀드(2) 등 파일마다 다름)
  const anchor = g.cells(r0, r1).find((x) => x.text === ACCOUNTS_ANCHOR);
  const gubun = anchor ? g.at(anchor.r, 0) : undefined;
  if (!anchor || !gubun) throw fundError('format', '자금 현황 표 머리를 찾지 못했습니다');
  const sec: AccountsSection = {
    kind: 'accounts',
    title: secTitle(head),
    evalDate: evalDate(g, head.r),
    group: gubun.text !== '구분' ? gubun.text : '',
    accounts: [],
    notes: [],
  };
  const remarkHdrR = gubun.r + 1;
  for (const b of g.cells(gubun.r + gubun.rowspan, r1)) {
    if (b.c !== 0 || !b.text) continue;
    const first = g.at(b.r, 1);
    if (first && first.colspan >= 6) {
      sec.notes.push(noteBlock(g, b)); // 안내문 블록(확인사항/행정사항)
      continue;
    }
    const acct: Account = { name: b.text, values: [], remarks: [], remarkText: null };
    for (let lr = b.r; lr < b.r + b.rowspan; lr += 2) {
      for (let c = 1; c < 6; c += 1) {
        const k = g.text(lr, c);
        const v = g.text(lr + 1, c);
        if (k || v) acct.values.push([k, v]);
      }
    }
    const rem = g.at(b.r, 6);
    if (rem && rem.colspan >= 2) {
      const lines = rem.text.split('\n');
      const title = lines[0].startsWith('[') ? stripBrackets(lines[0]) : '';
      const body = title ? lines.slice(1) : lines;
      acct.remarkText = { title, lines: body.map((ln) => ln.replace(/^\d+\.\s*/, '')) };
    } else {
      for (const c of [6, 7]) {
        const v = g.text(b.r, c);
        if (v) acct.remarks.push([g.text(remarkHdrR, c), v]);
      }
    }
    sec.accounts.push(acct);
  }
  return sec;
}

function extractSteps(g: Grid, head: Cell, r0: number, r1: number): StepsSection {
  const sec: StepsSection = { kind: 'steps', title: secTitle(head), steps: [], links: [] };
  const hdr = g.cells(r0, r1).find((x) => STEP_RE.test(x.text));
  if (!hdr) throw fundError('format', '단계 머리를 찾지 못했습니다');
  const hr = hdr.r;
  for (const x of g.row(hr)) {
    const m = /^\[(\d+단계)\]\s*(.*)$/.exec(x.text);
    if (m) {
      const items: StepItem[] = [];
      for (let c = x.c; c < x.c + x.colspan; c += 1) {
        const k = g.text(hr + 1, c);
        const vc = g.at(hr + 2, c);
        if (k || (vc && vc.text)) items.push([k, vc ? vc.text : '', !!vc && g.isRed(vc)]);
      }
      sec.steps.push({ no: m[1], name: m[2], items });
    } else {
      // 링크 헤더(예: 펀드현황 보러가기) — 같은 열 아래의 앵커를 붙인다
      for (let rr = hr; rr < r1; rr += 1) {
        const below = g.at(rr, x.c);
        if (below && below.links.length) {
          const label = x.text.replace(/\n/g, ' ') || below.links[0][0];
          sec.links.push([label, below.links[0][1]]);
          break;
        }
      }
    }
  }
  return sec;
}

function extractCert(g: Grid, head: Cell, r0: number, r1: number): CertSection {
  const sec: CertSection = { kind: 'cert', title: secTitle(head), companyLabel: '', company: [], fields: [] };
  const hdr = g.cells(r0, r1).find((x) => x.text === CERT_ANCHOR);
  if (!hdr) throw fundError('format', '회사 정보 머리를 찾지 못했습니다');
  for (const x of g.row(hdr.r)) {
    const val = g.at(hdr.r + 1, x.c);
    const v = val ? val.text : '';
    if (x === hdr) {
      sec.companyLabel = x.text;
      sec.company = v.split('\n');
    } else {
      sec.fields.push([x.text, v]);
    }
  }
  return sec;
}

/** 원본 셀 텍스트의 숫자·단어(2글자+) 중 결과 JSON 에 없는 것 — 숫자(정렬) 다음 단어(정렬) */
export function findMissing(cellTexts: string[], report: FundReport): string[] {
  const dumped = JSON.stringify(report);
  const srcNums = new Set<string>();
  const srcWords = new Set<string>();
  for (const t of cellTexts) {
    // 목록 번호 "1. " 은 화면에서 <ol> 로 표현하므로 제외
    for (const n of t.replace(/^\d+\.\s/gm, '').match(NUM_RE) ?? []) srcNums.add(n);
    for (const w of t.match(WORD_RE) ?? []) srcWords.add(w);
  }
  const outNums = new Set(dumped.match(NUM_RE) ?? []);
  const nums = [...srcNums].filter((n) => !outNums.has(n)).sort();
  const words = [...srcWords].filter((w) => !TEMPLATE_WORDS.has(w) && !dumped.includes(w)).sort();
  return [...nums, ...words];
}

export function parseFundReport(html: string): ParseResult {
  const { title: rawTitle, css, rows } = tokenize(html);
  const g = new Grid(rows, css);
  const title = nfc(rawTitle.trim());
  const m = /^\((\d+)\)\s*(.+)$/.exec(title);
  const report: FundReport = {
    title,
    investorNo: m ? m[1] : '',
    investorName: m ? m[2] : title,
    notice: extractNotice(g),
    sections: [],
  };
  for (const [head, r0, r1] of sectionRanges(g)) {
    const texts = g.cells(r0, r1).map((x) => x.text);
    if (texts.includes(ACCOUNTS_ANCHOR)) report.sections.push(extractAccounts(g, head, r0, r1));
    else if (texts.some((t) => STEP_RE.test(t))) report.sections.push(extractSteps(g, head, r0, r1));
    else if (texts.includes(CERT_ANCHOR)) report.sections.push(extractCert(g, head, r0, r1));
    // 알 수 없는 섹션은 건너뛴다 → 그 안의 값은 missing 으로 드러난다
  }
  if (!report.sections.length) throw fundError('format', '인식한 섹션이 없습니다');
  return {
    report,
    missing: findMissing(
      g.all().map((x) => x.text),
      report,
    ),
  };
}
