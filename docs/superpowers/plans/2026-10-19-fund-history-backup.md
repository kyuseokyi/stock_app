# 펀드 히스토리 + Google Drive 백업 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱에서 리포트를 새로 가져올 때마다 계좌별 현재평가금·당일 손익금·월 손익금을 날짜별로 기기에 쌓고, 차트+목록으로 보여주며, 사용자 본인 Google Drive(appDataFolder)에 백업·복원한다.

**Architecture:** 순수 로직(스냅샷 추출·병합·백업 검증/합치기·화면 모델)은 공용 core(`mobile/src/features/fund/core`, 웹 `web_client/src/lib/fundCore` 로 동기화 복사)에 두고 jest 로 검증한다. 앱 쪽은 얇은 저장소(expo-file-system / SecureStore), Drive REST 래퍼(fetch 주입), 네이티브 Google 로그인 래퍼, 화면(히스토리 WebView + 백업 네이티브)만 둔다. 업로드는 항상 "Drive 받기 → 합치기 → 올리기".

**Tech Stack:** Expo(dev build) · expo-router(typedRoutes) · Unistyles v3 · react-native-webview · expo-file-system(File/Paths) · expo-secure-store · `@react-native-google-signin/google-signin` · Google Drive REST v3 · jest-expo(`*.test.ts` 만).

**Spec:** `docs/superpowers/specs/2026-10-19-fund-history-backup-design.md`

## 공통 규칙 (모든 작업)
- 작업 브랜치 `dev`. 커밋 메시지 끝에 아래 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01T814x7jTTuEcJBrCqKt8Pf
  ```
- core 파일은 **상대 import 만**(웹에서도 컴파일됨). core 를 바꾼 작업은 끝에 반드시:
  ```bash
  cd <repo> && bash scripts/check-fund-core-sync.sh --write
  cd web_client && npx tsc -b --noEmit && npx eslint src/lib/fundCore
  ```
- 날짜 키는 `YYYY-MM-DD` 문자열. **`new Date('YYYY-MM-DD')` 금지**(UTC 로 해석돼 KST 하루 밀림). 날짜 검사는 모양만(`/^\d{4}-\d{2}-\d{2}$/`) — 가린 픽스처 `current.json` 의 최종평가일이 `3072년 90월 99일`, `legacy.json` 은 `9074년 3월 5일`.
- 픽스처 계좌(첫 accounts 섹션): current = `총 계`(현재평가금 `132,950,396` / 당일 `741,863` / 월 `7,799,528`), `홍길동(월초700)`(`752,340,496` / `383,414` / `4,582,934`). legacy = `총 계`(`548,047,289` / `255,602` / `556,603`), `홍길동`(`487,019,615` / `446,608` / `936,108`).
- 실제 개인 데이터(잔고·이름·URL) 커밋 금지 — 테스트는 픽스처와 `https://fund.ivyro.net/dataroom/om_data/t1.htm` 같은 가짜 URL 만.
- 앱 테스트: `cd mobile && npx jest src/features/fund`. 타입: `cd mobile && npx tsc --noEmit`.
- mobile ESLint 는 설정 미적용으로 기존 오류가 있다 — 바꾼 파일만 `npx eslint <파일>` 로 보고, 새 오류만 고친다.

## 파일 구조
| 파일 | 책임 |
|---|---|
| `core/view.ts` (수정) | `parseAmount` 추가(금액 문자열 → 숫자, 기존 `RE_INT` 재사용) |
| `core/history.ts` (신규) | 타입, `toIsoDate`, `snapshotOf`, `mergePoint`, `mergeAccounts`, `parseAccounts`, `parseHistory`, `emptyHistory` |
| `core/backup.ts` (신규) | `Backup` 타입, `BACKUP_FILE`, `buildBackup`, `parseBackup`, `mergeBackup`, `shouldAutoBackup`, `localDayKey` |
| `core/history-view.ts` (신규) | `toHistoryView` 화면 모델(기간 필터·차트 좌표·포맷) |
| `core/index.ts` (수정) | 위 3개 export |
| `features/fund/history-store.ts` (신규) | 펀드별 히스토리 파일 I/O, `recordSnapshot`, `loadAllHistories`, `writeHistories` |
| `features/fund/history-web/history-page.ts` (+test) | 히스토리 WebView 페이지(차트·목록 그리기만) |
| `features/fund/report-web/report-page.ts` (수정) | `REPORT_CSS` export(히스토리 페이지가 재사용) |
| `features/fund/components/history-view.tsx` | WebView 래퍼 |
| `features/fund/drive-backup.ts` (+test) | Drive REST(찾기·받기·올리기), `DriveError` |
| `features/fund/google-auth.ts` | 네이티브 Google 로그인 래퍼(`connect`/`accessToken`/`disconnect`) |
| `features/fund/backup-state.ts` | SecureStore 백업 상태 |
| `features/fund/backup-service.ts` | `backupNow`/`restoreFromDrive`/`maybeAutoBackup`/`hasRemoteBackup` |
| `app/fund/history/[id].tsx`, `app/fund/backup.tsx` | 화면 |
| `app/fund/[id].tsx`, `app/fund/index.tsx`, `app/_layout.tsx` (수정) | 기록 연결·아이콘·삭제 정리·라우트 |

(경로 접두 `mobile/src/` 생략. core = `mobile/src/features/fund/core`)

---

### Task 1: `parseAmount` + `core/history.ts`

