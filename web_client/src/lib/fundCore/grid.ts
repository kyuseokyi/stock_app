// FlexCel 표 HTML → 병합 셀을 푼 격자. fund_report/convert.py 의 FlexCelParser·Grid 를 그대로 옮긴 것.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { Parser } from 'htmlparser2';

import type { Link, Seg } from './types';

export type Cell = {
  cls: string;
  style: string;
  colspan: number;
  rowspan: number;
  segs: Seg[];
  links: Link[];
  text: string; // </td> 에서 segs 로 한 번 계산
  r: number;
  c: number;
};

const isBold = (style: string | undefined): boolean =>
  !!style && style.replace(/ /g, '').includes('font-weight:bold');
const spanOf = (v: string | undefined): number => (v ? parseInt(v, 10) || 1 : 1);

/** 조각 텍스트 → 줄별 공백 접기·빈 줄 제거 (convert.py Cell.text) */
export function cellText(segs: Seg[]): string {
  const t = segs
    .map((s) => s[0])
    .join('')
    .replace(/ /g, ' ');
  return t
    .split('\n')
    .map((ln) => ln.replace(/[ \t]+/g, ' ').trim())
    .filter((ln) => ln)
    .join('\n');
}

export function tokenize(html: string): { title: string; css: string; rows: Cell[][] } {
  let title = '';
  let css = '';
  let inTitle = false;
  let inStyle = false;
  const rows: Cell[][] = [];
  let row: Cell[] | null = null;
  let cell: Cell | null = null;
  let bold: boolean[] = [];
  let anchor: { href: string; label: string } | null = null;

  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        if (tag === 'title') inTitle = true;
        else if (tag === 'style') inStyle = true;
        else if (tag === 'tr') {
          row = (attrs.style ?? '').replace(/ /g, '').includes('display:none') ? null : [];
        } else if (tag === 'td' && row) {
          cell = {
            cls: attrs.class ?? '',
            style: attrs.style ?? '',
            colspan: spanOf(attrs.colspan),
            rowspan: spanOf(attrs.rowspan),
            segs: [],
            links: [],
            text: '',
            r: 0,
            c: 0,
          };
          bold = [isBold(attrs.style)];
        } else if (cell) {
          if (tag === 'br') cell.segs.push(['\n', false]);
          else if (tag === 'span') bold.push(isBold(attrs.style) || (bold.length > 0 && bold[bold.length - 1]));
          else if (tag === 'a') anchor = { href: attrs.href ?? '', label: '' };
        }
      },
      ontext(data) {
        if (inTitle) title += data;
        else if (inStyle) css += data;
        else if (cell) {
          cell.segs.push([data, bold.length > 0 && bold[bold.length - 1]]);
          if (anchor) anchor.label += data;
        }
      },
      onclosetag(tag) {
        if (tag === 'title') inTitle = false;
        else if (tag === 'style') inStyle = false;
        else if (tag === 'td' && cell && row) {
          cell.text = cellText(cell.segs);
          row.push(cell);
          cell = null;
        } else if (tag === 'tr' && row) {
          rows.push(row);
          row = null;
        } else if (cell) {
          if (tag === 'span' && bold.length > 1) bold.pop();
          else if (tag === 'a' && anchor) {
            const label = anchor.label.trim().replace(/^[()]+|[()]+$/g, '').trim();
            cell.links.push([label, anchor.href]);
            anchor = null;
          }
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return { title, css, rows };
}

const key = (r: number, c: number): string => `${r},${c}`;

/** 병합 셀을 풀어 (행, 열) → 원점 셀로 접근한다. 삽입 순서 = 원본 순서. */
export class Grid {
  readonly nrows: number;
  private readonly origin = new Map<string, Cell>();
  private readonly cssColor = new Map<string, string>();

  constructor(rows: Cell[][], css: string) {
    const occupied = new Set<string>();
    rows.forEach((row, r) => {
      let c = 0;
      for (const cell of row) {
        while (occupied.has(key(r, c))) c += 1;
        cell.r = r;
        cell.c = c;
        this.origin.set(key(r, c), cell);
        for (let dr = 0; dr < cell.rowspan; dr += 1) {
          for (let dc = 0; dc < cell.colspan; dc += 1) occupied.add(key(r + dr, c + dc));
        }
        c += cell.colspan;
      }
    });
    this.nrows = rows.length;
    for (const m of css.matchAll(/\.(flx\d+)\s*\{([^}]*)\}/g)) {
      const cm = /(?:^|[^-\w])color:\s*([^;]+);/.exec(m[2]);
      this.cssColor.set(m[1], cm ? cm[1].trim() : '');
    }
  }

  all(): Cell[] {
    return [...this.origin.values()];
  }

  at(r: number, c: number): Cell | undefined {
    return this.origin.get(key(r, c));
  }

  text(r: number, c: number): string {
    return this.at(r, c)?.text ?? '';
  }

  row(r: number): Cell[] {
    return this.all()
      .filter((x) => x.r === r)
      .sort((a, b) => a.c - b.c);
  }

  cells(r0: number, r1: number): Cell[] {
    return this.all()
      .filter((x) => x.r >= r0 && x.r < r1)
      .sort((a, b) => a.r - b.r || a.c - b.c);
  }

  isRed(cell: Cell): boolean {
    const m = /(?:^|[^-\w])color:\s*([^;]+)/.exec(cell.style);
    const color = m ? m[1].trim() : (this.cssColor.get(cell.cls) ?? '');
    return ['red', '#ff0000'].includes(color.toLowerCase());
  }
}
