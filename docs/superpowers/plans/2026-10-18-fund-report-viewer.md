# 펀드 수익보기(Fund Report Viewer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회원이 기기에 저장한 fund.ivyro.net 펀드 현황 URL 을 웹(`web_client`)·앱(`mobile`)이 직접 가져와 파싱하고 반응형 리포트로 보여준다.

**Architecture:** 플랫폼 무관 `core`(파서·URL 검증·목록 조작·갱신 로직·React 훅)를 `mobile/src/features/fund/core` 에 두고 jest 로 검증한 뒤, 같은 파일을 `web_client/src/lib/fundCore` 로 복사한다(동일성 스크립트로 감시). 저장소는 플랫폼별 포트(앱: SecureStore+파일, 웹: localStorage). 화면은 웹 React+Tailwind, 앱 WebView(template 렌더러 이식).

**Tech Stack:** TypeScript, htmlparser2@9.1.0, React 18(web)/React Native+expo-router(mobile), Unistyles v3, react-native-webview, expo-secure-store, expo-file-system, Tailwind, jest-expo.

**Spec:** `docs/superpowers/specs/2026-10-18-fund-report-viewer-design.md`

**기준 구현(이식 원본, repo 밖):** `~/Documents/private/projects/ivyro/work_space/fund_report/convert.py`, `template.html`

---

## 공통 규칙

- Python 은 conda 로 실행: `conda run -n base python …` (stock_app env 없음, base=3.12).
- 커밋은 dev 브랜치, 태스크마다 1회. 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **실제 원본 HTML·실명·잔고를 repo 에 넣지 않는다.** 픽스처는 Task 1 의 가린 사본만.
- `core/` 안 파일은 상대 import 만(`'./types'`), `@/…`·RN·Expo import 금지(웹에 그대로 복사되므로). 예외: `use-fund-report.ts` 의 `react`.
- 테스트 실행: `cd mobile && npx jest src/features/fund` (jest 는 `*.test.ts` 만 대상).

## 파일 구조

```
scripts/fund/mask_fixture.py                         (신규) 원본 → 가린 픽스처
scripts/check-fund-core-sync.sh                      (신규) core 복사·동일성 검사
mobile/src/features/fund/__fixtures__/current.html|json, legacy.html|json  (신규)
mobile/src/features/fund/core/types.ts grid.ts parse.ts url.ts funds.ts hash.ts refresh.ts display.ts use-fund-report.ts index.ts (+ *.test.ts)
mobile/src/features/fund/fund-store.ts report-colors.ts
mobile/src/features/fund/report-web/report-page.ts
mobile/src/features/fund/components/report-view.tsx
mobile/src/app/fund/index.tsx, mobile/src/app/fund/[id].tsx           (신규)
mobile/src/app/_layout.tsx, mobile/src/app/(tabs)/profile.tsx          (수정: 등록·메뉴)
web_client/src/lib/fundCore/*                        (복사본)
web_client/src/lib/fundStore.ts
web_client/src/components/fund/FundReportView.tsx
web_client/src/pages/FundListPage.tsx, FundReportPage.tsx               (신규)
web_client/src/App.tsx, web_client/src/pages/MyPage.tsx                 (수정: 라우트·메뉴)
README.md                                            (수정: 한 단락)
```

---

### Task 1: 가린 테스트 픽스처

**Files:**
- Create: `scripts/fund/mask_fixture.py`
- Create: `mobile/src/features/fund/__fixtures__/current.html`, `current.json`, `legacy.html`, `legacy.json`

- [ ] **Step 1: 가리기 스크립트 작성**

`scripts/fund/mask_fixture.py`:

```python
"""fund.ivyro.net 펀드 현황 원본 HTML → 테스트 픽스처(개인 값 가림).

사용법:
    conda run -n base python scripts/fund/mask_fixture.py <원본.html> <출력.html> [--replace 원문=대체 ...]

- 태그 밖 텍스트의 숫자를 무작위 숫자로 바꾼다(자릿수·쉼표·%·부호·0 위치 유지, 되돌릴 수 없음).
  <style> 안(CSS 색·클래스)과 태그 속성(colspan 등)은 건드리지 않는다. 엔티티(&#160;)도 보존.
- --replace 로 받은 문자열(이름·회사명 등)을 통째로 바꾼다. 숫자 가리기보다 먼저 적용.
- 모든 href 를 https://example.com/link/N 으로 바꾼다.
- 브라우저 저장 흔적('saved from url' 주석, 확장 프로그램이 넣은 div)을 지운다.
"""

from __future__ import annotations

import argparse
import random
import re
from pathlib import Path

_rng = random.SystemRandom()


def _mask_digit(d: str) -> str:
    return "0" if d == "0" else str(_rng.randint(1, 9))


def _mask_text(text: str) -> str:
    # 엔티티는 그대로 두고 숫자만 바꾼다
    return re.sub(r"&#?\w+;|\d", lambda m: m.group(0) if m.group(0).startswith("&") else _mask_digit(m.group(0)), text)


def mask(html: str, replaces: list[tuple[str, str]]) -> str:
    html = re.sub(r"<!-- saved from url=[^>]*-->\s*", "", html)
    html = re.sub(r'<div id="in-page-channel-node-id"[^>]*></div>', "", html)
    for old, new in replaces:
        html = html.replace(old, new)
    counter = iter(range(1, 10_000))
    html = re.sub(r'href="[^"]*"', lambda _m: f'href="https://example.com/link/{next(counter)}"', html)
    parts = re.split(r"(<style\b.*?</style>|<[^>]+>)", html, flags=re.S | re.I)
    return "".join(p if p.startswith("<") else _mask_text(p) for p in parts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    ap.add_argument("--replace", action="append", default=[], metavar="원문=대체")
    args = ap.parse_args()
    pairs = [tuple(p.split("=", 1)) for p in args.replace]
    args.dst.parent.mkdir(parents=True, exist_ok=True)
    args.dst.write_text(mask(args.src.read_text(encoding="utf-8"), pairs), encoding="utf-8")
    print(f"masked → {args.dst}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 가릴 이름 목록 확인(로컬에서만, 출력은 커밋하지 않음)**

원본 2개 위치(파일명이 NFD 라 find 로 찾는다):

```bash
NEW=$(find ~/Downloads -maxdepth 1 -iname "*(101)*.html" | head -1)
OLD=$(find ~/Documents/projects -maxdepth 2 -iname "*(101)*.html" | head -1)
echo "$NEW"; echo "$OLD"
T=$(mktemp -d)
conda run -n base python ~/Documents/private/projects/ivyro/work_space/fund_report/convert.py "$NEW" "$OLD" -o "$T" --json
```

`$T/*.json` 을 열어 `investorName`, `cert` 섹션의 `company`·`fields` 에 있는 **사람 이름·회사명**을 모두 적는다. 이 값들이 `--replace` 대상이다. (예: 투자자 실명 → `홍길동`, 대표/서명자 → `김대표`, 회사명 → `예시투자`)

- [ ] **Step 3: 픽스처 생성**

```bash
FX=mobile/src/features/fund/__fixtures__
R=(--replace "<투자자실명>=홍길동" --replace "<서명자>=김대표" --replace "<회사명>=예시투자")   # Step 2 에서 찾은 값으로
conda run -n base python scripts/fund/mask_fixture.py "$NEW" $FX/current.html "${R[@]}"
conda run -n base python scripts/fund/mask_fixture.py "$OLD" $FX/legacy.html "${R[@]}"
```

- [ ] **Step 4: 기대 JSON 생성 + 누락 없음 확인**

```bash
for n in current legacy; do
  D=$(mktemp -d)
  conda run -n base python ~/Documents/private/projects/ivyro/work_space/fund_report/convert.py $FX/$n.html -o "$D" --json
  cp "$D"/*.json $FX/$n.json
done
```

Expected: 두 파일 모두 `✓ …` (⚠·`누락 의심` 출력이 없어야 함). ⚠ 가 나오면 `--replace` 가 원본 구조 문자열(예: "공지사항")까지 바꾼 것이니 대체어를 고쳐 Step 3 부터 다시.

- [ ] **Step 5: 개인정보 잔존 검사**

```bash
grep -c "fund.ivyro.net" $FX/*.html            # 모두 0 이어야 함
grep -l "<투자자실명>\|<서명자>\|<회사명>" $FX/* || echo "clean"   # Step 2 실제 값으로 검사, clean 이어야 함
```

원본의 큰 금액(예: 현재평가금 원본 값)도 `grep -F` 로 한 번 검사해 0건 확인.

- [ ] **Step 6: Commit**

```bash
git add scripts/fund/mask_fixture.py mobile/src/features/fund/__fixtures__
git commit -m "test(fund): 가린 펀드 현황 픽스처(새/옛 양식) + convert.py 기대 JSON

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 의존성 설치

**Files:** Modify: `mobile/package.json`, `mobile/package-lock.json`, `web_client/package.json`, `web_client/package-lock.json`

- [ ] **Step 1: 설치**

```bash
cd mobile && npm install htmlparser2@9.1.0 && npx expo install expo-file-system && cd ..
cd web_client && npm install htmlparser2@9.1.0 && cd ..
```

- [ ] **Step 2: 확인**

```bash
grep -E '"(htmlparser2|expo-file-system)"' mobile/package.json web_client/package.json
```

Expected: mobile 에 htmlparser2 `9.1.0` 계열·`"expo-file-system": "~57…"`, web 에 htmlparser2.

- [ ] **Step 3: Commit**

```bash
git add mobile/package.json mobile/package-lock.json web_client/package.json web_client/package-lock.json
git commit -m "chore(fund): htmlparser2@9.1.0(web·mobile), expo-file-system(mobile) 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: core 타입 + 격자(grid)

**Files:**
- Create: `mobile/src/features/fund/core/types.ts`
- Create: `mobile/src/features/fund/core/grid.ts`
- Test: `mobile/src/features/fund/core/grid.test.ts`

- [ ] **Step 1: 타입 작성(다음 단계 테스트가 import)**

`core/types.ts`:

```ts
// 펀드 리포트 데이터 — fund_report/convert.py 의 JSON 출력과 같은 모양(교차 검증 대상).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
export type Seg = [text: string, bold: boolean];
export type Link = [label: string, href: string];
export type Pair = [key: string, value: string];

export type Notice = {
  label: string;
  signalsLabel: string;
  signals: Pair[];
  message: string;
  servicesLabel: string;
  services: string[];
  links: Link[];
};

export type Account = {
  name: string;
  values: Pair[];
  remarks: Pair[];
  remarkText: { title: string; lines: string[] } | null;
};
export type NoteBlock = { title: string; items: Seg[][]; links: Link[] };
export type AccountsSection = {
  kind: 'accounts';
  title: string;
  evalDate: string;
  group: string;
  accounts: Account[];
  notes: NoteBlock[];
};

export type StepItem = [key: string, value: string, highlight: boolean];
export type Step = { no: string; name: string; items: StepItem[] };
export type StepsSection = { kind: 'steps'; title: string; steps: Step[]; links: Link[] };

export type CertSection = { kind: 'cert'; title: string; companyLabel: string; company: string[]; fields: Pair[] };

export type Section = AccountsSection | StepsSection | CertSection;

export type FundReport = {
  title: string;
  investorNo: string;
  investorName: string;
  notice: Notice | null;
  sections: Section[];
};

export type ParseResult = { report: FundReport; missing: string[] };

// 오류는 Error + fundCode (Babel 에서 Error 상속 클래스의 instanceof 가 깨질 수 있어 클래스 대신 코드)
export type FundErrorCode = 'format' | 'fetch' | 'input';
export type FundError = Error & { fundCode: FundErrorCode };

export function fundError(code: FundErrorCode, message: string): FundError {
  return Object.assign(new Error(message), { fundCode: code });
}

export function isFundError(e: unknown, code?: FundErrorCode): e is FundError {
  return e instanceof Error && 'fundCode' in e && (code === undefined || (e as FundError).fundCode === code);
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`core/grid.test.ts`:

```ts
import { Grid, tokenize } from './grid';

const HTML = `<html><head><title>
 (7)테스트
</title><style>
.flx1 { color:#FF0000; }
.flx2 { background-color:red; }
</style></head><body><table>
<tr><td rowspan="2">A</td><td colspan="2">B&nbsp;&nbsp;b</td></tr>
<tr><td class="flx1">C</td><td class="flx2" style="font-weight: bold">D<br>E</td></tr>
<tr style="display: none"><td>숨김</td></tr>
<tr><td>F <a href="https://x.test/1">(링크)</a></td><td style="color:red">G</td><td><span style="font-weight:bold">굵게</span>보통</td></tr>
</table></body></html>`;

describe('tokenize', () => {
  const { title, css, rows } = tokenize(HTML);

  it('제목과 CSS 를 모은다', () => {
    expect(title.trim()).toBe('(7)테스트');
    expect(css).toContain('.flx1');
  });

  it('display:none 행은 건너뛴다', () => {
    expect(rows).toHaveLength(3);
    expect(rows.flat().some((c) => c.text === '숨김')).toBe(false);
  });

  it('nbsp·공백을 접고 <br> 은 줄바꿈으로 둔다', () => {
    expect(rows[0][1].text).toBe('B b');
    expect(rows[1][1].text).toBe('D\nE');
  });

  it('링크 라벨의 괄호를 벗기고 href 와 함께 모은다', () => {
    expect(rows[2][0].links).toEqual([['링크', 'https://x.test/1']]);
    expect(rows[2][0].text).toBe('F (링크)');
  });

  it('span 굵기를 조각별로 기록한다', () => {
    expect(rows[2][2].segs).toEqual([
      ['굵게', true],
      ['보통', false],
    ]);
    expect(rows[1][1].segs[0]).toEqual(['D', true]); // td 자체 style 굵게
  });
});

describe('Grid', () => {
  const { css, rows } = tokenize(HTML);
  const g = new Grid(rows, css);

  it('rowspan/colspan 을 풀어 열 위치를 정한다', () => {
    expect(g.text(0, 0)).toBe('A');
    expect(g.text(0, 1)).toBe('B b');
    expect(g.text(1, 1)).toBe('C'); // (1,0) 은 A 가 차지
    expect(g.text(1, 2)).toBe('D\nE');
    expect(g.at(1, 0)).toBeUndefined(); // 원점이 아닌 칸
  });

  it('row/cells 는 열·행 순으로 정렬한다', () => {
    expect(g.row(2).map((c) => c.text)).toEqual(['F (링크)', 'G', '굵게보통']);
    expect(g.cells(0, 2).map((c) => c.text)).toEqual(['A', 'B b', 'C', 'D\nE']);
  });

  it('빨간 글씨는 인라인 color 또는 .flxN CSS color 로 판정(background-color 제외)', () => {
    expect(g.isRed(g.at(1, 1)!)).toBe(true);
    expect(g.isRed(g.at(1, 2)!)).toBe(false);
    expect(g.isRed(g.at(2, 1)!)).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/grid.test.ts`
Expected: FAIL — `Cannot find module './grid'`

- [ ] **Step 4: 구현**

`core/grid.ts`:

```ts
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
```

- [ ] **Step 5: 통과 확인**

Run: `cd mobile && npx jest src/features/fund/core/grid.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/fund/core/types.ts mobile/src/features/fund/core/grid.ts mobile/src/features/fund/core/grid.test.ts
git commit -m "feat(fund): core 타입·FlexCel 토큰화·병합 셀 격자(convert.py 이식)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: core 파서(섹션 추출 + 누락 검증)

**Files:**
- Create: `mobile/src/features/fund/core/parse.ts`
- Test: `mobile/src/features/fund/core/parse.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`core/parse.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

import { findMissing, parseFundReport } from './parse';
import { isFundError, type FundReport } from './types';

const FX = path.join(__dirname, '..', '__fixtures__');
const read = (f: string) => fs.readFileSync(path.join(FX, f), 'utf8');

describe('parseFundReport — convert.py 교차 검증', () => {
  it.each(['current', 'legacy'])('%s 양식: convert.py JSON 과 같고 누락이 없다', (name) => {
    const { report, missing } = parseFundReport(read(`${name}.html`));
    expect(report).toEqual(JSON.parse(read(`${name}.json`)));
    expect(missing).toEqual([]);
  });
});

describe('parseFundReport — 형식 오류', () => {
  it('섹션이 하나도 없으면 format 오류', () => {
    expect.assertions(1);
    try {
      parseFundReport('<html><body><table><tr><td>x</td></tr></table></body></html>');
    } catch (e) {
      expect(isFundError(e, 'format')).toBe(true);
    }
  });
});

describe('findMissing', () => {
  const empty: FundReport = { title: '', investorNo: '', investorName: '', notice: null, sections: [] };

  it('원본 셀의 숫자·2글자 이상 단어가 결과에 없으면 숫자 먼저, 정렬해서 돌려준다', () => {
    expect(findMissing(['총 손익금 1,234', '2. 항목 9%'], empty)).toEqual(['1,234', '9%', '손익금', '항목']);
  });

  it('목록 번호("1. ")와 템플릿 라벨(최종평가일)은 검사하지 않는다', () => {
    expect(findMissing(['1. 최종평가일'], empty)).toEqual([]);
  });

  it('결과에 있으면 빈 배열', () => {
    const r = { ...empty, title: '손익금 1,234' };
    expect(findMissing(['손익금 1,234'], r)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/parse.test.ts`
Expected: FAIL — `Cannot find module './parse'`

- [ ] **Step 3: 구현**

`core/parse.ts`:

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && npx jest src/features/fund/core/parse.test.ts`
Expected: PASS (6 tests). 교차 검증이 실패하면 jest diff 에서 어긋난 키를 보고 convert.py 의 해당 함수와 한 줄씩 대조한다(흔한 원인: htmlparser2 의 암묵적 태그 닫기, 정규식 플래그, `split` limit 차이). **기대값(JSON)은 고치지 않는다.**

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/fund/core/parse.ts mobile/src/features/fund/core/parse.test.ts
git commit -m "feat(fund): 섹션 추출·누락 검증 파서 — convert.py 기대 JSON 과 교차 검증

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: URL 검증 + 목록 조작

**Files:**
- Create: `mobile/src/features/fund/core/url.ts`, `core/funds.ts`
- Test: `core/url.test.ts`, `core/funds.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`core/url.test.ts`:

```ts
import { isFundError } from './types';
import { normalizeFundUrl } from './url';

const OK = 'https://fund.ivyro.net/dataroom/om_data/om_v3_0000001_TEST.htm';

describe('normalizeFundUrl', () => {
  it('앞뒤 공백을 지우고 통과시킨다', () => {
    expect(normalizeFundUrl(`  ${OK}\n`)).toBe(OK);
  });

  it.each([
    ['http', 'http://fund.ivyro.net/dataroom/om_data/a.htm'],
    ['유사 호스트(접미)', 'https://fund.ivyro.net.evil.com/dataroom/om_data/a.htm'],
    ['다른 호스트', 'https://evil.com/fund.ivyro.net/dataroom/om_data/a.htm'],
    ['사용자 정보', 'https://user@fund.ivyro.net/dataroom/om_data/a.htm'],
    ['다른 경로', 'https://fund.ivyro.net/dataroom/other/a.htm'],
    ['하위 경로', 'https://fund.ivyro.net/dataroom/om_data/x/a.htm'],
    ['쿼리', 'https://fund.ivyro.net/dataroom/om_data/a.htm?x=1'],
    ['확장자', 'https://fund.ivyro.net/dataroom/om_data/a.html'],
    ['스킴 없음', 'fund.ivyro.net/dataroom/om_data/a.htm'],
    ['빈 값', ''],
  ])('%s 는 input 오류', (_label, url) => {
    expect.assertions(1);
    try {
      normalizeFundUrl(url);
    } catch (e) {
      expect(isFundError(e, 'input')).toBe(true);
    }
  });
});
```

`core/funds.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/url.test.ts src/features/fund/core/funds.test.ts`
Expected: FAIL — `Cannot find module './url'` / `'./funds'`

- [ ] **Step 3: 구현**

`core/url.ts`:

```ts
// 등록 가능한 펀드 현황 주소 — https://fund.ivyro.net/dataroom/om_data/<파일>.htm 만.
// RN 의 URL 구현은 hostname 등이 불완전해 정규식 하나로 검사한다.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { fundError } from './types';

const FUND_URL_RE = /^https:\/\/fund\.ivyro\.net\/dataroom\/om_data\/[^/?#\s]+\.htm$/;

export function normalizeFundUrl(input: string): string {
  const url = input.trim();
  if (!FUND_URL_RE.test(url)) throw fundError('input', 'fund.ivyro.net 펀드 현황 주소만 등록할 수 있어요.');
  return url;
}
```

`core/funds.ts`:

```ts
// 기기에 저장하는 펀드 목록 조작(순수 함수). 저장 자체는 플랫폼별 store 가 한다.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { fundError, type FundReport } from './types';
import { normalizeFundUrl } from './url';

export type FundEntry = { id: string; name: string; url: string };

export const MAX_FUNDS = 10; // 앱은 목록을 SecureStore 값 하나(iOS 약 2KB 한도)에 둔다
export const MAX_NAME = 20;

export function newFundId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function addFund(list: FundEntry[], input: { name: string; url: string }, id: string): FundEntry[] {
  const url = normalizeFundUrl(input.url);
  if (list.some((f) => f.url === url)) throw fundError('input', '이미 등록한 주소예요.');
  if (list.length >= MAX_FUNDS) throw fundError('input', `펀드는 ${MAX_FUNDS}개까지 등록할 수 있어요.`);
  return [...list, { id, name: input.name.trim().slice(0, MAX_NAME), url }];
}

export const removeFund = (list: FundEntry[], id: string): FundEntry[] => list.filter((f) => f.id !== id);

export const renameFund = (list: FundEntry[], id: string, name: string): FundEntry[] =>
  list.map((f) => (f.id === id ? { ...f, name: name.trim().slice(0, MAX_NAME) } : f));

export const displayName = (f: FundEntry): string => f.name || '이름 없는 펀드';

/** 이름을 비워 등록한 펀드에 첫 조회 후 붙일 이름 */
export const defaultName = (r: FundReport): string =>
  r.investorNo ? `펀드 ${r.investorNo}` : r.title.slice(0, MAX_NAME) || '내 펀드';