**Files:**
- Modify: `mobile/src/features/fund/core/view.ts` (RE_DATE 정의 바로 아래)
- Create: `mobile/src/features/fund/core/history.ts`
- Test: `mobile/src/features/fund/core/history.test.ts`, `mobile/src/features/fund/core/view.test.ts`(케이스 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `core/history.test.ts`

```ts
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
```

`core/view.test.ts` 맨 아래에 추가(상단 import 에 `parseAmount` 추가):

```ts
describe('parseAmount', () => {
  it('원본 금액 문자열 → 숫자', () => {
    expect(parseAmount('₩12,345,000')).toBe(12345000);
    expect(parseAmount('-15,000')).toBe(-15000);
    expect(parseAmount(' 0 ')).toBe(0);
    expect(parseAmount('1.5%')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/history src/features/fund/core/view`
Expected: FAIL — `Cannot find module './history'`, `parseAmount is not a function`

- [ ] **Step 3: 구현**

`core/view.ts` — `const RE_DATE = …` 줄 바로 아래에 추가:

```ts
/** 원본 금액 문자열(₩·쉼표·음수) → 숫자. 금액 모양이 아니면 null. 히스토리 기록이 쓴다. */
export function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (!RE_INT.test(s)) return null;
  const n = Number(s.replace(/[₩,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
```

`core/history.ts`:

```ts
// 펀드 히스토리(계좌별 날짜 기록) — 순수 함수. 파일 저장은 앱 history-store 가 한다.
// 날짜 키는 원본 '최종평가일'을 YYYY-MM-DD 로 바꾼 문자열(모양만 검사 — Date 로 해석하지 않는다).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import type { FundReport, Pair } from './types';
import { parseAmount } from './view';

export type HistoryPoint = {
  date: string;
  value: number | null; // 현재평가금
  day: number | null; // 당일 손익금
  month: number | null; // 월 손익금
  recordedAt: number;
};
export type HistoryAccounts = Record<string, HistoryPoint[]>; // 계좌명 → 날짜 오름차순
export type FundHistory = { v: 1; url: string; accounts: HistoryAccounts };
export type Snapshot = { date: string; points: Record<string, HistoryPoint> };

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const RE_KO_DATE = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const emptyHistory = (url: string): FundHistory => ({ v: 1, url, accounts: {} });

export function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (RE_ISO.test(s)) return s;
  const m = RE_KO_DATE.exec(s);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

const pick = (pairs: Pair[], key: string): number | null => {
  const hit = pairs.find(([k]) => k.replace(/\s/g, '') === key);
  return hit ? parseAmount(hit[1]) : null;
};

/** 리포트 → 오늘 기록. 첫 accounts 섹션(최종평가일 있는 것, evalDateOf 와 같은 기준), 같은 계좌명은 첫 번째만. */
export function snapshotOf(report: FundReport, recordedAt: number): Snapshot | null {
  const sec = report.sections.find((s) => s.kind === 'accounts' && s.evalDate);
  if (!sec || sec.kind !== 'accounts') return null;
  const date = toIsoDate(sec.evalDate);
  if (!date) return null;
  const points: Record<string, HistoryPoint> = {};
  const seen = new Set<string>();
  for (const a of sec.accounts) {
    if (BAD_KEYS.has(a.name) || seen.has(a.name)) continue;
    seen.add(a.name);
    const pairs = [...a.values, ...a.remarks];
    const p: HistoryPoint = {
      date,
      value: pick(pairs, '현재평가금'),
      day: pick(pairs, '당일손익금'),
      month: pick(pairs, '월손익금'),
      recordedAt,
    };
    if (p.value !== null || p.day !== null || p.month !== null) points[a.name] = p;
  }
  return Object.keys(points).length ? { date, points } : null;
}

const byDate = (a: HistoryPoint, b: HistoryPoint) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** 점 하나 넣기 — 같은 날짜는 force 거나 recordedAt 이 더 늦을 때만 교체 */
function upsert(
  list: HistoryPoint[],
  p: HistoryPoint,
  force: boolean,
): { list: HistoryPoint[]; change: 'added' | 'replaced' | null } {
  const i = list.findIndex((x) => x.date === p.date);
  if (i >= 0) {
    if (!force && list[i].recordedAt >= p.recordedAt) return { list, change: null };
    const next = list.slice();
    next[i] = p;
    return { list: next, change: 'replaced' };
  }
  return { list: [...list, p].sort(byDate), change: 'added' };
}

/** 새로 가져온 기록 반영(같은 날짜는 무조건 새 값). added = 새 날짜가 생겼는지(자동 백업 신호) */
export function mergePoint(h: FundHistory, snap: Snapshot): { history: FundHistory; added: boolean } {
  let added = false;
  const accounts: HistoryAccounts = { ...h.accounts };
  for (const [name, p] of Object.entries(snap.points)) {
    if (BAD_KEYS.has(name)) continue;
    const r = upsert(accounts[name] ?? [], p, true);
    accounts[name] = r.list;
    if (r.change === 'added') added = true;
  }
  return { history: { ...h, accounts }, added };
}

/** 두 기록 합치기(복원·백업 합본) — 합집합, 같은 날짜는 recordedAt 늦은 쪽. changed = 추가·교체된 점 수 */
export function mergeAccounts(
  base: HistoryAccounts,
  extra: HistoryAccounts,
): { accounts: HistoryAccounts; changed: number } {
  let changed = 0;
  const accounts: HistoryAccounts = { ...base };
  for (const [name, pts] of Object.entries(extra)) {
    if (BAD_KEYS.has(name)) continue;
    let list = accounts[name] ?? [];
    for (const p of pts) {
      const r = upsert(list, p, false);
      list = r.list;
      if (r.change) changed++;
    }
    accounts[name] = list;
  }
  return { accounts, changed };
}

const numOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

export function isHistoryPoint(p: unknown): p is HistoryPoint {
  const o = p as Partial<HistoryPoint> | null;
  return (
    !!o &&
    typeof o.date === 'string' &&
    RE_ISO.test(o.date) &&
    numOrNull(o.value) &&
    numOrNull(o.day) &&
    numOrNull(o.month) &&
    typeof o.recordedAt === 'number' &&
    Number.isFinite(o.recordedAt)
  );
}

/** 저장·백업된 계좌별 기록 검증 — 잘못된 점·계좌는 버리고 날짜순·날짜 중복 제거 */
export function parseAccounts(raw: unknown): HistoryAccounts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: HistoryAccounts = {};
  for (const [name, pts] of Object.entries(raw as Record<string, unknown>)) {
    if (BAD_KEYS.has(name) || !Array.isArray(pts)) continue;
    const list = mergeAccounts({}, { [name]: pts.filter(isHistoryPoint) }).accounts[name] ?? [];
    if (list.length) out[name] = list;
  }
  return out;
}

export function parseHistory(raw: string | null, url: string): FundHistory {
  if (!raw) return emptyHistory(url);
  try {
    const d = JSON.parse(raw) as { v?: unknown; accounts?: unknown } | null;
    if (!d || d.v !== 1) return emptyHistory(url);
    return { v: 1, url, accounts: parseAccounts(d.accounts) };
  } catch {
    return emptyHistory(url);
  }
}
```

`core/index.ts` — `export * from './view';` 아래에 `export * from './history';` 추가.

- [ ] **Step 4: 통과 확인** — `cd mobile && npx jest src/features/fund` → PASS (기존 74 + 신규)

- [ ] **Step 5: 웹 동기화·검사**

Run: `cd <repo> && bash scripts/check-fund-core-sync.sh --write && cd web_client && npx tsc -b --noEmit && npx eslint src/lib/fundCore`
Expected: `fund core: in sync`, 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add mobile/src/features/fund/core web_client/src/lib/fundCore
git commit -m "feat(fund): 히스토리 core — 리포트 스냅샷 추출·날짜별 병합·검증"
```

---

### Task 2: `core/backup.ts`

**Files:**
- Create: `mobile/src/features/fund/core/backup.ts`
- Test: `mobile/src/features/fund/core/backup.test.ts`
- Modify: `mobile/src/features/fund/core/index.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
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
```

- [ ] **Step 2: 실패 확인** — `cd mobile && npx jest src/features/fund/core/backup` → FAIL(`Cannot find module './backup'`)

- [ ] **Step 3: 구현** — `core/backup.ts`

```ts
// Google Drive 백업 파일 모양·검증·합치기(순수 함수). Drive 호출은 앱 drive-backup.ts.
// 펀드 id 는 기기마다 새로 생기므로 백업에서는 URL 이 키. 업로드는 항상 Drive 합본(buildBackup 의 remote).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { MAX_FUNDS, MAX_NAME, type FundEntry } from './funds';
import { mergeAccounts, parseAccounts, type HistoryAccounts } from './history';
import { isFundUrl } from './url';

export const BACKUP_FILE = 'fund-backup-v1.json';

export type Backup = {
  v: 1;
  exportedAt: number;
  funds: { name: string; url: string }[];
  history: Record<string, HistoryAccounts>; // url → 계좌별 기록
};
/** 기기 데이터 — histories 키는 url */
export type LocalData = { funds: FundEntry[]; histories: Record<string, HistoryAccounts> };
export type MergeResult = LocalData & { addedFunds: number; skippedFunds: number; mergedPoints: number };

/** 올릴 백업 = 로컬 + Drive(remote). Drive 에만 있는 펀드·기록도 남겨 재설치 직후 덮어쓰기를 막는다. */
export function buildBackup(local: LocalData, remote: Backup | null, now: number): Backup {
  const funds = local.funds.map(({ name, url }) => ({ name, url }));
  for (const f of remote?.funds ?? []) if (!funds.some((x) => x.url === f.url)) funds.push(f);
  const history: Record<string, HistoryAccounts> = {};
  for (const { url } of funds) {
    const merged = mergeAccounts(remote?.history[url] ?? {}, local.histories[url] ?? {}).accounts;
    if (Object.keys(merged).length) history[url] = merged;
  }
  return { v: 1, exportedAt: now, funds, history };
}

/** Drive 에서 받은 글자 → 검증된 백업. 최상위가 깨졌으면 null, 틀린 항목은 버린다. */
export function parseBackup(raw: string): Backup | null {
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = d as { v?: unknown; exportedAt?: unknown; funds?: unknown; history?: unknown } | null;
  if (!o || typeof o !== 'object' || o.v !== 1 || !Array.isArray(o.funds)) return null;
  const funds: Backup['funds'] = [];
  for (const f of o.funds as unknown[]) {
    const x = f as { name?: unknown; url?: unknown } | null;
    if (!x || typeof x.url !== 'string' || !isFundUrl(x.url) || funds.some((y) => y.url === x.url)) continue;
    funds.push({ name: typeof x.name === 'string' ? x.name.slice(0, MAX_NAME) : '', url: x.url });
  }
  const rawH =
    o.history && typeof o.history === 'object' && !Array.isArray(o.history) ? (o.history as Record<string, unknown>) : {};
  const history: Record<string, HistoryAccounts> = {};
  for (const { url } of funds) {
    const acc = parseAccounts(rawH[url]);
    if (Object.keys(acc).length) history[url] = acc;
  }
  return { v: 1, exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : 0, funds, history };
}

/** 복원 = 합치기(멱등). 로컬에 없는 URL 만 새 id 로 추가(한도 초과는 건너뜀), 기록은 recordedAt 늦은 쪽. */
export function mergeBackup(local: LocalData, backup: Backup, newId: () => string): MergeResult {
  const funds = [...local.funds];
  let addedFunds = 0;
  let skippedFunds = 0;
  for (const f of backup.funds) {
    if (funds.some((x) => x.url === f.url)) continue;
    if (funds.length >= MAX_FUNDS) {
      skippedFunds++;
      continue;
    }
    funds.push({ id: newId(), name: f.name, url: f.url });
    addedFunds++;
  }
  const histories = { ...local.histories };
  let mergedPoints = 0;
  for (const { url } of funds) {
    const extra = backup.history[url];
    if (!extra) continue;
    const r = mergeAccounts(histories[url] ?? {}, extra);
    histories[url] = r.accounts;
    mergedPoints += r.changed;
  }
  return { funds, histories, addedFunds, skippedFunds, mergedPoints };
}

/** 기기 로컬 날짜 키(자동 백업 하루 1번 판단용) */
export const localDayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export const shouldAutoBackup = (lastBackupAt: number | null, now: number): boolean =>
  lastBackupAt === null || localDayKey(lastBackupAt) !== localDayKey(now);
```

`core/index.ts` 에 `export * from './backup';` 추가(history 아래).

- [ ] **Step 4: 통과 확인** — `cd mobile && npx jest src/features/fund` → PASS
- [ ] **Step 5: 웹 동기화·검사** — Task 1 Step 5 와 같은 명령, Expected 동일
- [ ] **Step 6: 커밋**

```bash
git add mobile/src/features/fund/core web_client/src/lib/fundCore
git commit -m "feat(fund): 백업 core — Drive 합본·검증·복원 합치기·자동 백업 판단"
```

---

### Task 3: `core/history-view.ts` (화면 모델)

**Files:**
- Create: `mobile/src/features/fund/core/history-view.ts`
- Test: `mobile/src/features/fund/core/history-view.test.ts`
- Modify: `mobile/src/features/fund/core/index.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
import type { FundHistory, HistoryPoint } from './history';
import { toHistoryView } from './history-view';

const p = (date: string, value: number | null, day: number | null = 0, month: number | null = 0): HistoryPoint => ({
  date, value, day, month, recordedAt: 1,
});
const h = (accounts: FundHistory['accounts']): FundHistory => ({ v: 1, url: 'u', accounts });

describe('toHistoryView', () => {
  it('계좌 목록·선택 — 없는 계좌면 첫 계좌', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', 1)], B: [] }), 'Z', 'all');
    expect(v.accounts).toEqual(['A', 'B']);
    expect(v.account).toBe('A');
  });

  it('목록은 최신이 위, B안 포맷(쉼표·원·부호·색)', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', 1000, 0, 5), p('2026-10-02', 12345000, -15000, 410000)] }), 'A', 'all');
    expect(v.rows[0].date).toBe('2026.10.02');
    expect(v.rows[0].value).toMatchObject({ text: '12,345,000', unit: '원', tone: '' });
    expect(v.rows[0].day).toMatchObject({ text: '−15,000', unit: '원', tone: 'down' });
    expect(v.rows[0].month).toMatchObject({ text: '+410,000', tone: 'up' });
    expect(v.rows[1].day).toMatchObject({ text: '0', tone: 'zero' });
    expect(v.total).toBe(2);
  });

  it('값이 없으면 대시', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', null, null, null)] }), 'A', 'all');
    expect(v.rows[0].value.text).toBe('—');
    expect(v.chart).toBeNull();
  });

  it('기간은 마지막 기록 날짜 기준(문자열 비교)', () => {
    const pts = [p('2026-06-01', 1), p('2026-08-15', 2), p('2026-09-20', 3), p('2026-10-19', 4)];
    expect(toHistoryView(h({ A: pts }), 'A', '1m').rows.map((r) => r.date)).toEqual(['2026.10.19', '2026.09.20']);
    expect(toHistoryView(h({ A: pts }), 'A', '3m').rows).toHaveLength(3);
    expect(toHistoryView(h({ A: pts }), 'A', 'all').rows).toHaveLength(4);
  });

  it('차트 — 2건 이상일 때 0..1 좌표, 최고·최저·시작·끝', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', 100), p('2026-10-02', 300), p('2026-10-03', 200)] }), 'A', 'all');
    expect(v.chart?.points).toEqual([[0, 0], [0.5, 1], [1, 0.5]]);
    expect(v.chart?.max.text).toBe('300');
    expect(v.chart?.min.text).toBe('100');
    expect(v.chart?.start).toBe('2026.10.01');
    expect(v.chart?.end).toBe('2026.10.03');
  });

  it('값이 모두 같으면 가운데 선', () => {
    const v = toHistoryView(h({ A: [p('2026-10-01', 5), p('2026-10-02', 5)] }), 'A', 'all');
    expect(v.chart?.points).toEqual([[0, 0.5], [1, 0.5]]);
  });

  it('기록이 없으면 빈 화면 모델', () => {
    expect(toHistoryView(h({}), '', '3m')).toMatchObject({ accounts: [], account: '', rows: [], chart: null, total: 0 });
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd mobile && npx jest src/features/fund/core/history-view` → FAIL

- [ ] **Step 3: 구현** — `core/history-view.ts`

```ts
// 히스토리 화면 모델 — 기간 필터·차트 좌표·표시 포맷(B안 규칙, formatValue)을 여기서 끝내고 페이지는 그리기만.
// 기간은 마지막 기록 날짜 기준 문자열 비교(Date.now 에 기대지 않아 결정적).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import type { FundHistory, HistoryPoint } from './history';
import { formatValue, type ViewCell } from './view';

export type HistoryRange = '1m' | '3m' | 'all';
export type HistoryRowView = { date: string; value: ViewCell; day: ViewCell; month: ViewCell };
export type HistoryChartView = { points: [number, number][]; min: ViewCell; max: ViewCell; start: string; end: string };
export type HistoryView = {
  accounts: string[];
  account: string;
  range: HistoryRange;
  chart: HistoryChartView | null; // 값 있는 기록 2건 미만이면 null
  rows: HistoryRowView[]; // 최신이 위
  total: number; // 선택 계좌의 전체 기록 수(기간 무관)
};

const RANGE_DAYS: Record<HistoryRange, number | null> = { '1m': 31, '3m': 92, all: null };
const DAY_MS = 86_400_000;

const dot = (iso: string) => iso.replace(/-/g, '.');
const cell = (label: string, n: number | null): ViewCell =>
  n === null ? { text: '—', unit: '', tone: '', raw: '' } : formatValue(label, String(n));

/** 'YYYY-MM-DD' 에서 days 일 전 날짜(UTC 성분끼리 계산 — 시간대 영향 없음) */
function daysBefore(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * DAY_MS).toISOString().slice(0, 10);
}

function chartOf(pts: HistoryPoint[]): HistoryChartView | null {
  const vs = pts.filter((p): p is HistoryPoint & { value: number } => p.value !== null);
  if (vs.length < 2) return null;
  const values = vs.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const last = vs.length - 1;
  return {
    points: vs.map((p, i): [number, number] => [i / last, span === 0 ? 0.5 : (p.value - min) / span]), // 가로 = 기록 순번
    min: cell('현재평가금', min),
    max: cell('현재평가금', max),
    start: dot(vs[0].date),
    end: dot(vs[last].date),
  };
}

export function toHistoryView(h: FundHistory, account: string, range: HistoryRange): HistoryView {
  const accounts = Object.keys(h.accounts);
  const name = accounts.includes(account) ? account : (accounts[0] ?? '');
  const all = h.accounts[name] ?? [];
  const days = RANGE_DAYS[range];
  const from = days === null || all.length === 0 ? '' : daysBefore(all[all.length - 1].date, days);
  const pts = from ? all.filter((p) => p.date >= from) : all;
  return {
    accounts,
    account: name,
    range,
    chart: chartOf(pts),
    rows: pts
      .slice()
      .reverse()
      .map((p) => ({
        date: dot(p.date),
        value: cell('현재평가금', p.value),
        day: cell('당일 손익금', p.day),
        month: cell('월 손익금', p.month),
      })),
    total: all.length,
  };
}
```

`core/index.ts` 에 `export * from './history-view';` 추가.

- [ ] **Step 4: 통과 확인** — `cd mobile && npx jest src/features/fund` → PASS
  (`1m`: 2026-10-19 기준 31일 전 = 2026-09-18 → 09-20·10-19 두 건. `3m`: 92일 전 = 2026-07-19 → 08-15 포함 3건)
- [ ] **Step 5: 웹 동기화·검사** — Task 1 Step 5 와 같은 명령
- [ ] **Step 6: 커밋**

```bash
git add mobile/src/features/fund/core web_client/src/lib/fundCore
git commit -m "feat(fund): 히스토리 화면 모델 — 기간 필터·차트 좌표·B안 포맷"
```

---

### Task 4: 앱 히스토리 저장 + 기록 연결 + 삭제 정리

**Files:**
- Create: `mobile/src/features/fund/history-store.ts`
- Modify: `mobile/src/app/fund/[id].tsx`, `mobile/src/app/fund/index.tsx`

- [ ] **Step 1: `history-store.ts` 작성** (로직은 core — 여기선 파일 I/O 만)

```ts
// 펀드 히스토리 저장 = 앱 문서 폴더의 펀드별 JSON 파일(fund-history-<id>.json). 병합·검증은 core/history.
import { File, Paths } from 'expo-file-system';

import {
  emptyHistory,
  mergePoint,
  parseHistory,
  snapshotOf,
  type FundEntry,
  type FundHistory,
  type FundReport,
  type HistoryAccounts,
} from './core';

const historyFile = (id: string): File => new File(Paths.document, `fund-history-${id}.json`);

/** 읽기 실패는 던진다 — 기록·백업이 빈 값으로 덮어쓰지 않도록. 깨진 내용은 core 가 비운다. */
async function readHistory(f: FundEntry): Promise<FundHistory> {
  const file = historyFile(f.id);
  return parseHistory(file.exists ? await file.text() : null, f.url);
}

/** 화면용 — 실패하면 빈 기록 */
export async function loadHistory(f: FundEntry): Promise<FundHistory> {
  try {
    return await readHistory(f);
  } catch {
    return emptyHistory(f.url);
  }
}

function writeHistory(id: string, h: FundHistory): void {
  const file = historyFile(id);
  if (!file.exists) file.create();
  file.write(JSON.stringify(h));
}

/** 새로 가져온 리포트를 기록. 새 날짜가 생겼으면 true(자동 백업 신호). 실패는 false — 리포트 표시는 막지 않는다. */
export async function recordSnapshot(f: FundEntry, report: FundReport, recordedAt: number): Promise<boolean> {
  const snap = snapshotOf(report, recordedAt);
  if (!snap) return false;
  try {
    const { history, added } = mergePoint(await readHistory(f), snap);
    writeHistory(f.id, history);
    return added;
  } catch {
    return false;
  }
}

/** 백업·복원용 — url → 기록. 하나라도 못 읽으면 던진다(빈 기록으로 Drive 를 덮지 않도록). */
export async function loadAllHistories(funds: FundEntry[]): Promise<Record<string, HistoryAccounts>> {
  const out: Record<string, HistoryAccounts> = {};
  for (const f of funds) out[f.url] = (await readHistory(f)).accounts;
  return out;
}

/** 복원 결과 쓰기 — funds 의 id 로 각 파일을 쓴다 */
export function writeHistories(funds: FundEntry[], histories: Record<string, HistoryAccounts>): void {
  for (const f of funds) {
    const accounts = histories[f.url];
    if (accounts) writeHistory(f.id, { v: 1, url: f.url, accounts });
  }
}

export function deleteHistory(id: string): void {
  try {
    const file = historyFile(id);
    if (file.exists) file.delete();
  } catch {
    // 지우지 못해도 목록에서 빠졌으니 다시 읽히지 않는다
  }
}
```

- [ ] **Step 2: `[id].tsx` 기록 연결** — react import 를 `import { useEffect, useMemo, useRef, useState } from 'react';` 로, `import { recordSnapshot } from '@/features/fund/history-store';` 추가. `const colors = useMemo(...)` 줄 바로 아래에:

```tsx
  // 새로 가져오기에 성공한 회차만 기록(캐시만 보일 때·실패했을 때는 기록하지 않음). 같은 날짜는 덮어쓴다.
  const recordedAt = useRef(0);
  useEffect(() => {
    if (!fund || !entry || refreshing || error || recordedAt.current === entry.fetchedAt) return;
    recordedAt.current = entry.fetchedAt;
    void recordSnapshot(fund, entry.report, entry.fetchedAt);
  }, [fund, entry, refreshing, error]);
```
(자동 백업 연결은 Task 9 에서 `.then` 으로 붙인다)

- [ ] **Step 3: `fund/index.tsx` 삭제 정리** — `import { deleteHistory } from '@/features/fund/history-store';` 추가. `handleRemove` 의 Alert 문구를:

```tsx
    Alert.alert('펀드 삭제', `${displayName(f)}을(를) 목록에서 지울까요?\n쌓인 기록도 삭제됩니다.`, [
```
로 바꾸고, `deleteCache(f.id);` 아래에 `deleteHistory(f.id);` 추가.

- [ ] **Step 4: 검사**

Run: `cd mobile && npx tsc --noEmit && npx jest src/features/fund && npx eslint src/features/fund/history-store.ts "src/app/fund/[id].tsx" src/app/fund/index.tsx`
Expected: tsc 오류 없음, 테스트 PASS, 새 eslint 오류 없음(`react-hooks/*` 경고는 허용)

- [ ] **Step 5: 커밋**

```bash
git add mobile/src/features/fund/history-store.ts "mobile/src/app/fund/[id].tsx" mobile/src/app/fund/index.tsx
git commit -m "feat(fund): 리포트를 새로 가져올 때 계좌별 기록 저장 + 펀드 삭제 시 기록 정리"
```

---

### Task 5: 히스토리 화면 (WebView 페이지 + 화면 + 라우트 + 진입 아이콘)

**Files:**
- Modify: `mobile/src/features/fund/report-web/report-page.ts` (CSS export 한 줄)
- Create: `mobile/src/features/fund/history-web/history-page.ts`, `history-page.test.ts`
- Create: `mobile/src/features/fund/components/history-view.tsx`
- Create: `mobile/src/app/fund/history/[id].tsx`
- Modify: `mobile/src/app/_layout.tsx`, `mobile/src/app/fund/[id].tsx`

- [ ] **Step 1: 실패하는 페이지 테스트** — `history-web/history-page.test.ts`

```ts
import type { ReportColors } from '../report-web/report-page';
import { HISTORY_HTML, toHistoryScript } from './history-page';

describe('history-page', () => {
  it('렌더 진입점·준비 신호가 있고 템플릿 치환 흔적·innerHTML 이 없다', () => {
    expect(HISTORY_HTML).toContain('window.__history = function');
    expect(HISTORY_HTML).toContain('id="app"');
    expect(HISTORY_HTML).toContain("post({ type: 'ready' })");
    expect(HISTORY_HTML).not.toContain('${');
    expect(HISTORY_HTML).not.toContain('`');
    expect(HISTORY_HTML).not.toContain('innerHTML');
  });

  it('화면 모델만 그린다 — 포맷 로직 없음', () => {
    expect(HISTORY_HTML).toContain('render(msg.view)');
    expect(HISTORY_HTML).not.toContain('toLocaleString');
    expect(HISTORY_HTML).not.toContain('Intl.');
  });

  it('리포트와 같은 스타일 토큰을 쓴다', () => {
    expect(HISTORY_HTML).toContain('--accent');
    expect(HISTORY_HTML).toContain('.row {');
  });

  it('주입 스크립트는 JSON 그대로 전달하고 true 로 끝난다', () => {
    const s = toHistoryScript({
      type: 'render',
      view: { accounts: [], account: '', range: 'all', chart: null, rows: [], total: 0 },
      colors: {} as ReportColors,
    });
    expect(s.startsWith('window.__history&&window.__history({"type":"render","view":{')).toBe(true);
    expect(s.endsWith(');true;')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd mobile && npx jest src/features/fund/history-web` → FAIL

- [ ] **Step 3: `report-page.ts` 에 CSS export** — `const CSS = \`...\`;` 정의가 끝난 바로 다음 줄에:

```ts
/** 히스토리 페이지가 같은 토큰·줄 스타일을 쓴다 */
export const REPORT_CSS = CSS;
```

- [ ] **Step 4: `history-web/history-page.ts` 작성**

```ts
// 펀드 히스토리 WebView 페이지 — 차트(inline SVG) + 날짜별 목록. 리포트 페이지와 같은 방식:
// RN 이 window.__history({type:'render', view, colors}) 로 화면 모델(core toHistoryView)을 넣고, 페이지는 {type:'ready'} 만 보낸다.
// 포맷·기간 필터는 core 에서 끝났다 — 여기선 그리기만. 값은 textContent 로만 넣는다.
import type { HistoryView } from '../core';
import { REPORT_CSS, type ReportColors } from '../report-web/report-page';

export type HistoryMessage = { type: 'render'; view: HistoryView; colors: ReportColors };
export type HistoryPageMessage = { type: 'ready' };

export const toHistoryScript = (msg: HistoryMessage): string =>
  `window.__history&&window.__history(${JSON.stringify(msg)});true;`;

const CSS = `
.chart { display:block; width:100%; height:150px; margin:8px 0; }
.chart polyline { fill:none; stroke:var(--accent); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; vector-effect:non-scaling-stroke; }
.edge { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; color:var(--text-2); }
.edge .num { font-weight:600; color:var(--text); }
.axis { display:flex; justify-content:space-between; font-size:12px; color:var(--text-2); }
.hrow { padding:9px 0; border-top:1px solid var(--line); }
.hrow .line { display:flex; justify-content:space-between; align-items:baseline; gap:16px; }
.hrow .k { color:var(--text-2); font-size:14px; }
.hrow .v { font-weight:600; white-space:pre; }
.hrow .sub { margin-top:2px; text-align:right; font-size:13px; white-space:nowrap; }
.empty { text-align:center; color:var(--text-2); padding:48px 0; }
`;

// 페이지 스크립트(ES2017) — 백틱 금지(바깥 String.raw 가 끝난다).
const PAGE_SCRIPT = String.raw`
(function () {
  var app = document.getElementById('app');
  var NS = 'http://www.w3.org/2000/svg';

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
  function val(c, cls, tag) {
    return h(tag || 'span', ['num', c.tone, cls].filter(Boolean).join(' '), [c.text, c.unit ? h('span', 'unit', [c.unit]) : null]);
  }

  function chart(c) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('viewBox', '0 0 100 40');
    svg.setAttribute('preserveAspectRatio', 'none');
    var line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', c.points.map(function (p) { return (p[0] * 100) + ',' + ((1 - p[1]) * 36 + 2); }).join(' '));
    svg.appendChild(line);
    return h('div', 'card', [
      h('div', 'edge', [h('span', '', ['최고']), val(c.max)]),
      svg,
      h('div', 'edge', [h('span', '', ['최저']), val(c.min)]),
      h('div', 'axis', [h('span', 'num', [c.start]), h('span', 'num', [c.end])])
    ]);
  }

  function row(r) {
    return h('div', 'hrow', [
      h('div', 'line', [h('div', 'k num', [r.date]), val(r.value, 'v', 'div')]),
      h('div', 'sub', [h('span', 'muted', ['당일 ']), val(r.day), h('span', 'muted', [' · 월 ']), val(r.month)])
    ]);
  }

  function render(v) {
    app.textContent = '';
    if (!v.total) {
      app.appendChild(h('p', 'empty', ['리포트를 열 때마다 하루 한 건씩 기록돼요']));
      return;
    }
    app.appendChild(v.chart ? chart(v.chart) : h('div', 'card muted', ['기록이 쌓이면 그래프가 보여요']));
    app.appendChild(h('div', 'card', [h('div', 'kv', v.rows.map(row))]));
  }

  function applyColors(c) {
    var st = document.documentElement.style;
    Object.keys(c || {}).forEach(function (k) { st.setProperty('--' + k, c[k]); });
  }

  window.__history = function (msg) {
    if (msg && msg.type === 'render') { applyColors(msg.colors); render(msg.view); }
  };
  post({ type: 'ready' });
})();
`;

export const HISTORY_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>${REPORT_CSS}${CSS}</style></head><body><main class="wrap" id="app"></main>
<script>${PAGE_SCRIPT}</script></body></html>`;
```
(REPORT_CSS 의 `.kv > :first-child { border-top:0; padding-top:0; }` 가 `.hrow` 첫 줄에도 적용돼 첫 줄 위 선이 빠진다)

- [ ] **Step 5: 테스트 통과 확인** — `cd mobile && npx jest src/features/fund` → PASS

- [ ] **Step 6: `components/history-view.tsx` 작성**

```tsx
import { useEffect, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { HistoryView as HistoryViewModel } from '../core';
import { HISTORY_HTML, toHistoryScript, type HistoryPageMessage } from '../history-web/history-page';
import type { ReportColors } from '../report-web/report-page';

const SOURCE = { html: HISTORY_HTML }; // 모듈 상수 — 렌더마다 새 객체면 다시 로드된다

/** 히스토리 페이지(WebView). 준비 신호 뒤 화면 모델을 넣고, 바뀔 때마다 다시 넣는다. */
export function HistoryView({ view, colors }: { view: HistoryViewModel; colors: ReportColors }) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ view, colors });
  latest.current = { view, colors };

  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(toHistoryScript({ type: 'render', view, colors }));
  }, [ready, view, colors]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: HistoryPageMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data) as HistoryPageMessage;
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      setReady(true);
      ref.current?.injectJavaScript(toHistoryScript({ type: 'render', ...latest.current })); // 페이지 재로드 대비
    }
  };

  return (
    <WebView
      ref={ref}
      source={SOURCE}
      originWhitelist={['*']}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:')}
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

- [ ] **Step 7: 화면 `app/fund/history/[id].tsx` 작성**

```tsx
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { HistoryView } from '@/features/fund/components/history-view';
import { toHistoryView, type FundHistory, type HistoryRange } from '@/features/fund/core';
import { loadFunds } from '@/features/fund/fund-store';
import { loadHistory } from '@/features/fund/history-store';
import { reportColors } from '@/features/fund/report-colors';
import { Chip, ListState } from '@/ui';

const RANGES: [HistoryRange, string][] = [
  ['1m', '1개월'],
  ['3m', '3개월'],
  ['all', '전체'],
];

// 펀드 수익 히스토리 — 기기에 쌓인 계좌별 기록(차트 + 날짜별 목록). 계좌·기간 선택은 네이티브 칩.
export default function FundHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme } = useUnistyles();
  const user = useAuthStore((s) => s.user);
  const [history, setHistory] = useState<FundHistory | null | undefined>(undefined); // undefined=읽는 중, null=펀드 없음
  const [account, setAccount] = useState('');
  const [range, setRange] = useState<HistoryRange>('3m');

  useEffect(() => {
    let alive = true;
    loadFunds()
      .then(async (l) => {
        const f = l.find((x) => x.id === id);
        const h = f ? await loadHistory(f) : null;
        if (alive) setHistory(h);
      })
      .catch(() => {
        if (alive) setHistory(null);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const view = useMemo(() => (history ? toHistoryView(history, account, range) : null), [history, account, range]);
  const colors = useMemo(() => reportColors(theme.colors), [theme.colors]);

  if (!user) return <Redirect href="/profile" />;
  if (history === undefined) {
    return (
      <View style={styles.flex}>
        <ListState mode="loading" />
      </View>
    );
  }
  if (!view) {
    return (
      <View style={styles.flex}>
        <ListState mode="empty" emoji="🔍" title="펀드를 찾을 수 없어요" hint="목록에서 다시 선택해 주세요." />
      </View>
    );
  }
  return (
    <View style={styles.flex}>
      <View style={styles.bar}>
        {view.accounts.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {view.accounts.map((a) => (
              <Chip key={a} label={a} selected={a === view.account} onPress={() => setAccount(a)} />
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.chips}>
          {RANGES.map(([r, label]) => (
            <Chip key={r} label={label} selected={r === range} onPress={() => setRange(r)} />
          ))}
        </View>
      </View>
      <HistoryView view={view} colors={colors} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  bar: { paddingHorizontal: theme.gap(2), paddingTop: theme.gap(1.5), gap: theme.gap(1) },
  chips: { flexDirection: 'row', gap: theme.gap(1) },
}));
```

- [ ] **Step 8: 라우트 등록** — `app/_layout.tsx` 의 `fund/[id]` 줄 아래에:

```tsx
        <Stack.Screen name="fund/history/[id]" options={{ headerShown: true, title: '수익 히스토리' }} />
```

- [ ] **Step 9: 리포트 헤더에 히스토리 아이콘** — `app/fund/[id].tsx`: expo-router import 에 `useRouter` 추가, 컴포넌트 첫 줄들에 `const router = useRouter();`. `headerRight` 를 아래로 교체:

```tsx
        headerRight: () => (
          <View style={styles.headerActions}>
            {fund ? (
              <Pressable
                onPress={() => router.push(`/fund/history/${fund.id}`)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="수익 히스토리"
              >
                <Ionicons name="stats-chart-outline" size={20} color={theme.colors.text} />
              </Pressable>
            ) : null}
            {refreshing ? (
              <ActivityIndicator />
            ) : (
              <Pressable onPress={refresh} hitSlop={8} accessibilityRole="button" accessibilityLabel="새로고침">
                <Ionicons name="refresh" size={20} color={theme.colors.text} />
              </Pressable>
            )}
          </View>
        ),
```
styles 에 `headerActions: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(2) },` 추가.
typedRoutes 가 새 경로를 몰라 `tsc` 가 href 타입 오류를 내면 `cd mobile && npx expo start --port 8082` 를 잠깐 띄워 `.expo/types` 를 갱신한 뒤 종료한다(포트 8082 고정 — 8081 은 다른 프로젝트).

- [ ] **Step 10: 검사**

Run: `cd mobile && npx tsc --noEmit && npx jest src/features/fund && npx eslint src/features/fund/history-web src/features/fund/components/history-view.tsx "src/app/fund/history/[id].tsx" "src/app/fund/[id].tsx" src/app/_layout.tsx`
Expected: 오류 없음, PASS

- [ ] **Step 11: 커밋**

```bash
git add mobile/src/features/fund/report-web/report-page.ts mobile/src/features/fund/history-web mobile/src/features/fund/components/history-view.tsx mobile/src/app/fund/history "mobile/src/app/fund/[id].tsx" mobile/src/app/_layout.tsx
git commit -m "feat(fund): 수익 히스토리 화면 — 현재평가금 차트 + 날짜별 목록(WebView)"
```

---

### Task 6: `drive-backup.ts` (Drive REST)

> Task 7 의 google-auth 가 `driveError` 를 쓰므로 이 작업을 먼저 한다. 이 파일은 google-auth 를 **import 하지 않는다**(jest 에서 네이티브 모듈이 로드되지 않도록 토큰은 주입).

**Files:**
- Create: `mobile/src/features/fund/drive-backup.ts`
- Test: `mobile/src/features/fund/drive-backup.test.ts`

- [ ] **Step 1: 실패하는 테스트**

```ts
import { BACKUP_FILE } from './core';
import { downloadBackup, findBackupId, isDriveError, uploadBackup, type DriveDeps } from './drive-backup';

type Call = { url: string; init: RequestInit };
type Fake = { status: number; body: string };

const res = (f: Fake) =>
  ({
    ok: f.status >= 200 && f.status < 300,
    status: f.status,
    json: async () => JSON.parse(f.body),
    text: async () => f.body,
  }) as unknown as Response;
const json = (o: unknown, status = 200): Fake => ({ status, body: JSON.stringify(o) });

function mockDrive(routes: Record<string, Fake>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return res(routes[key]);
  }) as unknown as typeof fetch;
  const deps: DriveDeps = { getAccessToken: async () => 'TOKEN', fetchImpl };
  return { calls, deps };
}
const LIST = 'https://www.googleapis.com/drive/v3/files?';

describe('drive-backup', () => {
  it('찾기 — appDataFolder, q 인코딩, fields 지정, Bearer 토큰', async () => {
    const { calls, deps } = mockDrive({ [LIST]: json({ files: [{ id: 'F1' }] }) });
    expect(await findBackupId(deps)).toBe('F1');
    expect(calls[0].url).toContain('spaces=appDataFolder');
    expect(calls[0].url).toContain(`q=${encodeURIComponent(`name='${BACKUP_FILE}' and trashed=false`)}`);
    expect(calls[0].url).toContain(`fields=${encodeURIComponent('files(id)')}`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
  });

  it('받기 — 파일 없으면 null, 있으면 alt=media 본문', async () => {
    expect(await downloadBackup(mockDrive({ [LIST]: json({ files: [] }) }).deps)).toBeNull();
    const { calls, deps } = mockDrive({
      [LIST]: json({ files: [{ id: 'F1' }] }),
      'https://www.googleapis.com/drive/v3/files/F1?alt=media': { status: 200, body: '{"v":1}' },
    });
    expect(await downloadBackup(deps)).toBe('{"v":1}');
    expect(calls[1].url).toBe('https://www.googleapis.com/drive/v3/files/F1?alt=media');
  });

  it('올리기(새 파일) — POST multipart/related, parents=appDataFolder', async () => {
    const { calls, deps } = mockDrive({
      [LIST]: json({ files: [] }),
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart': json({ id: 'NEW' }),
    });
    await uploadBackup(deps, '{"v":1}');
    const up = calls[1];
    expect(up.init.method).toBe('POST');
    expect((up.init.headers as Record<string, string>)['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    const body = String(up.init.body);
    expect(body).toContain(JSON.stringify({ name: BACKUP_FILE, parents: ['appDataFolder'] }));
    expect(body).toContain('{"v":1}');
  });

  it('올리기(기존 파일) — PATCH, parents 없음', async () => {
    const { calls, deps } = mockDrive({
      [LIST]: json({ files: [{ id: 'F1' }] }),
      'https://www.googleapis.com/upload/drive/v3/files/F1?uploadType=multipart': json({ id: 'F1' }),
    });
    await uploadBackup(deps, '{"v":1}');
    expect(calls[1].init.method).toBe('PATCH');
    expect(String(calls[1].init.body)).not.toContain('parents');
  });

  it('401/403 은 auth, 그 외 실패·네트워크는 network', async () => {
    const e401 = await findBackupId(mockDrive({ [LIST]: json({}, 401) }).deps).catch((e: unknown) => e);
    expect(isDriveError(e401, 'auth')).toBe(true);
    const e500 = await findBackupId(mockDrive({ [LIST]: json({}, 500) }).deps).catch((e: unknown) => e);
    expect(isDriveError(e500, 'network')).toBe(true);
    const deps: DriveDeps = {
      getAccessToken: async () => 'T',
      fetchImpl: (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch,
    };
    expect(isDriveError(await findBackupId(deps).catch((e: unknown) => e), 'network')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd mobile && npx jest src/features/fund/drive-backup` → FAIL

- [ ] **Step 3: 구현** — `drive-backup.ts`

```ts
// Google Drive REST(앱 전용 폴더 appDataFolder) — 백업 파일 하나를 찾고·받고·올린다. 서버 경유 없음.
// 토큰·fetch 는 주입(테스트에서 네이티브 로그인 모듈을 불러오지 않도록 google-auth 를 import 하지 않는다).
import { BACKUP_FILE } from './core';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
// JSON.stringify 결과엔 줄바꿈이 없어 본문에 "\r\n--경계" 가 생길 수 없다
const BOUNDARY = 'fund_backup_part';

export type DriveErrorCode = 'auth' | 'network';
export type DriveError = Error & { driveCode: DriveErrorCode };

export const driveError = (code: DriveErrorCode, message: string): DriveError =>
  Object.assign(new Error(message), { driveCode: code });

export function isDriveError(e: unknown, code?: DriveErrorCode): e is DriveError {
  return e instanceof Error && 'driveCode' in e && (code === undefined || (e as DriveError).driveCode === code);
}

export type DriveDeps = { getAccessToken: () => Promise<string>; fetchImpl?: typeof fetch };

async function call(deps: DriveDeps, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await deps.getAccessToken();
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(url, {
      ...init,
      headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw driveError('network', 'Drive 에 연결하지 못했어요');
  }
  if (res.status === 401 || res.status === 403) throw driveError('auth', `Drive 권한 오류 ${res.status}`);
  if (!res.ok) throw driveError('network', `Drive 응답 ${res.status}`);
  return res;
}

export async function findBackupId(deps: DriveDeps): Promise<string | null> {
  const q = encodeURIComponent(`name='${BACKUP_FILE}' and trashed=false`);
  const fields = encodeURIComponent('files(id)');
  const res = await call(deps, `${FILES}?spaces=appDataFolder&q=${q}&fields=${fields}&pageSize=1`);
  const d = (await res.json()) as { files?: { id?: string }[] };
  return d.files?.[0]?.id ?? null;
}

/** 백업 본문(문자열). 파일이 없으면 null. */
export async function downloadBackup(deps: DriveDeps): Promise<string | null> {
  const id = await findBackupId(deps);
  if (!id) return null;
  const res = await call(deps, `${FILES}/${encodeURIComponent(id)}?alt=media`);
  return res.text();
}

const multipart = (meta: object, body: string): string =>
  [
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(meta),
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    body,
    `--${BOUNDARY}--`,
    '',
  ].join('\r\n');

/** 있으면 갱신(PATCH), 없으면 appDataFolder 에 생성(POST). parents 를 빠뜨리면 사용자 내 드라이브에 보이게 생긴다. */
export async function uploadBackup(deps: DriveDeps, json: string): Promise<void> {
  const id = await findBackupId(deps);
  const headers = { 'Content-Type': `multipart/related; boundary=${BOUNDARY}` };
  if (id) {
    await call(deps, `${UPLOAD}/${encodeURIComponent(id)}?uploadType=multipart`, {
      method: 'PATCH',
      headers,
      body: multipart({}, json),
    });
  } else {
    await call(deps, `${UPLOAD}?uploadType=multipart`, {
      method: 'POST',
      headers,
      body: multipart({ name: BACKUP_FILE, parents: ['appDataFolder'] }, json),
    });
  }
}
```

- [ ] **Step 4: 통과 확인** — `cd mobile && npx jest src/features/fund` → PASS
- [ ] **Step 5: 커밋**

```bash
git add mobile/src/features/fund/drive-backup.ts mobile/src/features/fund/drive-backup.test.ts
git commit -m "feat(fund): Google Drive appDataFolder 백업 파일 찾기·받기·올리기"
```

---

### Task 7: Google 로그인 모듈 설치 + `google-auth.ts`

**Files:**
- Modify: `mobile/package.json`·`package-lock.json`(설치), `mobile/app.config.js`(plugin), `mobile/.env.example`
- Create: `mobile/src/features/fund/google-auth.ts`

- [ ] **Step 1: `app.config.js` 편집 가능 여부 먼저 확인** — plugins 배열의 `'expo-secure-store',` 다음 줄에 `'@react-native-google-signin/google-signin',` 을 Edit 로 넣어본다. **설정 보호 훅에 막히면 즉시 멈추고 BLOCKED 로 보고**(사용자가 넣을 한 줄을 제시). 훅 비활성화·우회 금지.

- [ ] **Step 2: 설치**

Run: `cd mobile && npx expo install @react-native-google-signin/google-signin -- --legacy-peer-deps`
(기존 peer 충돌로 `--legacy-peer-deps` 필요. 실패하면 `npm i @react-native-google-signin/google-signin --legacy-peer-deps`)
Expected: package.json dependencies 에 추가

- [ ] **Step 3: 설치된 API 확인(기억으로 쓰지 말 것)**

Run:
```bash
cd mobile && P=node_modules/@react-native-google-signin/google-signin
grep -rn "signIn\b\|signInSilently\|getTokens\|revokeAccess\|getCurrentUser\|addScopes\|SignInResponse\|SignInSilentlyResponse" $P/lib/typescript --include=*.d.ts | head -40
cat $P/app.plugin.js; grep -rn "iosUrlScheme" $P/plugin 2>/dev/null | head
```
- `signIn()` 이 `{ type: 'success', data } | { type: 'cancelled' }`(v13+) 인지, 예전처럼 User 를 반환하고 취소는 `statusCodes.SIGN_IN_CANCELLED` 로 던지는지 확인하고 Step 4 를 그 형태로 맞춘다(의미는 같게: 취소 → `null`).
- plugin 이 iOS 옵션 없이 `expo config` 에서 오류를 내면 Step 1 의 항목을 `['@react-native-google-signin/google-signin', { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.unset' }]` 로 바꾸고 주석 `// iOS 출시(애플 로그인과 함께) 전에 실제 값으로` 를 단다.

- [ ] **Step 4: `google-auth.ts` 작성** (v13+ 형태 기준)

```ts
// 네이티브 Google 로그인(기기 계정 선택) — Drive 앱 전용 폴더(drive.appdata) 권한만 받는다.
// 토큰은 모듈이 관리하고 호출할 때마다 받아 쓴다(우리 저장소에 토큰을 두지 않는다). dev build 전용.
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { driveError } from './drive-backup';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

/** OAuth 클라이언트 ID 가 빌드에 들어갔는지 — 없으면 백업 화면은 '설정 필요'만 보여준다 */
export const isBackupConfigured = (): boolean => WEB_CLIENT_ID !== '';

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: [DRIVE_SCOPE] });
  configured = true;
}

/** 계정 선택 → drive.appdata 권한 확인. 취소·거절하면 null, 성공하면 이메일. */
export async function connect(): Promise<string | null> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (res.type !== 'success') return null;
  if (!res.data.scopes.includes(DRIVE_SCOPE)) {
    const added = await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
    if (!added) return null;
  }
  return res.data.user.email;
}

/** Drive 호출용 access token. 로그인 정보가 없거나 끊겼으면 DriveError('auth'). */
export async function accessToken(): Promise<string> {
  ensureConfigured();
  try {
    if (!GoogleSignin.getCurrentUser()) {
      const r = await GoogleSignin.signInSilently();
      if (r.type !== 'success') throw new Error('no saved credential');
    }
    return (await GoogleSignin.getTokens()).accessToken;
  } catch {
    throw driveError('auth', 'Google 로그인이 필요해요');
  }
}

/** 연결 해제 — 권한 반납 + 로그아웃. Drive 의 백업 파일은 남는다. */
export async function disconnect(): Promise<void> {
  ensureConfigured();
  try {
    await GoogleSignin.revokeAccess();
  } catch {
    // 이미 끊겼어도 로그아웃은 진행
  }
  await GoogleSignin.signOut();
}
```

- [ ] **Step 5: env 예시** — `mobile/.env.example` 맨 아래에:

```
# 펀드 히스토리 Google Drive 백업 — Google Cloud OAuth "웹 애플리케이션" 클라이언트 ID(공개값). 비우면 백업 기능 숨김.
# 설정 절차: 루트 README '펀드 히스토리 · Google Drive 백업'
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=
```
(`.env.development`/`.env.production` 은 gitignore 대상이고 사용자가 직접 값을 넣는다 — 만들거나 고치지 않는다.)

- [ ] **Step 6: 검사** — `cd mobile && npx tsc --noEmit && npx jest src/features/fund && npx expo config --type public > /dev/null && echo CONFIG_OK`
Expected: 오류 없음, `CONFIG_OK`

- [ ] **Step 7: 커밋**

```bash
git add mobile/package.json mobile/package-lock.json mobile/app.config.js mobile/.env.example mobile/src/features/fund/google-auth.ts
git commit -m "feat(fund): 네이티브 Google 로그인(drive.appdata) 래퍼 + 설정 플러그인"
```

---

### Task 8: 백업 상태 + 백업 서비스

**Files:**
- Create: `mobile/src/features/fund/backup-state.ts`, `mobile/src/features/fund/backup-service.ts`

- [ ] **Step 1: `backup-state.ts`**

```ts
// 백업 상태(SecureStore, 토큰 없음) — 연결 여부·계정 이메일·마지막 성공 시각·마지막 오류 문구.
import * as SecureStore from 'expo-secure-store';

export type BackupState = { connected: boolean; email: string; lastBackupAt: number | null; lastError: string };

const KEY = 'fund_backup_state_v1';
export const INITIAL_BACKUP_STATE: BackupState = { connected: false, email: '', lastBackupAt: null, lastError: '' };

export async function loadBackupState(): Promise<BackupState> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const d = raw ? (JSON.parse(raw) as Partial<BackupState> | null) : null;
    if (!d || typeof d !== 'object') return INITIAL_BACKUP_STATE;
    return {
      connected: d.connected === true,
      email: typeof d.email === 'string' ? d.email : '',
      lastBackupAt: typeof d.lastBackupAt === 'number' ? d.lastBackupAt : null,
      lastError: typeof d.lastError === 'string' ? d.lastError : '',
    };
  } catch {
    return INITIAL_BACKUP_STATE;
  }
}

export async function saveBackupState(patch: Partial<BackupState>): Promise<BackupState> {
  const next = { ...(await loadBackupState()), ...patch };
  await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  return next;
}

export async function resetBackupState(): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(INITIAL_BACKUP_STATE));
}
```

- [ ] **Step 2: `backup-service.ts`**

```ts
// 백업·복원 흐름 — 업로드는 항상 "Drive 받기 → 합치기 → 올리기"(재설치 직후 덮어쓰기 보호).
// 받기가 '파일 없음' 외 이유로 실패하면 올리지 않는다(downloadBackup 이 던지면 업로드 전에 빠져나간다).
import { buildBackup, mergeBackup, newFundId, parseBackup, shouldAutoBackup } from './core';
import { loadBackupState, saveBackupState } from './backup-state';
import { downloadBackup, findBackupId, isDriveError, uploadBackup, type DriveDeps } from './drive-backup';
import { loadFunds, saveFunds } from './fund-store';
import { accessToken, isBackupConfigured } from './google-auth';
import { loadAllHistories, writeHistories } from './history-store';

const deps: DriveDeps = { getAccessToken: accessToken };

/** Drive 오류를 상태에 남기고 다시 던진다(401/403 이면 연결 해제 상태로) */
async function recordFailure(e: unknown): Promise<never> {
  if (isDriveError(e, 'auth')) await saveBackupState({ connected: false, lastError: '다시 연결해 주세요' });
  else if (isDriveError(e, 'network')) await saveBackupState({ lastError: '네트워크 문제로 백업하지 못했어요' });
  throw e;
}

export async function hasRemoteBackup(): Promise<boolean> {
  try {
    return (await findBackupId(deps)) !== null;
  } catch (e) {
    return recordFailure(e);
  }
}

export async function backupNow(now = Date.now()): Promise<void> {
  const funds = await loadFunds();
  const histories = await loadAllHistories(funds); // 못 읽으면 던진다 — 빈 기록으로 올리지 않는다
  try {
    const raw = await downloadBackup(deps);
    const remote = raw === null ? null : parseBackup(raw); // 깨진 Drive 파일은 로컬 내용으로 새로 쓴다
    await uploadBackup(deps, JSON.stringify(buildBackup({ funds, histories }, remote, now)));
  } catch (e) {
    return recordFailure(e);
  }
  await saveBackupState({ lastBackupAt: now, lastError: '' });
}

export type RestoreResult =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; addedFunds: number; skippedFunds: number; mergedPoints: number };

export async function restoreFromDrive(): Promise<RestoreResult> {
  let raw: string | null;
  try {
    raw = await downloadBackup(deps);
  } catch (e) {
    return recordFailure(e);
  }
  if (raw === null) return { status: 'none' };
  const backup = parseBackup(raw);
  if (!backup) return { status: 'invalid' };
  const funds = await loadFunds(); // 목록을 못 읽으면 던진다 — 빈 목록으로 덮지 않도록
  const histories = await loadAllHistories(funds);
  const r = mergeBackup({ funds, histories }, backup, newFundId);
  writeHistories(r.funds, r.histories); // 기록 먼저, 목록은 한 번에 저장
  await saveFunds(r.funds);
  return { status: 'ok', addedFunds: r.addedFunds, skippedFunds: r.skippedFunds, mergedPoints: r.mergedPoints };
}

let running = false;

/** 새 날짜가 기록됐을 때 — 연결돼 있고 오늘(기기 날짜) 아직 안 했으면 백업. 실패는 상태에만 남긴다. */
export async function maybeAutoBackup(now = Date.now()): Promise<void> {
  if (running || !isBackupConfigured()) return;
  running = true;
  try {
    const s = await loadBackupState();
    if (s.connected && shouldAutoBackup(s.lastBackupAt, now)) await backupNow(now);
  } catch {
    // 상태(lastError)에 남았다 — 다음 새 기록 때 다시 시도
  } finally {
    running = false;
  }
}
```

- [ ] **Step 3: 검사** — `cd mobile && npx tsc --noEmit && npx jest src/features/fund && npx eslint src/features/fund/backup-state.ts src/features/fund/backup-service.ts`
Expected: 오류 없음, PASS(jest 는 이 파일들을 import 하지 않는다)

- [ ] **Step 4: 커밋**

```bash
git add mobile/src/features/fund/backup-state.ts mobile/src/features/fund/backup-service.ts
git commit -m "feat(fund): 백업 서비스 — Drive 합본 업로드·합치기 복원·하루 1회 자동 백업"
```

---

### Task 9: 백업 화면 + 자동 백업 연결 + 진입점

**Files:**
- Create: `mobile/src/app/fund/backup.tsx`
- Modify: `mobile/src/app/_layout.tsx`, `mobile/src/app/fund/index.tsx`, `mobile/src/app/fund/[id].tsx`

- [ ] **Step 1: 화면 `app/fund/backup.tsx`**

```tsx
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { backupNow, hasRemoteBackup, restoreFromDrive, type RestoreResult } from '@/features/fund/backup-service';
import { loadBackupState, resetBackupState, saveBackupState, type BackupState } from '@/features/fund/backup-state';
import { formatChecked } from '@/features/fund/core';
import { isDriveError } from '@/features/fund/drive-backup';
import { connect, disconnect, isBackupConfigured } from '@/features/fund/google-auth';
import { Button, Card, ListState } from '@/ui';

type Busy = '' | 'connect' | 'backup' | 'restore' | 'disconnect';

function errorText(e: unknown): string {
  if (isDriveError(e, 'auth')) return 'Google 연결이 끊겼어요. 다시 연결해 주세요.';
  if (isDriveError(e, 'network')) return '연결을 확인하고 다시 시도해 주세요.';
  return '처리하지 못했어요. 다시 시도해 주세요.';
}

function restoreText(r: RestoreResult): string {
  if (r.status === 'none') return '아직 백업이 없어요.';
  if (r.status === 'invalid') return '백업 파일을 읽을 수 없어요.';
  const skipped = r.skippedFunds ? ` (${r.skippedFunds}개는 등록 한도로 건너뛰었어요)` : '';
  return `펀드 ${r.addedFunds}개 추가, 기록 ${r.mergedPoints}건을 합쳤어요.${skipped}`;
}

// 펀드 기록 백업 — 내 Google Drive 의 앱 전용 공간(Drive 목록에 안 보임). 서버를 거치지 않는다.
export default function FundBackupScreen() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<BackupState | null>(null);
  const [busy, setBusy] = useState<Busy>('');
  const [message, setMessage] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadBackupState().then((s) => {
        if (alive) setState(s);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!user) return <Redirect href="/profile" />;
  if (!isBackupConfigured()) {
    return (
      <View style={styles.flex}>
        <ListState
          mode="empty"
          emoji="⚙️"
          title="백업 설정이 필요해요"
          hint="Google OAuth 클라이언트 ID(EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)를 넣고 앱을 다시 빌드해 주세요."
        />
      </View>
    );
  }
  if (!state) {
    return (
      <View style={styles.flex}>
        <ListState mode="loading" />
      </View>
    );
  }

  const run = async (kind: Busy, fn: () => Promise<string>) => {
    setBusy(kind);
    setMessage('');
    try {
      setMessage(await fn());
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setState(await loadBackupState());
      setBusy('');
    }
  };

  const onRestore = () => run('restore', async () => restoreText(await restoreFromDrive()));

  const onConnect = () =>
    run('connect', async () => {
      const email = await connect();
      if (!email) return '';
      await saveBackupState({ connected: true, email, lastError: '' });
      if (await hasRemoteBackup()) {
        Alert.alert('이전 백업이 있어요', 'Drive 에 저장된 기록을 이 기기로 합칠까요?', [
          { text: '나중에', style: 'cancel' },
          { text: '복원', onPress: () => void onRestore() },
        ]);
        return '연결했어요.';
      }
      await backupNow();
      return '연결했어요. 첫 백업을 마쳤어요.';
    });

  const onBackup = () =>
    run('backup', async () => {
      await backupNow();
      return '백업했어요.';
    });

  const onDisconnect = () =>
    Alert.alert('연결 해제', '자동 백업이 멈춰요. Drive 에 저장된 백업은 남아 있어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '해제',
        style: 'destructive',
        onPress: () =>
          void run('disconnect', async () => {
            await disconnect();
            await resetBackupState();
            return '연결을 해제했어요.';
          }),
      },
    ]);

  const disabled = busy !== '';
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.title}>Google Drive 백업</Text>
        <Text style={styles.line}>{state.connected ? state.email : '연결 안 됨'}</Text>
        {state.lastBackupAt ? (
          <Text style={styles.sub}>마지막 백업 {formatChecked(state.lastBackupAt, Date.now())}</Text>
        ) : null}
        {state.lastError ? <Text style={styles.error}>{state.lastError}</Text> : null}
        <Text style={styles.hint}>
          기록은 내 Google Drive 의 앱 전용 공간에 저장돼요. Drive 목록에는 보이지 않고, 새 기록이 생기면 하루 한 번
          자동으로 백업해요.
        </Text>
      </Card>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {state.connected ? (
        <View style={styles.actions}>
          <Button label="지금 백업" onPress={onBackup} loading={busy === 'backup'} disabled={disabled} />
          <Button label="복원" variant="secondary" onPress={onRestore} loading={busy === 'restore'} disabled={disabled} />
          <Button
            label="연결 해제"
            variant="secondary"
            onPress={onDisconnect}
            loading={busy === 'disconnect'}
            disabled={disabled}
          />
        </View>
      ) : (
        <Button label="Google Drive 연결" onPress={onConnect} loading={busy === 'connect'} disabled={disabled} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.gap(2), gap: theme.gap(2) },
  title: { fontSize: 17, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(1) },
  line: { fontSize: 15, color: theme.colors.text },
  sub: { fontSize: 13, color: theme.colors.textSecondary, marginTop: theme.gap(0.5) },
  error: { fontSize: 13, color: theme.colors.up, marginTop: theme.gap(0.5) },
  hint: { fontSize: 13, color: theme.colors.textSecondary, marginTop: theme.gap(1.5), lineHeight: 19 },
  message: { fontSize: 14, color: theme.colors.text, textAlign: 'center' },
  actions: { gap: theme.gap(1) },
}));
```

- [ ] **Step 2: 라우트** — `app/_layout.tsx` 의 `fund/history/[id]` 줄 아래:

```tsx
        <Stack.Screen name="fund/backup" options={{ headerShown: true, title: '기록 백업' }} />
```

- [ ] **Step 3: 목록 화면 진입점** — `app/fund/index.tsx`:
  - import: `import { Ionicons } from '@expo/vector-icons';`, expo-router import 에 `Stack` 추가, `import { isBackupConfigured } from '@/features/fund/google-auth';`
  - `<ScrollView ...>` 바로 안쪽 첫 자식으로:

```tsx
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/fund/backup')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="기록 백업"
            >
              <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.text} />
            </Pressable>
          ),
        }}
      />
```
  - 빈 목록 분기를 아래로 교체:

```tsx
      ) : funds.length === 0 ? (
        <View style={styles.emptyBox}>
          <ListState
            mode="empty"
            emoji="💰"
            title="등록한 펀드가 없어요"
            hint="fund.ivyro.net 에서 받은 내 펀드 현황 주소를 붙여 넣어 주세요."
          />
          {isBackupConfigured() ? (
            <Button label="Google Drive에서 복원" variant="secondary" onPress={() => router.push('/fund/backup')} />
          ) : null}
        </View>
```
  - styles 에 `emptyBox: { gap: theme.gap(1.5) },` 추가.

- [ ] **Step 4: 자동 백업 연결** — `app/fund/[id].tsx`: `import { maybeAutoBackup } from '@/features/fund/backup-service';` 추가, Task 4 기록 effect 의 마지막 줄을:

```tsx
    void recordSnapshot(fund, entry.report, entry.fetchedAt).then((added) => {
      if (added) void maybeAutoBackup(); // 새 날짜가 생긴 날만, 하루 1번
    });
```

- [ ] **Step 5: 검사** — `cd mobile && npx tsc --noEmit && npx jest src/features/fund && npx eslint src/app/fund src/app/_layout.tsx`
(typedRoutes 경로 오류면 Task 5 Step 9 의 방법으로 `.expo/types` 갱신)
Expected: 오류 없음, PASS

- [ ] **Step 6: 커밋**

```bash
git add mobile/src/app/fund mobile/src/app/_layout.tsx
git commit -m "feat(fund): 기록 백업 화면 + 새 기록 시 자동 백업 + 빈 목록 복원 진입점"
```

---

### Task 10: README + 최종 검증

**Files:**
- Modify: `README.md` (기존 '펀드 수익보기' 절 아래)

- [ ] **Step 1: README 에 절 추가**

```markdown
### 펀드 히스토리 · Google Drive 백업 (앱)
- 리포트를 새로 가져올 때마다 계좌별 현재평가금·당일 손익금·월 손익금을 날짜(원본 최종평가일)별로 기기에 저장(`fund-history-<id>.json`). 서버 저장 없음.
- 리포트 헤더의 차트 아이콘 → 수익 히스토리(차트+목록). 펀드 목록 헤더의 구름 아이콘 → 기록 백업.
- 백업은 사용자 본인 Google Drive 의 앱 전용 폴더(`appDataFolder`, Drive 목록에 안 보임)에 `fund-backup-v1.json` 하나. 업로드는 항상 Drive 와 합친 뒤 올리고(재설치 직후 덮어쓰기 보호), 복원도 합치기(멱등). 기기에서 지운 펀드도 Drive 백업에는 남는다.
- **설정(최초 1회, Google Cloud Console)**
  1. 프로젝트 생성 → API 및 서비스 → **Google Drive API** 사용 설정
  2. OAuth 동의 화면: 외부 · 테스트 모드 · 테스트 사용자에 본인 계정 · 범위 `.../auth/drive.appdata`
  3. 사용자 인증 정보 → OAuth 클라이언트 ID
     - **Android** × 2: 패키지 `com.stockapp.dev` / `com.stockapp`, 각 서명 인증서 SHA-1 (`eas credentials` 또는 `keytool -list -v -keystore <파일>`)
     - **웹 애플리케이션** × 1 → 이 ID 를 아래 env 에
  4. `mobile/.env.development`·`.env.production` 에 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<웹 클라이언트 ID>` → **새 dev build** 필요(네이티브 모듈 `@react-native-google-signin/google-signin`)
- ID 가 비어 있으면 히스토리는 그대로 동작하고 백업 화면만 "백업 설정이 필요해요".
```

- [ ] **Step 2: 전체 검증**

Run:
```bash
cd <repo> && bash scripts/check-fund-core-sync.sh
cd mobile && npx tsc --noEmit && npx jest
cd ../web_client && npx tsc -b --noEmit && npm run lint
```
Expected: `fund core: in sync`, mobile 타입·전체 테스트 PASS, web 타입 OK·lint 오류 0(경고 허용)

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs(readme): 펀드 히스토리·Google Drive 백업 사용·설정 방법"
```

- [ ] **Step 4: 수동 확인(사용자, dev build)** — 리포트 열기 → 히스토리에 오늘 1건 → Drive 연결 → 지금 백업 → 앱 삭제·재설치 → 빈 목록의 "Google Drive에서 복원" → 펀드·기록 복원 확인.