export function parseFundList(raw: string | null): FundEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((f: unknown): f is FundEntry => {
      const o = f as Partial<FundEntry> | null;
      return !!o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.url === 'string';
    });
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && npx jest src/features/fund/core/url.test.ts src/features/fund/core/funds.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/fund/core/url.ts mobile/src/features/fund/core/url.test.ts mobile/src/features/fund/core/funds.ts mobile/src/features/fund/core/funds.test.ts
git commit -m "feat(fund): 펀드 URL 검증·목록 조작(최대 10개·이름 20자)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 해시·갱신 로직·표시 함수·훅·index

**Files:**
- Create: `core/hash.ts`, `core/refresh.ts`, `core/display.ts`, `core/use-fund-report.ts`, `core/index.ts`
- Test: `core/refresh.test.ts`, `core/display.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`core/refresh.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

import { djb2 } from './hash';
import {
  fetchReportHtml,
  PARSER_VERSION,
  readValidCache,
  refreshReport,
  type CacheEntry,
  type CachePort,
} from './refresh';
import { fundError, isFundError } from './types';

const HTML = fs.readFileSync(path.join(__dirname, '..', '__fixtures__', 'current.html'), 'utf8');
const FUND = { id: 'f1', url: 'https://fund.ivyro.net/dataroom/om_data/x.htm' };

function memoryCache(): CachePort & { store: Map<string, CacheEntry> } {
  const store = new Map<string, CacheEntry>();
  return {
    store,
    read: async (id) => store.get(id) ?? null,
    write: async (id, e) => {
      store.set(id, e);
    },
  };
}

describe('djb2', () => {
  it('알려진 값', () => {
    expect(djb2('')).toBe('1505');
    expect(djb2('a')).toBe('2b606');
  });
});

describe('refreshReport', () => {
  it('처음 가져오면 파싱해 저장하고 changed=true', async () => {
    const cache = memoryCache();
    const res = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 1000 });
    expect(res.changed).toBe(true);
    expect(res.entry).toMatchObject({ v: PARSER_VERSION, fetchedAt: 1000, hash: djb2(HTML), missing: [] });
    expect(res.entry.report.sections.length).toBeGreaterThan(0);
    expect(cache.store.get('f1')).toEqual(res.entry);
  });

  it('내용이 같으면 fetchedAt 만 갱신하고 changed=false', async () => {
    const cache = memoryCache();
    const first = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 1000 });
    const second = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 2000 });
    expect(second.changed).toBe(false);
    expect(second.entry).toEqual({ ...first.entry, fetchedAt: 2000 });
  });

  it('파서 버전이 다른 캐시는 무시한다', async () => {
    const cache = memoryCache();
    const first = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 1000 });
    cache.store.set('f1', { ...first.entry, v: PARSER_VERSION - 1 });
    expect(await readValidCache(cache, 'f1')).toBeNull();
    const res = await refreshReport(FUND, { fetchHtml: async () => HTML, cache, now: () => 2000 });
    expect(res.changed).toBe(true);
  });

  it('가져오기 실패는 그대로 던지고 캐시를 건드리지 않는다', async () => {
    const cache = memoryCache();
    await expect(
      refreshReport(FUND, { fetchHtml: async () => Promise.reject(fundError('fetch', 'x')), cache, now: () => 1 }),
    ).rejects.toMatchObject({ fundCode: 'fetch' });
    expect(cache.store.size).toBe(0);
  });

  it('형식이 깨지면 format 오류', async () => {
    const cache = memoryCache();
    await expect(
      refreshReport(FUND, { fetchHtml: async () => '<html></html>', cache, now: () => 1 }),
    ).rejects.toMatchObject({ fundCode: 'format' });
  });
});

describe('fetchReportHtml', () => {
  const res = (ok: boolean, status: number, body = '') =>
    ({ ok, status, text: async () => body }) as unknown as Response;

  it('200 이면 본문', async () => {
    await expect(fetchReportHtml(FUND.url, 1000, async () => res(true, 200, 'hi'))).resolves.toBe('hi');
  });

  it('200 이 아니면 fetch 오류', async () => {
    await expect(fetchReportHtml(FUND.url, 1000, async () => res(false, 500))).rejects.toMatchObject({
      fundCode: 'fetch',
    });
  });

  it('네트워크 오류·타임아웃도 fetch 오류', async () => {
    await expect(
      fetchReportHtml(FUND.url, 1000, async () => {
        throw new TypeError('Network request failed');
      }),
    ).rejects.toMatchObject({ fundCode: 'fetch' });
    const hang = (_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const err = await fetchReportHtml(FUND.url, 10, hang).catch((e: unknown) => e);
    expect(isFundError(err, 'fetch')).toBe(true);
  });
});
```

`core/display.test.ts`:

```ts
import { evalDateOf, formatChecked } from './display';
import type { FundReport } from './types';

describe('formatChecked', () => {
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
  it('같은 날이면 시:분', () => {
    expect(formatChecked(at(18, 9, 5), at(18, 23, 0))).toBe('09:05');
  });
  it('다른 날이면 월/일 시:분', () => {
    expect(formatChecked(at(17, 15, 30), at(18, 8, 0))).toBe('10/17 15:30');
  });
});

describe('evalDateOf', () => {
  it('첫 자금 현황 섹션의 최종평가일, 없으면 빈 문자열', () => {
    const r: FundReport = {
      title: '',
      investorNo: '',
      investorName: '',
      notice: null,
      sections: [
        { kind: 'cert', title: '', companyLabel: '', company: [], fields: [] },
        { kind: 'accounts', title: '', evalDate: '2026-10-17', group: '', accounts: [], notes: [] },
      ],
    };
    expect(evalDateOf(r)).toBe('2026-10-17');
    expect(evalDateOf({ ...r, sections: [] })).toBe('');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/refresh.test.ts src/features/fund/core/display.test.ts`
Expected: FAIL — `Cannot find module './hash'` 등

- [ ] **Step 3: 구현**

`core/hash.ts`:

```ts
// 원본 HTML 이 바뀌었는지 판단용(보안 목적 아님). web_client/src/lib/fundCore 와 동일.
export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
```

`core/refresh.ts`:

```ts
// 원본 가져오기 + 캐시 갱신. 저장소는 CachePort 로 주입(앱: 파일, 웹: localStorage).
// 원본에 ETag/Last-Modified 가 없어 매번 가져오고 원본 HTML 해시로 변경을 판단한다.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { djb2 } from './hash';
import { parseFundReport } from './parse';
import { fundError, isFundError, type FundReport } from './types';

/** 파서 결과 JSON 모양을 바꾸면 올린다 → 옛 캐시를 버리고 다시 파싱 */
export const PARSER_VERSION = 1;

export type CacheEntry = { v: number; fetchedAt: number; hash: string; report: FundReport; missing: string[] };

export type CachePort = {
  read(id: string): Promise<CacheEntry | null>;
  write(id: string, entry: CacheEntry): Promise<void>;
};

export type RefreshDeps = {
  fetchHtml: (url: string) => Promise<string>;
  cache: CachePort;
  now: () => number;
};

export async function fetchReportHtml(
  url: string,
  timeoutMs = 10_000,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw fundError('fetch', `원본 응답 ${res.status}`);
    return await res.text();
  } catch (e) {
    if (isFundError(e)) throw e;
    throw fundError('fetch', '원본을 가져오지 못했습니다'); // URL·원인 메시지는 남기지 않는다
  } finally {
    clearTimeout(timer);
  }
}

export async function readValidCache(cache: CachePort, id: string): Promise<CacheEntry | null> {
  const c = await cache.read(id);
  return c && c.v === PARSER_VERSION ? c : null;
}

export async function refreshReport(
  fund: { id: string; url: string },
  deps: RefreshDeps,
): Promise<{ changed: boolean; entry: CacheEntry }> {
  const html = await deps.fetchHtml(fund.url);
  const hash = djb2(html);
  const prev = await readValidCache(deps.cache, fund.id);
  if (prev && prev.hash === hash) {
    const entry = { ...prev, fetchedAt: deps.now() };
    await deps.cache.write(fund.id, entry);
    return { changed: false, entry };
  }
  const { report, missing } = parseFundReport(html);
  const entry: CacheEntry = { v: PARSER_VERSION, fetchedAt: deps.now(), hash, report, missing };
  await deps.cache.write(fund.id, entry);
  return { changed: true, entry };
}
```

`core/display.ts`:

```ts
// 화면 표시용 순수 함수. web_client/src/lib/fundCore 와 동일.
import type { FundReport } from './types';

/** 기준일 = 첫 자금 현황 섹션의 최종평가일 */
export function evalDateOf(r: FundReport): string {
  for (const s of r.sections) if (s.kind === 'accounts' && s.evalDate) return s.evalDate;
  return '';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 마지막 확인 시각 — 오늘이면 "HH:mm", 아니면 "M/D HH:mm" (Intl 없이) */
export function formatChecked(ts: number, now: number): string {
  const d = new Date(ts);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
```

`core/use-fund-report.ts`:

```ts
// 리포트 화면 훅(웹·앱 공용) — 캐시를 먼저 보여주고, 열 때마다 원본을 다시 가져온다.
// cache 는 모듈 상수로 넘길 것(참조가 바뀌면 다시 가져온다). web_client/src/lib/fundCore 와 동일.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { FundEntry } from './funds';
import { fetchReportHtml, readValidCache, refreshReport, type CacheEntry, type CachePort } from './refresh';
import { isFundError, type FundErrorCode } from './types';

export type ReportState = { entry: CacheEntry | null; refreshing: boolean; error: FundErrorCode | null };

export function useFundReport(fund: FundEntry | null, cache: CachePort): ReportState & { refresh: () => void } {
  const id = fund?.id ?? null;
  const url = fund?.url ?? null;
  const [state, setState] = useState<ReportState>({ entry: null, refreshing: id !== null, error: null });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (id === null || url === null) return;
    setState((s) => ({ ...s, refreshing: true, error: null }));
    refreshReport({ id, url }, { fetchHtml: (u) => fetchReportHtml(u), cache, now: Date.now })
      .then(({ entry }) => {
        if (alive.current) setState({ entry, refreshing: false, error: null });
      })
      .catch((e: unknown) => {
        if (alive.current) {
          setState((s) => ({ ...s, refreshing: false, error: isFundError(e) ? e.fundCode : 'fetch' }));
        }
      });
  }, [id, url, cache]);

  useEffect(() => {
    if (id === null) return;
    void readValidCache(cache, id).then((c) => {
      if (alive.current && c) setState((s) => (s.entry ? s : { ...s, entry: c }));
    });
    refresh();
  }, [id, cache, refresh]);

  return { ...state, refresh };
}
```

`core/index.ts`:

```ts
// 펀드 리포트 공용 코드 진입점. web_client/src/lib/fundCore 와 동일.
export * from './types';
export { cellText, Grid, tokenize, type Cell } from './grid';
export { findMissing, parseFundReport } from './parse';
export { normalizeFundUrl } from './url';
export * from './funds';
export { djb2 } from './hash';
export * from './refresh';
export * from './display';
export { useFundReport, type ReportState } from './use-fund-report';
```

- [ ] **Step 4: 통과 확인 (core 전체)**

Run: `cd mobile && npx jest src/features/fund`
Expected: PASS (grid·parse·url·funds·refresh·display 모두)

- [ ] **Step 5: 타입 검사**

Run: `cd mobile && npx tsc --noEmit -p . 2>&1 | grep "features/fund" || echo "fund: no type errors"`
Expected: `fund: no type errors`

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/fund/core
git commit -m "feat(fund): 갱신 로직(캐시 포트·해시·타임아웃)·표시 함수·공용 훅

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: core 동기화 스크립트 + 웹 복사본

**Files:**
- Create: `scripts/check-fund-core-sync.sh`
- Create: `web_client/src/lib/fundCore/*.ts` (복사)

- [ ] **Step 1: 스크립트 작성**

`scripts/check-fund-core-sync.sh`:

```bash
#!/usr/bin/env bash
# 펀드 core 복사본 동일 여부 검사 — 기준: mobile/src/features/fund/core, 복사본: web_client/src/lib/fundCore
#   검사:  scripts/check-fund-core-sync.sh          (다르면 diff 출력 후 exit 1)
#   복사:  scripts/check-fund-core-sync.sh --write  (기준 → 복사본, *.test.ts 제외)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/mobile/src/features/fund/core"
DST="$ROOT/web_client/src/lib/fundCore"

if [ "${1:-}" = "--write" ]; then
  mkdir -p "$DST"
  for f in "$SRC"/*.ts; do
    case "$f" in *.test.ts) continue ;; esac
    cp "$f" "$DST/"
  done
  echo "copied → $DST"
fi

status=0
for f in "$SRC"/*.ts; do
  case "$f" in *.test.ts) continue ;; esac
  name="$(basename "$f")"
  if ! diff -u "$f" "$DST/$name"; then status=1; fi
done
for f in "$DST"/*.ts; do
  [ -e "$SRC/$(basename "$f")" ] || { echo "복사본에만 있음: $f"; status=1; }
done
[ $status -eq 0 ] && echo "fund core: in sync"
exit $status
```

- [ ] **Step 2: 복사·검사**

```bash
chmod +x scripts/check-fund-core-sync.sh
scripts/check-fund-core-sync.sh --write
scripts/check-fund-core-sync.sh
```

Expected: `copied → …/web_client/src/lib/fundCore` 후 `fund core: in sync`

- [ ] **Step 3: 웹 타입 검사**

Run: `cd web_client && npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 4: Commit**

```bash
git add scripts/check-fund-core-sync.sh web_client/src/lib/fundCore
git commit -m "feat(web): 펀드 core 복사본 + 동일성 검사 스크립트

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 앱 저장소 포트 + WebView 리포트

**Files:**
- Create: `mobile/src/features/fund/fund-store.ts`
- Create: `mobile/src/features/fund/report-colors.ts`
- Create: `mobile/src/features/fund/report-web/report-page.ts`
- Create: `mobile/src/features/fund/components/report-view.tsx`
- Test: `mobile/src/features/fund/report-web/report-page.test.ts`

- [ ] **Step 1: 저장소 포트**

`fund-store.ts`:

```ts
// 펀드 목록 = SecureStore(키 1개, 2KB 한도 → core 의 MAX_FUNDS·MAX_NAME),
// 리포트 캐시 = 앱 문서 폴더의 펀드별 JSON 파일(SecureStore 2KB 한도를 넘으므로).
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { parseFundList, type CacheEntry, type CachePort, type FundEntry } from './core';

const LIST_KEY = 'fund_list_v1';

export async function loadFunds(): Promise<FundEntry[]> {
  return parseFundList(await SecureStore.getItemAsync(LIST_KEY));
}

export async function saveFunds(list: FundEntry[]): Promise<void> {
  await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(list));
}

const cacheFile = (id: string): File => new File(Paths.document, `fund-cache-${id}.json`);

export const fileCache: CachePort = {
  async read(id) {
    try {
      const f = cacheFile(id);
      return f.exists ? (JSON.parse(await f.text()) as CacheEntry) : null;
    } catch {
      return null;
    }
  },
  async write(id, entry) {
    const f = cacheFile(id);
    if (!f.exists) f.create();
    f.write(JSON.stringify(entry));
  },
};

export function deleteCache(id: string): void {
  try {
    const f = cacheFile(id);
    if (f.exists) f.delete();
  } catch {
    // 지우지 못해도 목록에서 빠졌으니 다시 읽히지 않는다
  }
}
```

- [ ] **Step 2: 테마 → CSS 변수**

`report-colors.ts`:

```ts
import type { ReportColors } from './report-web/report-page';

type ThemeColors = {
  background: string;
  surface: string;
  fill: string;
  border: string;
  text: string;
  textSecondary: string;
  primary: string;
  primarySoft: string;
  up: string;
  upSoft: string;
  down: string;
};

/** Unistyles 테마(파스텔 C안) → 리포트 페이지 CSS 변수 */
export function reportColors(c: ThemeColors): ReportColors {
  return {
    bg: c.background,
    surface: c.surface,
    'surface-2': c.fill,
    line: c.border,
    text: c.text,
    'text-2': c.textSecondary,
    'text-3': c.textSecondary,
    accent: c.primary,
    'accent-soft': c.primarySoft,
    up: c.up,
    down: c.down,
    warn: c.up,
    'warn-soft': c.upSoft,
  };
}
```

- [ ] **Step 3: 실패하는 테스트(페이지 문자열 무결성)**

`report-web/report-page.test.ts`:

```ts
import { REPORT_HTML, toReportScript, type ReportColors } from './report-page';

describe('report-page', () => {
  it('페이지에 렌더 진입점이 있고 템플릿 치환 흔적이 없다', () => {
    expect(REPORT_HTML).toContain('window.__report = function');
    expect(REPORT_HTML).toContain('id="app"');
    expect(REPORT_HTML).not.toContain('${');
    expect(REPORT_HTML).not.toContain('innerHTML'); // 원본 값은 textContent 로만 넣는다
  });

  it('주입 스크립트는 JSON 그대로 전달하고 true 로 끝난다', () => {
    const s = toReportScript({
      type: 'render',
      report: { title: '</script>', investorNo: '', investorName: '', notice: null, sections: [] },
      colors: {} as ReportColors,
    });
    expect(s.startsWith('window.__report&&window.__report({')).toBe(true);
    expect(s.endsWith(');true;')).toBe(true);
  });
});
```

Run: `cd mobile && npx jest src/features/fund/report-web`
Expected: FAIL — `Cannot find module './report-page'`

- [ ] **Step 4: 페이지 구현**

`report-web/report-page.ts`:

```ts
// 펀드 리포트 WebView 페이지 — fund_report/template.html 의 화면을 DOM 생성 방식으로 옮긴 것.
// RN 이 window.__report({type:'render', report, colors}) 로 데이터를 넣고, 페이지는 준비되면 {type:'ready'},
// 링크를 누르면 {type:'open', href} 를 보낸다(외부 브라우저로 여는 건 RN). 값은 textContent 로만 넣는다.
import type { FundReport } from '../core';

export type ReportColors = Record<
  | 'bg'
  | 'surface'
  | 'surface-2'
  | 'line'
  | 'text'
  | 'text-2'
  | 'text-3'
  | 'accent'
  | 'accent-soft'
  | 'up'
  | 'down'
  | 'warn'
  | 'warn-soft',
  string
>;
export type ReportMessage = { type: 'render'; report: FundReport; colors: ReportColors };
export type PageMessage = { type: 'ready' } | { type: 'open'; href: string };

export const toReportScript = (msg: ReportMessage): string =>
  `window.__report&&window.__report(${JSON.stringify(msg)});true;`;

const CSS = `
:root { --bg:#f7f5ff; --surface:#fff; --surface-2:#efebfb; --line:#ebe7f7; --text:#25223a; --text-2:#8e8aa6; --text-3:#8e8aa6;
  --accent:#6f8ef0; --accent-soft:#e2ecff; --up:#c93a6c; --down:#4f73d9; --warn:#c93a6c; --warn-soft:#fbd6e4; --radius:18px; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin:0; background:var(--bg); color:var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", Roboto, sans-serif;
  font-size:15px; line-height:1.55; letter-spacing:-0.01em; word-break:keep-all; overflow-wrap:anywhere; }
a { color:var(--accent); text-decoration:none; }
.num { font-variant-numeric: tabular-nums; }
.wrap { padding: 4px 16px 40px; }
.card { background:var(--surface); border-radius:var(--radius); padding:20px; }
section { margin-top:28px; }
.sec-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:0 4px 12px; }
.sec-head h2 { margin:0; font-size:18px; font-weight:700; display:flex; align-items:center; gap:8px; }
.sec-head h2::before { content:""; flex:none; width:4px; height:18px; border-radius:2px; background:var(--tone, var(--accent)); }
.sec-head .date { color:var(--text-3); font-size:13px; }
.notice { border:1px solid var(--warn-soft); }
.notice-label { display:inline-block; font-size:12px; font-weight:700; color:var(--warn); background:var(--warn-soft); padding:3px 10px; border-radius:999px; }
.signals { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 10px; }
.signal { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:10px; background:var(--surface-2); font-size:13px; color:var(--text-2); }
.signal b { color:var(--warn); }
.notice-msg { margin:0; font-size:16px; font-weight:600; }
.services { display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; margin-top:16px; padding-top:16px; border-top:1px solid var(--line); font-size:13px; color:var(--text-2); }
.services .k { font-weight:700; color:var(--text); margin-right:4px; }
.tag { padding:4px 10px; border-radius:999px; background:var(--surface-2); }
.links { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
.link-btn { display:inline-flex; align-items:center; gap:4px; padding:8px 14px; border-radius:10px; background:var(--accent-soft); color:var(--accent); font-size:14px; font-weight:600; }
.link-btn::after { content:"→"; }
.grid-2 { display:grid; gap:16px; }
@media (min-width:900px) { .grid-2.multi { grid-template-columns:1fr 1fr; } }
.acct-head { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
.acct-name { font-weight:700; font-size:16px; }
.pills { display:flex; flex-wrap:wrap; gap:6px; }
.pill { white-space:nowrap; font-size:12px; padding:3px 10px; border-radius:999px; background:var(--surface-2); color:var(--text-2); }
.pill b { color:var(--text); }
.hero { margin:14px 0 18px; }
.hero .label { color:var(--text-3); font-size:13px; }
.hero .value { font-size:clamp(26px, 8vw, 34px); font-weight:800; letter-spacing:-0.03em; line-height:1.2; }
.hero .value small { font-size:.5em; font-weight:600; color:var(--text-2); margin-left:2px; }
.hero .delta { margin-top:4px; font-size:14px; font-weight:600; }
.metrics { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); background:var(--surface-2); border-radius:14px; overflow:hidden; }
.metric { padding:12px 14px; min-width:0; box-shadow:0 0 0 .5px var(--line); }
.metric .k { font-size:12px; color:var(--text-3); }
.metric .v { font-size:15px; font-weight:700; text-align:right; margin-top:2px; }
.up { color:var(--up); } .down { color:var(--down); }
.memo { margin-top:14px; padding:14px 16px; border-radius:14px; background:var(--surface-2); font-size:13px; color:var(--text-2); }
.memo strong { display:block; color:var(--text); margin-bottom:6px; }
.memo ol { margin:0; padding-left:18px; }
.notes { margin-top:16px; }
.notes h3 { margin:0 0 10px 4px; font-size:14px; color:var(--text-2); }
.notes ul { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.notes li { padding:12px 14px; background:var(--surface); border-radius:12px; font-size:14px; color:var(--text-2); }
.notes b { color:var(--text); }
.progress { margin:4px 0 18px; }
.progress .bar { height:10px; border-radius:999px; background:var(--surface-2); overflow:hidden; }
.progress .fill { height:100%; border-radius:inherit; background:var(--tone, var(--accent)); }
.progress .cap { display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px 8px; margin-top:6px; font-size:12px; color:var(--text-3); }
.steps { display:grid; gap:12px; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); }
.step { background:var(--surface-2); border-radius:14px; padding:16px; }
.step .no { display:inline-block; font-size:12px; font-weight:700; color:var(--tone); background:var(--surface); padding:2px 10px; border-radius:999px; }
.step h4 { margin:8px 0 12px; font-size:15px; }
.step dl { margin:0; display:grid; gap:8px; }
.step dl div { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
.step dt { font-size:13px; color:var(--text-3); }
.step dd { margin:0; font-weight:700; text-align:right; }
.step dd.hl { color:var(--warn); font-size:18px; }
.cert { display:grid; gap:16px; }
.cert .company p { margin:6px 0 0; color:var(--text-2); font-size:14px; }
.cert .company p:first-of-type { color:var(--text); font-weight:700; font-size:16px; }
.cert dl { margin:0; display:grid; gap:10px; }
.cert dl div { display:flex; justify-content:space-between; gap:12px; padding-bottom:10px; border-bottom:1px dashed var(--line); }
.cert dl div:last-child { border-bottom:0; padding-bottom:0; }
.cert dt { color:var(--text-3); font-size:13px; }
.cert dd { margin:0; font-weight:700; text-align:right; white-space:pre-line; }
.cert dd.big { font-size:20px; color:var(--accent); }
`;

// 페이지 스크립트(ES2017, WebView 에서 그대로 실행) — Hermes 는 함수 소스를 보존하지 않아 문자열로 둔다.
// 백틱 금지(바깥 String.raw 가 끝난다).
const PAGE_SCRIPT = String.raw`
(function () {
  var TONES = ['#7c5cff', '#ff7a45', '#00a5a5', '#4e5968', '#e0a800'];
  var HERO_KEYS = ['현재평가금', '수익측정가치'];
  var DELTA_KEYS = ['총 손익금', '누적수익율', '연환산수익율'];
  var PILL_KEYS = ['초기화/시작일'];
  var PROGRESS = ['누적송금액', '남은목표금액'];
  var app = document.getElementById('app');

  function post(m) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function h(tag, cls, kids) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    (kids || []).forEach(function (k) {
      if (k === null || k === undefined || k === false || k === '') return;
      el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    });
    return el;
  }
  function isMoney(v) { return /^-?[\d,]+$/.test(v); }
  function toNum(v) { return Number(String(v).replace(/[^\d.-]/g, '')); }
  function won(v) { return isMoney(v) ? v + '원' : v; }
  function toneOf(k, v) { return toNum(v) < 0 ? 'down' : k.indexOf('손익금') >= 0 ? 'up' : ''; }
  function linkBtn(l) {
    var href = l[1];
    if (!/^https?:\/\//i.test(href)) return null;
    var a = h('a', 'link-btn', [l[0]]);
    a.href = '#';
    a.addEventListener('click', function (e) { e.preventDefault(); post({ type: 'open', href: href }); });
    return a;
  }
  function links(ls) {
    var btns = (ls || []).map(linkBtn).filter(Boolean);
    return btns.length ? h('div', 'links', btns) : null;
  }
  function rich(segs) { return segs.map(function (s) { return s[1] ? h('b', '', [s[0]]) : s[0]; }); }
  function metric(k, v) { return h('div', 'metric', [h('div', 'k', [k]), h('div', 'v num ' + toneOf(k, v), [v])]); }

  function renderNotice(n) {
    if (!n) return null;
    return h('div', 'card notice', [
      h('span', 'notice-label', [n.label]),
      n.signals.length ? h('div', 'signals', [h('span', 'signal', [n.signalsLabel])].concat(n.signals.map(function (s) {
        return h('span', 'signal', [s[0] + ' ', h('b', '', [s[1]])]);
      }))) : null,
      n.message ? h('p', 'notice-msg', [n.message]) : null,
      n.services.length ? h('div', 'services', [h('span', 'k', [n.servicesLabel])].concat(n.services.map(function (t) {
        return h('span', 'tag', [t]);
      }))) : null,
      links(n.links)
    ]);
  }

  function accountCard(a) {
    var map = new Map(a.values);
    var heroKey = HERO_KEYS.filter(function (k) { return map.has(k); })[0];
    var delta = DELTA_KEYS.filter(function (k) { return map.has(k); }).slice(0, 2)
      .map(function (k) { return k + ' ' + won(map.get(k)); }).join(' · ');
    var pills = PILL_KEYS.filter(function (k) { return map.has(k); })
      .map(function (k) { return [k, map.get(k)]; }).concat(a.remarks);
    var metrics = a.values.filter(function (p) { return p[0] !== heroKey && PILL_KEYS.indexOf(p[0]) < 0; });

    var progress = null;
    if (PROGRESS.every(function (k) { return map.has(k); })) {
      var done = toNum(map.get(PROGRESS[0])), left = toNum(map.get(PROGRESS[1]));
      if (done + left > 0) {
        var pct = (done / (done + left)) * 100;
        var fill = h('div', 'fill');
        fill.style.width = pct.toFixed(1) + '%';
        progress = h('div', 'progress', [
          h('div', 'bar', [fill]),
          h('div', 'cap', [h('span', '', [PROGRESS[0] + ' ' + won(map.get(PROGRESS[0]))]), h('span', '', [PROGRESS[1] + ' ' + won(map.get(PROGRESS[1]))])]),
          h('div', 'cap', [h('span', '', ['※ 진행률 ' + pct.toFixed(1) + '%는 ' + PROGRESS[0] + ' ÷ (' + PROGRESS[0] + ' + ' + PROGRESS[1] + ')으로 화면에서 계산한 값입니다.'])])
        ]);
      }
    }

    var hero = null;
    if (heroKey) {
      var hv = map.get(heroKey);
      hero = h('div', 'hero', [
        h('div', 'label', [heroKey]),
        h('div', 'value num', [hv, isMoney(hv) ? h('small', '', ['원']) : null]),
        delta ? h('div', 'delta num up', [delta]) : null
      ]);
    }
    var memo = a.remarkText ? h('div', 'memo', [
      a.remarkText.title ? h('strong', '', [a.remarkText.title]) : null,
      h('ol', '', a.remarkText.lines.map(function (l) { return h('li', '', [l]); }))
    ]) : null;

    return h('article', 'card', [
      h('div', 'acct-head', [
        h('span', 'acct-name', [a.name]),
        h('span', 'pills', pills.map(function (p) { return h('span', 'pill', [p[0] + ' ', h('b', 'num', [p[1]])]); }))
      ]),
      hero, progress,
      h('div', 'metrics', metrics.map(function (p) { return metric(p[0], p[1]); })),
      memo
    ]);
  }

  function renderAccounts(s) {
    var out = [h('div', 'grid-2' + (s.accounts.length > 1 ? ' multi' : ''), s.accounts.map(accountCard))];
    s.notes.forEach(function (n) {
      out.push(h('div', 'notes', [
        h('h3', '', [n.title]),
        h('ul', '', n.items.map(function (it) { return h('li', '', rich(it)); })),
        links(n.links)
      ]));
    });
    return out;
  }

  function renderSteps(s) {
    return [h('div', 'card', [
      h('div', 'steps', s.steps.map(function (st) {
        return h('div', 'step', [
          h('span', 'no', [st.no]),
          h('h4', '', [st.name]),
          h('dl', '', st.items.map(function (it) {
            return h('div', '', [h('dt', '', [it[0]]), h('dd', 'num' + (it[2] ? ' hl' : ''), [it[1]])]);
          }))
        ]);
      })),
      links(s.links)
    ])];
  }

  function renderCert(s) {
    return [h('div', 'card cert', [
      h('div', 'company', [h('span', 'pill', [s.companyLabel])].concat(s.company.map(function (l) { return h('p', '', [l]); }))),
      h('dl', '', s.fields.map(function (f) {
        return h('div', '', [h('dt', '', [f[0]]), h('dd', 'num' + (/^₩/.test(f[1]) ? ' big' : ''), [f[1]])]);
      }))
    ])];
  }

  var RENDERERS = { accounts: renderAccounts, steps: renderSteps, cert: renderCert };

  function render(d) {
    app.textContent = '';
    var notice = renderNotice(d.notice);
    if (notice) app.appendChild(notice);
    d.sections.forEach(function (s, i) {
      var sec = h('section', '', []);
      sec.style.setProperty('--tone', TONES[i % TONES.length]);
      sec.appendChild(h('div', 'sec-head', [
        h('h2', '', [s.title, s.group ? h('span', 'pill', [s.group]) : null]),
        s.evalDate ? h('span', 'date', ['최종평가일 ' + s.evalDate]) : null
      ]));
      (RENDERERS[s.kind] ? RENDERERS[s.kind](s) : []).forEach(function (el) { if (el) sec.appendChild(el); });
      app.appendChild(sec);
    });
  }

  function applyColors(c) {
    var st = document.documentElement.style;
    Object.keys(c || {}).forEach(function (k) { st.setProperty('--' + k, c[k]); });
  }

  window.__report = function (msg) {
    if (msg && msg.type === 'render') { applyColors(msg.colors); render(msg.report); }
  };
  post({ type: 'ready' });
})();
`;

export const REPORT_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${CSS}</style></head><body><main class="wrap" id="app"></main>
<script>${PAGE_SCRIPT}</script></body></html>`;
```

Run: `cd mobile && npx jest src/features/fund/report-web`
Expected: PASS (2 tests)

- [ ] **Step 5: WebView 컴포넌트**

`components/report-view.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { FundReport } from '../core';
import { REPORT_HTML, toReportScript, type PageMessage, type ReportColors } from '../report-web/report-page';

const SOURCE = { html: REPORT_HTML }; // 모듈 상수 — 렌더마다 새 객체면 WebView 가 다시 로드된다

type Props = { report: FundReport; colors: ReportColors };

/** 리포트 페이지(WebView). 준비 신호를 받으면 최신 데이터를 넣고, 이후 데이터·색이 바뀔 때마다 다시 넣는다. */
export function ReportView({ report, colors }: Props) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ report, colors });
  latest.current = { report, colors };

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(toReportScript({ type: 'render', report, colors }));
  }, [ready, report, colors]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: PageMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data) as PageMessage;
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      setReady(true);
      // 페이지가 다시 로드된 경우(프로세스 재시작 등) ready 가 이미 true 라 effect 가 안 돈다 → 직접 넣는다
      ref.current?.injectJavaScript(toReportScript({ type: 'render', ...latest.current }));
    } else if (msg.type === 'open' && /^https?:\/\//i.test(msg.href)) {
      void Linking.openURL(msg.href);
    }
  };

  return (
    <WebView
      ref={ref}
      source={SOURCE}
      originWhitelist={['*']}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:')} // 페이지 밖 이동 차단
      onContentProcessDidTerminate={() => ref.current?.reload()}
      onRenderProcessGone={() => ref.current?.reload()}
      javaScriptEnabled
      setBuiltInZoomControls={false}
      webviewDebuggingEnabled={__DEV__}
      style={{ flex: 1, backgroundColor: colors.bg }}
    />
  );
}
```

- [ ] **Step 6: 타입 검사 + 테스트**

```bash
cd mobile && npx jest src/features/fund && (npx tsc --noEmit -p . 2>&1 | grep "features/fund" || echo "fund: no type errors")
```

Expected: 테스트 PASS, `fund: no type errors`. (`expo-file-system` 의 `File`/`Paths` 타입 오류가 나면 `node_modules/expo-file-system/build/index.d.ts` 에서 export 이름을 확인해 맞춘다 — SDK 54+ 는 `File`, `Paths` 가 기본 export.)

- [ ] **Step 7: Commit**

```bash
git add mobile/src/features/fund/fund-store.ts mobile/src/features/fund/report-colors.ts mobile/src/features/fund/report-web mobile/src/features/fund/components
git commit -m "feat(mobile): 펀드 저장소(SecureStore·파일 캐시)·WebView 리포트 페이지

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 앱 화면(목록·리포트) + 메뉴

**Files:**
- Create: `mobile/src/app/fund/index.tsx`, `mobile/src/app/fund/[id].tsx`
- Modify: `mobile/src/app/_layout.tsx` (Stack.Screen 2줄)
- Modify: `mobile/src/app/(tabs)/profile.tsx` (로그인 화면 Streak 목록 `styles.group` 위에 메뉴 그룹)

- [ ] **Step 1: 목록 화면**

`mobile/src/app/fund/index.tsx`:

```tsx
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import {
  addFund,
  displayName,
  isFundError,
  MAX_NAME,
  newFundId,
  removeFund,
  type FundEntry,
} from '@/features/fund/core';
import { deleteCache, loadFunds, saveFunds } from '@/features/fund/fund-store';
import { Button, Card, ListRow, ListState, showToast } from '@/ui';

// 내 펀드 수익 — 기기에 저장한 fund.ivyro.net 펀드 현황 주소 목록(추가·삭제). 서버에는 저장하지 않는다.
export default function FundListScreen() {
  const router = useRouter();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const [funds, setFunds] = useState<FundEntry[] | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  // 리포트 화면에서 기본 이름이 붙을 수 있어 돌아올 때마다 다시 읽는다
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadFunds().then((l) => {
        if (alive) setFunds(l);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!user) return <Redirect href="/profile" />;

  const handleAdd = async () => {
    try {
      const next = addFund(funds ?? [], { name, url }, newFundId());
      await saveFunds(next);
      setFunds(next);
      setName('');
      setUrl('');
      setError('');
      showToast('펀드를 추가했어요');
    } catch (e) {
      setError(isFundError(e, 'input') ? e.message : '저장하지 못했어요. 다시 시도해 주세요.');
    }
  };

  const handleRemove = (f: FundEntry) => {
    Alert.alert('펀드 삭제', `${displayName(f)}을(를) 목록에서 지울까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          const next = removeFund(funds ?? [], f.id);
          void saveFunds(next).then(() => {
            deleteCache(f.id);
            setFunds(next);
          });
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.label}>펀드 현황 주소</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https://fund.ivyro.net/dataroom/om_data/…"
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Text style={styles.label}>이름 (선택)</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="비우면 투자자 번호로 정해져요"
          placeholderTextColor={theme.colors.textSecondary}
          maxLength={MAX_NAME}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="추가" onPress={handleAdd} disabled={!url.trim()} />
      </Card>

      {funds === null ? (
        <ListState mode="loading" />
      ) : funds.length === 0 ? (
        <ListState
          mode="empty"
          emoji="💰"
          title="등록한 펀드가 없어요"
          hint="fund.ivyro.net 에서 받은 내 펀드 현황 주소를 붙여 넣어 주세요."
        />
      ) : (
        <View style={styles.group}>
          {funds.map((f) => (
            <ListRow
              key={f.id}
              title={displayName(f)}
              subtitle="탭해서 수익 보기"
              left={<Text style={styles.emoji}>📈</Text>}
              right={
                <Pressable onPress={() => handleRemove(f)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.remove}>삭제</Text>
                </Pressable>
              }
              onPress={() => router.push(`/fund/${f.id}`)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2), gap: theme.gap(2) },
  label: { fontSize: 13, color: theme.colors.textSecondary, marginBottom: theme.gap(0.5) },
  input: {
    backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.input,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1.5),
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: theme.gap(1.5),
  },
  error: { color: theme.colors.up, fontSize: 13, marginBottom: theme.gap(1) },
  group: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, overflow: 'hidden' },
  emoji: { fontSize: 20 },
  remove: { color: theme.colors.textSecondary, fontSize: 13 },
}));
```

- [ ] **Step 2: 리포트 화면**

`mobile/src/app/fund/[id].tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { ReportView } from '@/features/fund/components/report-view';
import {
  defaultName,
  displayName,
  evalDateOf,
  formatChecked,
  renameFund,
  useFundReport,
  type FundEntry,
} from '@/features/fund/core';
import { fileCache, loadFunds, saveFunds } from '@/features/fund/fund-store';
import { reportColors } from '@/features/fund/report-colors';
import { Button, ListState } from '@/ui';

// 펀드 리포트 — 캐시를 먼저 보여주고 열 때마다 원본을 다시 가져온다(헤더 새로고침 버튼으로 수동 갱신).
export default function FundReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const [fund, setFund] = useState<FundEntry | null | undefined>(undefined); // undefined=읽는 중, null=없음

  useEffect(() => {
    let alive = true;
    void loadFunds().then((l) => {
      if (alive) setFund(l.find((f) => f.id === id) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const { entry, refreshing, error, refresh } = useFundReport(fund ?? null, fileCache);
  const colors = useMemo(() => reportColors(theme.colors), [theme.colors]);

  // 이름 없이 등록한 펀드는 첫 리포트로 기본 이름을 붙여 저장
  useEffect(() => {
    if (!fund || fund.name || !entry) return;
    const name = defaultName(entry.report);
    void loadFunds()
      .then((l) => saveFunds(renameFund(l, fund.id, name)))
      .then(() => setFund({ ...fund, name }));
  }, [fund, entry]);

  if (!user) return <Redirect href="/profile" />;

  const openSource = () => {
    if (fund) void Linking.openURL(fund.url);
  };
  const header = (
    <Stack.Screen
      options={{
        title: fund ? displayName(fund) : '펀드 리포트',
        headerRight: () =>
          refreshing ? (
            <ActivityIndicator />
          ) : (
            <Pressable onPress={refresh} hitSlop={8} accessibilityRole="button" accessibilityLabel="새로고침">
              <Ionicons name="refresh" size={20} color={theme.colors.text} />
            </Pressable>
          ),
      }}
    />
  );

  if (fund === undefined) {
    return (
      <View style={styles.flex}>
        {header}
        <ListState mode="loading" />
      </View>
    );
  }
  if (fund === null) {
    return (
      <View style={styles.flex}>
        {header}
        <ListState mode="empty" emoji="🔍" title="펀드를 찾을 수 없어요" hint="목록에서 다시 선택해 주세요." />
      </View>
    );
  }
  if (!entry) {
    return (
      <View style={styles.flex}>
        {header}
        {error === 'format' ? (
          <View style={styles.center}>
            <ListState mode="error" title="원본 형식이 바뀌어 읽을 수 없어요" hint="원본 페이지에서 직접 확인해 주세요." />
            <Button label="원본 열기" variant="secondary" onPress={openSource} />
          </View>
        ) : error ? (
          <ListState
            mode="error"
            title="펀드 현황을 가져오지 못했어요"
            hint="연결을 확인하고 다시 시도해 주세요."
            onRetry={refresh}
          />
        ) : (
          <ListState mode="loading" />
        )}
      </View>
    );
  }

  const evalDate = evalDateOf(entry.report);
  return (
    <View style={styles.flex}>
      {header}
      <View style={styles.status}>
        <Text style={styles.evalDate}>{evalDate ? `기준일 ${evalDate}` : entry.report.title}</Text>
        <Text style={styles.checked}>마지막 확인 {formatChecked(entry.fetchedAt, Date.now())}</Text>
      </View>
      {error === 'fetch' ? <Banner text="최신 정보를 못 가져왔어요. 저장된 내용을 보여드려요." /> : null}
      {error === 'format' ? (
        <Banner text="원본 형식이 바뀌어 최신 내용을 읽을 수 없어요." action="원본 열기" onAction={openSource} />
      ) : null}
      {entry.missing.length > 0 ? (
        <Banner text="일부 항목이 빠졌을 수 있어요." action="원본 열기" onAction={openSource} />
      ) : null}
      <ReportView report={entry.report} colors={colors} />
    </View>
  );
}

function Banner({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{text}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={styles.bannerAction}>{action} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', padding: theme.gap(2), gap: theme.gap(2) },
  status: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(2),
    paddingBottom: theme.gap(1),
  },
  evalDate: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  checked: { fontSize: 12, color: theme.colors.textSecondary },
  banner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.gap(1),
    marginHorizontal: theme.gap(2),
    marginBottom: theme.gap(1),
    paddingHorizontal: theme.gap(2),
    paddingVertical: theme.gap(1.5),
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.upSoft,
  },
  bannerText: { flexShrink: 1, fontSize: 13, color: theme.colors.text },
  bannerAction: { fontSize: 13, fontWeight: '700', color: theme.colors.up },
}));
```

- [ ] **Step 3: 스택 등록**

`mobile/src/app/_layout.tsx` 의 `<Stack.Screen name="blog/[id]" … />` 바로 아래에 추가:

```tsx
        <Stack.Screen name="fund/index" options={{ headerShown: true, title: '내 펀드 수익' }} />
        <Stack.Screen name="fund/[id]" options={{ headerShown: true, title: '펀드 리포트' }} />
```

- [ ] **Step 4: 프로필 메뉴**

`mobile/src/app/(tabs)/profile.tsx` 로그인 화면에서 Streak 출석 목록의 `<View style={styles.group}>` **바로 위**에 추가:

```tsx
        <View style={styles.group}>
          <ListRow
            title="내 펀드 수익"
            subtitle="fund.ivyro.net 펀드 현황"
            left={<Text style={styles.emoji}>💰</Text>}
            onPress={() => router.push('/fund')}
          />
        </View>
```

(`router`·`ListRow`·`styles.group`·`styles.emoji` 는 이미 파일에 있다.)

- [ ] **Step 5: 타입 검사(typed routes 갱신 포함) + 전체 테스트**

typed routes(`app.config.js` 의 `experiments.typedRoutes`) 타입은 `expo start` 가 `.expo/types` 에 다시 만든다.

```bash
cd mobile
(npx expo start --port 8082 > "$TMPDIR/expo-fund.log" 2>&1 &) ; sleep 25 ; pkill -f "expo start --port 8082" || true
npx tsc --noEmit -p . 2>&1 | grep -E "features/fund|app/fund|profile.tsx|_layout.tsx" || echo "fund screens: no type errors"
npx jest
```

Expected: `fund screens: no type errors`, jest 전체 PASS(기존 테스트 포함 — 회귀 없음).

- [ ] **Step 6: 수동 확인(dev build, 에뮬레이터)**

`adb reverse` 설정 후 `npx expo start --port 8082` → 로그인 → 내정보 → 내 펀드 수익 → 실제 내 URL 추가 → 리포트 표시. 다크 모드 전환 시 색 변경, 링크 버튼이 외부 브라우저로 열림, 비행기 모드에서 다시 열면 캐시 + "최신 정보를 못 가져왔어요" 배너, 헤더 새로고침 동작.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/app/fund mobile/src/app/_layout.tsx "mobile/src/app/(tabs)/profile.tsx"
git commit -m "feat(mobile): 내 펀드 수익 화면(목록·리포트) + 내정보 메뉴

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 웹 저장소 + 리포트 컴포넌트

**Files:**
- Create: `web_client/src/lib/fundStore.ts`
- Create: `web_client/src/components/fund/FundReportView.tsx`

- [ ] **Step 1: 저장소**

`web_client/src/lib/fundStore.ts`:

```ts
import { parseFundList, type CacheEntry, type CachePort, type FundEntry } from './fundCore'

// 펀드 목록·리포트 캐시 = 이 브라우저 localStorage(서버 저장 없음). 사생활 보호 모드 등에서 실패해도 무시.
const LIST_KEY = 'fund_list_v1'
const CACHE_PREFIX = 'fund_cache_v1:'

function get(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 저장 불가 환경 — 화면은 계속 동작
  }
}

export const loadFunds = (): FundEntry[] => parseFundList(get(LIST_KEY))
export const saveFunds = (list: FundEntry[]): void => set(LIST_KEY, JSON.stringify(list))

export const localCache: CachePort = {
  async read(id) {
    const raw = get(CACHE_PREFIX + id)
    if (!raw) return null
    try {
      return JSON.parse(raw) as CacheEntry
    } catch {
      return null
    }
  },
  async write(id, entry) {
    set(CACHE_PREFIX + id, JSON.stringify(entry))
  },
}

export function deleteCache(id: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + id)
  } catch {
    // 무시
  }
}
```

- [ ] **Step 2: 리포트 컴포넌트**

`web_client/src/components/fund/FundReportView.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react'
import type {
  Account,
  AccountsSection,
  CertSection,
  FundReport,
  Link as FundLink,
  Notice,
  Section,
  Seg,
  StepsSection,
} from '../../lib/fundCore'

// 펀드 리포트(웹) — fund_report/template.html 의 화면을 React+Tailwind 로 옮긴 것.
// 값은 원본 문자열 그대로(React 이스케이프), 링크는 http(s)만 새 탭으로 연다.
const TONES = ['#7c5cff', '#ff7a45', '#00a5a5', '#4e5968', '#e0a800']
const HERO_KEYS = ['현재평가금', '수익측정가치'] // 계좌 카드에서 크게 보여줄 값(먼저 찾은 것)
const DELTA_KEYS = ['총 손익금', '누적수익율', '연환산수익율'] // 큰 값 아래 요약(앞에서 2개)
const PILL_KEYS = ['초기화/시작일'] // 카드 머리 배지로 옮길 값
const PROGRESS: [string, string] = ['누적송금액', '남은목표금액'] // 둘 다 있으면 진행률 막대

const isMoney = (v: string) => /^-?[\d,]+$/.test(v)
const toNum = (v: string) => Number(v.replace(/[^\d.-]/g, ''))
const won = (v: string) => (isMoney(v) ? `${v}원` : v)
const toneClass = (k: string, v: string) => (toNum(v) < 0 ? 'text-down' : k.includes('손익금') ? 'text-up' : 'text-ink')
const safeHref = (href: string) => (/^https?:\/\//i.test(href) ? href : null)

function Pill({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap rounded-full bg-fill px-2.5 py-0.5 text-xs text-ink-muted">{children}</span>
}

function Links({ links }: { links: FundLink[] }) {
  const items = links.flatMap(([label, href]) => {
    const safe = safeHref(href)
    return safe ? [{ label, href: safe }] : []
  })
  if (!items.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((l, i) => (
        <a
          key={i}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-field bg-brand-soft px-3.5 py-2 text-sm font-semibold text-brand hover:brightness-95"
        >
          {l.label} →
        </a>
      ))}
    </div>
  )
}

const rich = (segs: Seg[]) =>
  segs.map(([t, b], i) =>
    b ? (
      <b key={i} className="text-ink">
        {t}
      </b>
    ) : (
      <span key={i}>{t}</span>
    ),
  )

function NoticeCard({ n }: { n: Notice }) {
  return (
    <div className="rounded-card bg-surface p-5 ring-1 ring-up-soft md:p-6">
      <span className="inline-block rounded-full bg-up-soft px-2.5 py-0.5 text-xs font-bold text-up">{n.label}</span>
      {n.signals.length > 0 && (
        <div className="mb-2.5 mt-3.5 flex flex-wrap gap-2 text-sm text-ink-muted">
          <span className="rounded-field bg-fill px-3 py-1.5">{n.signalsLabel}</span>
          {n.signals.map(([k, v], i) => (
            <span key={i} className="rounded-field bg-fill px-3 py-1.5">
              {k} <b className="text-up">{v}</b>
            </span>
          ))}
        </div>
      )}
      {n.message && <p className="font-semibold text-ink">{n.message}</p>}
      {n.services.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm text-ink-muted">
          <span className="mr-1 font-bold text-ink">{n.servicesLabel}</span>
          {n.services.map((t, i) => (
            <span key={i} className="rounded-full bg-fill px-2.5 py-1">
              {t}
            </span>
          ))}
        </div>
      )}
      <Links links={n.links} />
    </div>
  )
}

function AccountCard({ a }: { a: Account }) {
  const map = new Map(a.values)
  const heroKey = HERO_KEYS.find((k) => map.has(k))
  const heroValue = heroKey ? (map.get(heroKey) ?? '') : ''
  const delta = DELTA_KEYS.filter((k) => map.has(k))
    .slice(0, 2)
    .map((k) => `${k} ${won(map.get(k) ?? '')}`)
    .join(' · ')
  const pills: [string, string][] = [
    ...PILL_KEYS.filter((k) => map.has(k)).map((k): [string, string] => [k, map.get(k) ?? '']),
    ...a.remarks,
  ]
  const metrics = a.values.filter(([k]) => k !== heroKey && !PILL_KEYS.includes(k))
  const [doneKey, leftKey] = PROGRESS
  const done = toNum(map.get(doneKey) ?? '')
  const left = toNum(map.get(leftKey) ?? '')
  const pct = map.has(doneKey) && map.has(leftKey) && done + left > 0 ? (done / (done + left)) * 100 : null

  return (
    <article className="rounded-card bg-surface p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-bold text-ink">{a.name}</span>
        <span className="flex flex-wrap gap-1.5">
          {pills.map(([k, v], i) => (
            <Pill key={i}>
              {k} <b className="tabular-nums text-ink">{v}</b>
            </Pill>
          ))}
        </span>
      </div>
      {heroKey && (
        <div className="mb-4 mt-3.5">
          <div className="text-sm text-ink-muted">{heroKey}</div>
          <div className="text-[clamp(26px,6vw,34px)] font-extrabold leading-tight tracking-tight tabular-nums text-ink">
            {heroValue}
            {isMoney(heroValue) && <small className="ml-0.5 text-[0.5em] font-semibold text-ink-muted">원</small>}
          </div>
          {delta && <div className="mt-1 text-sm font-semibold tabular-nums text-up">{delta}</div>}
        </div>
      )}
      {pct !== null && (
        <div className="mb-4">
          <div className="h-2.5 overflow-hidden rounded-full bg-fill">
            <div className="h-full rounded-full bg-[var(--tone)]" style={{ width: `${pct.toFixed(1)}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-xs text-ink-muted">
            <span>
              {doneKey} {won(map.get(doneKey) ?? '')}
            </span>
            <span>
              {leftKey} {won(map.get(leftKey) ?? '')}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            ※ 진행률 {pct.toFixed(1)}%는 {doneKey} ÷ ({doneKey} + {leftKey})으로 화면에서 계산한 값입니다.
          </p>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] overflow-hidden rounded-2xl bg-fill">
        {metrics.map(([k, v], i) => (
          <div key={i} className="min-w-0 px-3.5 py-3 shadow-[0_0_0_0.5px_#ebe7f7]">
            <div className="text-xs text-ink-muted">{k}</div>
            <div className={`mt-0.5 text-right text-[15px] font-bold tabular-nums ${toneClass(k, v)}`}>{v}</div>
          </div>
        ))}
      </div>
      {a.remarkText && (
        <div className="mt-3.5 rounded-2xl bg-fill px-4 py-3.5 text-sm text-ink-muted">
          {a.remarkText.title && <strong className="mb-1.5 block text-ink">{a.remarkText.title}</strong>}
          <ol className="list-decimal pl-[18px]">
            {a.remarkText.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </div>
      )}
    </article>
  )
}

function AccountsBlock({ s }: { s: AccountsSection }) {
  return (
    <>
      <div className={`grid gap-4 ${s.accounts.length > 1 ? 'min-[900px]:grid-cols-2' : ''}`}>
        {s.accounts.map((a, i) => (
          <AccountCard key={i} a={a} />
        ))}
      </div>
      {s.notes.map((n, i) => (
        <div key={i} className="mt-4">
          <h3 className="mb-2.5 ml-1 text-sm font-semibold text-ink-muted">{n.title}</h3>
          <ul className="grid gap-2">
            {n.items.map((segs, j) => (
              <li key={j} className="rounded-field bg-surface px-3.5 py-3 text-sm text-ink-muted">
                {rich(segs)}
              </li>
            ))}
          </ul>
          <Links links={n.links} />
        </div>
      ))}
    </>
  )
}

function StepsBlock({ s }: { s: StepsSection }) {
  return (
    <div className="rounded-card bg-surface p-5 md:p-6">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
        {s.steps.map((st, i) => (
          <div key={i} className="rounded-2xl bg-fill p-4">
            <span className="inline-block rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-[var(--tone)]">
              {st.no}
            </span>
            <h4 className="mb-3 mt-2 text-[15px] font-semibold text-ink">{st.name}</h4>
            <dl className="grid gap-2">
              {st.items.map(([k, v, hl], j) => (
                <div key={j} className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-ink-muted">{k}</dt>
                  <dd className={`text-right font-bold tabular-nums ${hl ? 'text-lg text-up' : 'text-ink'}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <Links links={s.links} />
    </div>
  )
}

function CertBlock({ s }: { s: CertSection }) {
  return (
    <div className="grid gap-4 rounded-card bg-surface p-5 md:grid-cols-[1.3fr_1fr] md:p-6">
      <div>
        <Pill>{s.companyLabel}</Pill>
        {s.company.map((l, i) => (
          <p key={i} className={i === 0 ? 'mt-1.5 text-base font-bold text-ink' : 'mt-1.5 text-sm text-ink-muted'}>
            {l}
          </p>
        ))}
      </div>
      <dl className="grid gap-2.5">
        {s.fields.map(([k, v], i) => (
          <div key={i} className="flex justify-between gap-3 border-b border-dashed border-line pb-2.5 last:border-0 last:pb-0">
            <dt className="text-sm text-ink-muted">{k}</dt>
            <dd
              className={`whitespace-pre-line text-right font-bold tabular-nums ${/^₩/.test(v) ? 'text-xl text-brand' : 'text-ink'}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SectionBody({ s }: { s: Section }) {
  switch (s.kind) {
    case 'accounts':
      return <AccountsBlock s={s} />
    case 'steps':
      return <StepsBlock s={s} />
    case 'cert':
      return <CertBlock s={s} />
  }
}

export default function FundReportView({ report }: { report: FundReport }) {
  return (
    <div>
      {report.notice && <NoticeCard n={report.notice} />}
      {report.sections.map((s, i) => (
        <section key={i} className="mt-7" style={{ '--tone': TONES[i % TONES.length] } as CSSProperties}>
          <div className="mx-1 mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <span className="h-[18px] w-1 flex-none rounded-sm bg-[var(--tone)]" />
              {s.title}
              {s.kind === 'accounts' && s.group && <Pill>{s.group}</Pill>}
            </h2>
            {s.kind === 'accounts' && s.evalDate && (
              <span className="text-sm text-ink-muted">최종평가일 {s.evalDate}</span>
            )}
          </div>
          <SectionBody s={s} />
        </section>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: 타입 검사**

Run: `cd web_client && npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 4: Commit**

```bash
git add web_client/src/lib/fundStore.ts web_client/src/components/fund
git commit -m "feat(web): 펀드 저장소(localStorage)·리포트 컴포넌트(template 이식)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 웹 페이지·라우트·메뉴

**Files:**
- Create: `web_client/src/pages/FundListPage.tsx`, `web_client/src/pages/FundReportPage.tsx`
- Modify: `web_client/src/App.tsx` (lazy import 2줄 + Route 2개)
- Modify: `web_client/src/pages/MyPage.tsx` (게임 Link 아래 1개)

- [ ] **Step 1: 목록 페이지**

`web_client/src/pages/FundListPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import { addFund, displayName, isFundError, MAX_NAME, newFundId, removeFund, type FundEntry } from '../lib/fundCore'
import { deleteCache, loadFunds, saveFunds } from '../lib/fundStore'
import { useAuthStore } from '../store/auth'

// 내 펀드 수익(/me/funds) — 이 브라우저에 저장한 fund.ivyro.net 펀드 현황 주소 목록. 서버에는 저장하지 않는다.
export default function FundListPage() {
  const user = useAuthStore((s) => s.user)
  const [funds, setFunds] = useState<FundEntry[]>(() => loadFunds())
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  if (!user) return <Navigate to="/me" replace />

  const handleAdd = (e: FormEvent) => {
    e.preventDefault()
    try {
      const next = addFund(funds, { name, url }, newFundId())
      saveFunds(next)
      setFunds(next)
      setName('')
      setUrl('')
      setError('')
    } catch (err) {
      setError(isFundError(err, 'input') ? err.message : '저장하지 못했어요. 다시 시도해 주세요.')
    }
  }

  const handleRemove = (f: FundEntry) => {
    if (!window.confirm(`${displayName(f)}을(를) 목록에서 지울까요?`)) return
    const next = removeFund(funds, f.id)
    saveFunds(next)
    deleteCache(f.id)
    setFunds(next)
  }

  const inputCls =
    'mt-1 w-full rounded-field bg-fill px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-brand'

  return (
    <div>
      <Link to="/me" className="text-sm text-ink-muted">
        ‹ 내정보
      </Link>
      <h1 className="mb-5 mt-1 text-xl font-bold text-ink">내 펀드 수익</h1>

      <form onSubmit={handleAdd} className="rounded-card bg-surface p-5">
        <label htmlFor="fund-url" className="block text-sm text-ink-muted">
          펀드 현황 주소
        </label>
        <input
          id="fund-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          inputMode="url"
          autoComplete="off"
          placeholder="https://fund.ivyro.net/dataroom/om_data/…"
          className={inputCls}
        />
        <label htmlFor="fund-name" className="mt-3 block text-sm text-ink-muted">
          이름 (선택)
        </label>
        <input
          id="fund-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME}
          placeholder="비우면 투자자 번호로 정해져요"
          className={inputCls}
        />
        {error && <p className="mt-2 text-sm text-up">{error}</p>}
        <Button type="submit" full className="mt-4" disabled={!url.trim()}>
          추가
        </Button>
      </form>

      {funds.length === 0 ? (
        <p className="mt-6 text-center text-sm text-ink-muted">
          등록한 펀드가 없어요. fund.ivyro.net 에서 받은 내 펀드 현황 주소를 붙여 넣어 주세요.
        </p>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-card bg-surface">
          {funds.map((f) => (
            <li key={f.id} className="flex items-center border-b border-line last:border-0">
              <Link
                to={`/me/funds/${f.id}`}
                className="flex flex-1 items-center justify-between px-5 py-4 text-ink hover:bg-line"
              >
                <span>📈 {displayName(f)}</span>
                <span className="text-ink-muted">›</span>
              </Link>
              <button
                type="button"
                onClick={() => handleRemove(f)}
                className="px-4 py-4 text-sm text-ink-muted hover:text-up"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 리포트 페이지**

`web_client/src/pages/FundReportPage.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import FundReportView from '../components/fund/FundReportView'
import Button from '../components/ui/Button'
import {
  defaultName,
  displayName,
  evalDateOf,
  formatChecked,
  renameFund,
  useFundReport,
  type FundEntry,
} from '../lib/fundCore'
import { loadFunds, localCache, saveFunds } from '../lib/fundStore'
import { useAuthStore } from '../store/auth'

// 펀드 리포트(/me/funds/:id) — 캐시를 먼저 보여주고 열 때마다 원본을 다시 가져온다.
export default function FundReportPage() {
  const { id } = useParams()
  const user = useAuthStore((s) => s.user)
  const [fund, setFund] = useState<FundEntry | null>(() => loadFunds().find((f) => f.id === id) ?? null)
  const { entry, refreshing, error, refresh } = useFundReport(fund, localCache)

  // 이름 없이 등록한 펀드는 첫 리포트로 기본 이름을 붙여 저장
  useEffect(() => {
    if (!fund || fund.name || !entry) return
    const name = defaultName(entry.report)
    saveFunds(renameFund(loadFunds(), fund.id, name))
    setFund({ ...fund, name })
  }, [fund, entry])

  if (!user) return <Navigate to="/me" replace />
  if (!fund) {
    return (
      <div className="rounded-card bg-surface p-6 text-center">
        <p className="font-semibold text-ink">펀드를 찾을 수 없어요</p>
        <Link to="/me/funds" className="mt-3 inline-block text-sm text-brand">
          목록으로
        </Link>
      </div>
    )
  }

  const evalDate = entry ? evalDateOf(entry.report) : ''
  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/me/funds" className="text-sm text-ink-muted">
            ‹ 내 펀드
          </Link>
          <h1 className="mt-1 text-xl font-bold text-ink">{displayName(fund)}</h1>
          {entry && (
            <p className="mt-0.5 text-sm text-ink-muted">
              {evalDate ? `기준일 ${evalDate} · ` : ''}마지막 확인 {formatChecked(entry.fetchedAt, Date.now())}
            </p>
          )}
        </div>
        <Button variant="secondary" onClick={refresh} loading={refreshing} loadingText="확인 중…">
          새로고침
        </Button>
      </div>

      {entry && error === 'fetch' && <Banner>최신 정보를 못 가져왔어요. 저장된 내용을 보여드려요.</Banner>}
      {error === 'format' && <Banner sourceUrl={fund.url}>원본 형식이 바뀌어 최신 내용을 읽을 수 없어요.</Banner>}
      {entry && entry.missing.length > 0 && <Banner sourceUrl={fund.url}>일부 항목이 빠졌을 수 있어요.</Banner>}

      {entry ? (
        <FundReportView report={entry.report} />
      ) : error === 'fetch' ? (
        <div className="rounded-card bg-surface p-6 text-center">
          <p className="font-semibold text-ink">펀드 현황을 가져오지 못했어요</p>
          <Button className="mt-4" onClick={refresh}>
            다시 시도
          </Button>
        </div>
      ) : error ? null : (
        <p className="py-16 text-center text-ink-muted">불러오는 중…</p>
      )}
    </div>
  )
}

function Banner({ children, sourceUrl }: { children: ReactNode; sourceUrl?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-field bg-up-soft px-4 py-3 text-sm text-ink">
      <span>{children}</span>
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-up">
          원본 열기 →
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 라우트**

`web_client/src/App.tsx` — `const ScreenerPage = lazy(...)` 아래에:

```tsx
const FundListPage = lazy(() => import('./pages/FundListPage'))
const FundReportPage = lazy(() => import('./pages/FundReportPage'))
```

`<Route path="me" element={<MyPage />} />` 아래에(htmlparser2 가 메인 번들에 안 들어가도록 lazy):

```tsx
        <Route path="me/funds" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <FundListPage />
          </Suspense>
        } />
        <Route path="me/funds/:id" element={
          <Suspense fallback={<p className="py-16 text-center text-ink-muted">불러오는 중…</p>}>
            <FundReportPage />
          </Suspense>
        } />
```

- [ ] **Step 4: 내정보 메뉴**

`web_client/src/pages/MyPage.tsx` — 게임 `<Link to="/game" …>…</Link>` 바로 아래(같은 `div` 안):

```tsx
        <Link to="/me/funds" className="flex items-center justify-between border-t border-line px-5 py-4 text-ink hover:bg-line">
          <span>💰 내 펀드 수익</span>
          <span className="text-ink-muted">›</span>
        </Link>
```

- [ ] **Step 5: 빌드**

Run: `cd web_client && npm run build`
Expected: `tsc --noEmit && vite build` 성공, `FundListPage-*.js`/`FundReportPage-*.js` 청크가 따로 생김. (VITE_* 환경변수 누락으로 실패하면 `npx tsc --noEmit && npx vite build --mode development` 로 대신 확인.)

- [ ] **Step 6: 수동 확인**

`npm run dev`(3000) → 로그인 → `/me` → 내 펀드 수익 → 실제 내 URL 추가 → 리포트 표시. DevTools 기기 모드 375px 에서 가로 스크롤 없음(`document.documentElement.scrollWidth === 375`), 링크가 새 탭으로 열림, 잘못된 URL(`http://…`) 은 안내 문구, 새로고침 버튼 동작.

- [ ] **Step 7: Commit**

```bash
git add web_client/src/pages/FundListPage.tsx web_client/src/pages/FundReportPage.tsx web_client/src/App.tsx web_client/src/pages/MyPage.tsx
git commit -m "feat(web): 내 펀드 수익 페이지(/me/funds·/me/funds/:id) + 내정보 메뉴

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: README·최종 검증

**Files:** Modify: `README.md` (한 단락)

- [ ] **Step 1: README 에 단락 추가**

루트 `README.md` 의 웹/모바일 실행 안내 근처에:

```markdown
### 펀드 수익보기 (웹 /me/funds · 앱 내정보 > 내 펀드 수익)
- 회원이 fund.ivyro.net 펀드 현황 주소를 **기기에만** 저장하고, 클라이언트가 원본을 직접 가져와 파싱한다(백엔드·환경변수 없음).
- 공용 코드 기준은 `mobile/src/features/fund/core`, 웹은 복사본 `web_client/src/lib/fundCore`.
  core 를 고치면 `scripts/check-fund-core-sync.sh --write` 로 복사하고 `scripts/check-fund-core-sync.sh` 로 확인.
- 테스트: `cd mobile && npx jest src/features/fund` (가린 픽스처 + convert.py 기대 JSON 교차 검증).
- 설계: `docs/superpowers/specs/2026-10-18-fund-report-viewer-design.md`
```

- [ ] **Step 2: 전체 검증**

```bash
scripts/check-fund-core-sync.sh
(cd mobile && npx jest)
(cd web_client && npx tsc --noEmit)
git status --short
```

Expected: `fund core: in sync`, jest 전체 PASS, tsc 무출력, `git status` 에 실제 원본 HTML·개인 JSON 이 없음.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: 펀드 수익보기 실행·동기화 안내

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
