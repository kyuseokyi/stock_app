# 펀드 기록 백업·복원 사용성 보강 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**목표:** 새 폰·재설치 때 버튼 한 번으로 복원하고, 백업하지 않으면 기록이 사라진다는 사실을 알리고, 백업 화면에 Drive 백업 요약을 보여 준다.

**구조:** 판정과 문구는 순수 함수(`backup-risk.ts`, `backup-text.ts`, 코어 `summarizeBackup`)로 빼서 jest로 검사한다. 흐름은 `backup-service.ts`의 `connectAndRestore()` 하나로 모아 화면 세 곳(빈 목록, 백업 화면, 안내 시트)이 같이 쓴다. 서버와 네이티브는 바뀌지 않는다(OTA로 반영).

**기술:** Expo(React Native) + expo-router, react-native-unistyles v3, expo-secure-store, jest. 코어는 웹(`web_client/src/lib/fundCore`)에 복사본이 있다.

**스펙:** `docs/superpowers/specs/2026-11-11-fund-backup-restore-ux-design.md`

**작업 규칙(이 저장소)**
- 모든 커밋 메시지와 주석은 한국어. 커밋 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- `git add -A`/`git add .` 금지. 파일을 하나하나 지정한다. `.serena/`, `.codex/`, `.github/hooks/`, `.claude/`, `docs/deploy/prod-release.md`, web_client 임시 파일(`touch-test.html`, `src/__touchTest.tsx`, `public/__touch-bars.json`)은 커밋하지 않는다.
- 작업 1~4는 dev에서 만든 `feature/fund-backup-restore-ux` 브랜치, 작업 5~9는 dev에서 만든 `ui/fund-backup-restore-ux` 브랜치. 각 묶음이 끝나면 `git merge --no-ff`로 dev에 머지하고 브랜치를 지운다.
- env 파일은 고치지 않는다. 실제 Google 로그인·Drive 호출은 하지 않는다(jest는 모의).

---

## 파일 구조

| 파일 | 할 일 |
|---|---|
| `mobile/src/features/fund/core/backup.ts` (+ 웹 복사본) | `BackupSummary`, `summarizeBackup` 추가 |
| `mobile/src/features/fund/backup-state.ts` | `BackupState.summary` 추가, 읽기 호환 |
| `mobile/src/features/fund/backup-service.ts` | 백업·복원 성공 때 요약 저장, `connectAndRestore()` 추가 |
| `mobile/src/features/fund/backup-risk.ts` (새 파일) | `backupRisk`, `daysSince`, `STALE_DAYS` |
| `mobile/src/features/fund/keys.ts` | `backupNoticeKey` 추가 |
| `mobile/src/features/fund/backup-notice.ts` (새 파일) | 안내 시트 "봤음" 읽기·쓰기·지우기 |
| `mobile/src/features/fund/account-purge.ts`, `mobile/src/features/auth/install-cleanup.ts` | 새 키 정리 |
| `mobile/src/features/fund/backup-text.ts` (새 파일) | 오류·결과·요약·배너 문구 |
| `mobile/src/features/fund/components/backup-risk-banner.tsx` (새 파일) | 목록 배너 |
| `mobile/src/features/fund/components/backup-notice-sheet.tsx` (새 파일) | 한 번 안내 시트 |
| `mobile/src/app/fund/backup.tsx` | 연결 흐름 교체, 요약·경고 문구 |
| `mobile/src/app/fund/index.tsx` | 1탭 복원 버튼, 배너, 안내 시트 |
| `README.md`, `docs/feature-report/app.md` | 문서 갱신 |

---

### 작업 1: 코어 `summarizeBackup`

**파일:**
- 수정: `mobile/src/features/fund/core/backup.ts`
- 테스트: `mobile/src/features/fund/core/backup.test.ts`
- 동기화: `web_client/src/lib/fundCore/backup.ts`(스크립트가 복사)

- [ ] **1단계: 브랜치 만들기**

```bash
git switch dev && git switch -c feature/fund-backup-restore-ux
```

- [ ] **2단계: 실패하는 테스트 작성** — `core/backup.test.ts` 맨 아래에 추가하고, 파일 위쪽 `./backup` import에 `summarizeBackup`을 더한다.

```ts
describe('summarizeBackup', () => {
  const pt = (date: string) => ({ date, value: 1, day: 1, month: 1, recordedAt: 1 });
  const U1 = 'https://fund.ivyro.net/dataroom/om_data/s1.htm';
  const U2 = 'https://fund.ivyro.net/dataroom/om_data/s2.htm';

  it('빈 백업은 0건, 날짜 없음', () => {
    expect(summarizeBackup({ v: 1, exportedAt: 0, funds: [], history: {} })).toEqual({ funds: 0, points: 0, lastDate: null });
  });

  it('모든 펀드·계좌의 기록 수를 더하고 가장 늦은 날짜를 고른다', () => {
    const b = {
      v: 1 as const,
      exportedAt: 0,
      funds: [
        { name: 'A', url: U1 },
        { name: 'B', url: U2 },
      ],
      history: {
        [U1]: { 계좌1: [pt('2026-11-01'), pt('2026-11-03')], 계좌2: [pt('2026-11-02')] },
        [U2]: { 계좌1: [pt('2026-11-10')] },
      },
    };
    expect(summarizeBackup(b)).toEqual({ funds: 2, points: 4, lastDate: '2026-11-10' });
  });

  it('기록 없는 펀드도 펀드 수에는 센다', () => {
    expect(summarizeBackup({ v: 1, exportedAt: 0, funds: [{ name: 'A', url: U1 }], history: {} })).toEqual({
      funds: 1,
      points: 0,
      lastDate: null,
    });
  });
});
```

- [ ] **3단계: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/core/backup`
Expected: FAIL — `summarizeBackup is not a function`(또는 타입 오류)

- [ ] **4단계: 구현** — `core/backup.ts`의 `MergeResult` 타입 아래에 추가.

```ts
/** 백업 화면 요약 — 펀드 수, 모든 계좌 기록 수, 가장 늦은 기록 날짜(YYYY-MM-DD, 없으면 null) */
export type BackupSummary = { funds: number; points: number; lastDate: string | null };

export function summarizeBackup(b: Backup): BackupSummary {
  let points = 0;
  let lastDate: string | null = null;
  for (const accounts of Object.values(b.history)) {
    for (const pts of Object.values(accounts)) {
      points += pts.length;
      for (const p of pts) if (lastDate === null || p.date > lastDate) lastDate = p.date;
    }
  }
  return { funds: b.funds.length, points, lastDate };
}
```

- [ ] **5단계: 통과 확인**

Run: `cd mobile && npx jest src/features/fund/core/backup`
Expected: PASS

- [ ] **6단계: 웹 복사본 동기화와 검사**

```bash
bash scripts/check-fund-core-sync.sh --write && bash scripts/check-fund-core-sync.sh
cd web_client && npx vitest run && npx tsc --noEmit -p .
```
Expected: 동기화 검사 통과, vitest 전부 PASS, tsc 오류 없음

- [ ] **7단계: 커밋**

```bash
git add mobile/src/features/fund/core/backup.ts mobile/src/features/fund/core/backup.test.ts web_client/src/lib/fundCore/backup.ts
git commit -m "feat(fund): 백업 요약 summarizeBackup(펀드 수·기록 수·마지막 날짜)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 2: 백업 상태에 요약 저장 + 백업·복원 때 기록

**파일:**
- 수정: `mobile/src/features/fund/backup-state.ts`
- 수정: `mobile/src/features/fund/backup-service.ts`
- 테스트: `mobile/src/features/fund/backup-service.test.ts`

- [ ] **1단계: 실패하는 테스트 작성** — `backup-service.test.ts`
  - import 줄 `from './backup-state'`에 `parseBackupState`, `resetBackupState`를 더한다.
  - 파일 맨 아래에 추가:

```ts
describe('백업 요약', () => {
  it('옛 상태(요약 없음)·잘못된 요약은 null 로 읽는다', () => {
    expect(parseBackupState(JSON.stringify({ connected: true, email: 'a' })).summary).toBeNull();
    expect(parseBackupState(JSON.stringify({ summary: { funds: 'x', points: 1 } })).summary).toBeNull();
    expect(parseBackupState(JSON.stringify({ summary: { funds: 2, points: 5, lastDate: '2026-11-10' } })).summary).toEqual({
      funds: 2,
      points: 5,
      lastDate: '2026-11-10',
    });
    expect(parseBackupState(JSON.stringify({ summary: { funds: 2, points: 5, lastDate: 3 } })).summary).toEqual({
      funds: 2,
      points: 5,
      lastDate: null,
    });
  });

  it('백업 성공 때 올린 합본의 요약을 저장한다(Drive 에만 있는 펀드 포함)', async () => {
    mockDrive.set('fund-backup-v1-u7.json', backupOf(2));
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    await backupNow(NOW);
    expect((await loadBackupState()).summary).toEqual({ funds: 2, points: 0, lastDate: null });
  });

  it('복원 성공 때 받은 백업의 요약을 저장한다', async () => {
    mockDrive.set('fund-backup-v1-u7.json', backupOf(1, 2, 3));
    await saveFunds([]);
    await restoreFromDrive();
    expect((await loadBackupState()).summary).toEqual({ funds: 3, points: 0, lastDate: null });
  });

  it('연결 해제(reset)하면 요약도 지운다', async () => {
    await saveBackupState({ summary: { funds: 1, points: 1, lastDate: '2026-11-10' } });
    await resetBackupState();
    expect((await loadBackupState()).summary).toBeNull();
  });
});
```

- [ ] **2단계: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/backup-service`
Expected: FAIL — `summary` 가 `undefined`

- [ ] **3단계: `backup-state.ts` 구현** — 파일 위쪽 import와 타입, 초기값, 읽기 함수를 아래처럼 바꾼다.

```ts
import * as SecureStore from 'expo-secure-store';

import type { BackupSummary } from './core';
import { backupStateKey, rememberFundOwner } from './keys';
import { currentOwnerId, currentOwnerIdOrNull } from './owner';

// summary = 마지막으로 Drive 에 올리거나 Drive 에서 받은 합본의 요약(백업 화면 표시용, 옛 상태는 null)
export type BackupState = {
  connected: boolean;
  email: string;
  lastBackupAt: number | null;
  lastError: string;
  summary: BackupSummary | null;
};

// 키 이름은 keys.ts(인증 스토어 비의존) — 기존 import 경로용 재수출
export { backupStateKey, LEGACY_BACKUP_STATE_KEY } from './keys';
export const INITIAL_BACKUP_STATE: BackupState = {
  connected: false,
  email: '',
  lastBackupAt: null,
  lastError: '',
  summary: null,
};

function parseSummary(x: unknown): BackupSummary | null {
  const s = x as { funds?: unknown; points?: unknown; lastDate?: unknown } | null;
  if (!s || typeof s !== 'object') return null;
  if (!Number.isSafeInteger(s.funds) || !Number.isSafeInteger(s.points)) return null;
  return { funds: s.funds as number, points: s.points as number, lastDate: typeof s.lastDate === 'string' ? s.lastDate : null };
}

export function parseBackupState(raw: string | null): BackupState {
  try {
    const d = raw ? (JSON.parse(raw) as (Partial<Omit<BackupState, 'summary'>> & { summary?: unknown }) | null) : null;
    if (!d || typeof d !== 'object') return INITIAL_BACKUP_STATE;
    return {
      connected: d.connected === true,
      email: typeof d.email === 'string' ? d.email : '',
      lastBackupAt: typeof d.lastBackupAt === 'number' ? d.lastBackupAt : null,
      lastError: typeof d.lastError === 'string' ? d.lastError : '',
      summary: parseSummary(d.summary),
    };
  } catch {
    return INITIAL_BACKUP_STATE;
  }
}
```
  `loadBackupState`·`saveBackupState`·`resetBackupState`·`deleteBackupState`는 그대로 둔다(`resetBackupState`는 `INITIAL_BACKUP_STATE`를 쓰므로 요약도 비워진다).

- [ ] **4단계: `backup-service.ts` 구현**
  - 첫 import에 `summarizeBackup`을 더한다: `import { buildBackup, mergeBackup, newFundId, parseBackup, shouldAutoBackup, summarizeBackup } from './core';`
  - `doBackup`의 try 블록과 마지막 저장을 바꾼다.

```ts
  let uploaded: ReturnType<typeof buildBackup>;
  try {
    // 내 파일이 아직 없으면 옛 파일을 합치기 기준으로(옛 백업에만 있는 펀드·기록이 내 파일로 이어지게). 올리기는 항상 내 파일.
    const raw = await downloadMineOrLegacy(deps, uid);
    const remote = raw === null ? null : parseBackup(raw);
    // 파일은 있는데 읽을 수 없으면(깨짐·새 버전) 덮어쓰지 않는다
    if (raw !== null && remote === null) throw driveError('invalid', 'Drive 백업 파일을 읽을 수 없어요');
    uploaded = buildBackup({ funds, histories }, remote, now);
    await uploadBackup(deps, JSON.stringify(uploaded), accountBackupFile(uid));
  } catch (e) {
    return recordFailure(uid, e);
  }
  await saveBackupState({ lastBackupAt: now, lastError: '', summary: summarizeBackup(uploaded) }, uid);
```
  - `doRestore`의 `await saveFunds(r.funds, uid);` 바로 아래에 추가:

```ts
  await saveBackupState({ summary: summarizeBackup(backup) }, uid); // 지금 Drive 에 있는 내용
```

- [ ] **5단계: 통과 확인과 전체 펀드 테스트**

Run: `cd mobile && npx jest src/features/fund src/features/auth && npx tsc --noEmit`
Expected: 전부 PASS, tsc 오류 없음. 다른 테스트가 `toEqual(INITIAL_BACKUP_STATE 모양)`으로 실패하면 기대값에 `summary: null`을 더한다.

- [ ] **6단계: 커밋**

```bash
git add mobile/src/features/fund/backup-state.ts mobile/src/features/fund/backup-service.ts mobile/src/features/fund/backup-service.test.ts
git commit -m "feat(fund): 백업·복원 성공 때 Drive 백업 요약을 상태에 저장

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 3: `connectAndRestore()` — 연결 후 바로 복원

**파일:**
- 수정: `mobile/src/features/fund/backup-service.ts`
- 테스트: `mobile/src/features/fund/backup-service.test.ts`

- [ ] **1단계: 테스트 모의 확장** — `backup-service.test.ts` 위쪽을 바꾼다.

```ts
const mockGoogle = {
  email: 'me@gmail.com' as string | null,
  tokenCalls: 0,
  connectEmail: 'me@gmail.com' as string | null, // connect() 결과(null = 사용자가 취소)
  failUpload: false,
};
jest.mock('./google-auth', () => ({
  isBackupConfigured: () => true,
  connect: async () => mockGoogle.connectEmail,
  accessToken: async () => {
    mockGoogle.tokenCalls++;
    return 'TOKEN';
  },
  currentGoogleEmail: () => mockGoogle.email,
}));
```
  `uploadBackup` 모의의 `await deps.getAccessToken();` 바로 아래에 추가:

```ts
      if (mockGoogle.failUpload) throw actual.driveError('network', '업로드 실패(테스트)');
```
  `beforeEach`에 `mockGoogle.connectEmail = 'me@gmail.com';`, `mockGoogle.failUpload = false;`를 더한다.
  import 줄 `from './backup-service'`에 `connectAndRestore`를 더한다.

- [ ] **2단계: 실패하는 테스트 작성** — 파일 맨 아래에 추가.

```ts
describe('connectAndRestore(연결 → 바로 복원)', () => {
  beforeEach(async () => {
    await resetBackupState(); // 새 폰 = 연결 안 됨
  });

  it('취소하면 아무것도 바꾸지 않는다', async () => {
    mockGoogle.connectEmail = null;
    expect(await connectAndRestore(NOW)).toEqual({ status: 'cancelled' });
    expect((await loadBackupState()).connected).toBe(false);
    expect(mockDriveCalls).toEqual([]);
  });

  it('백업이 있으면 확인 없이 합치고 내 파일로 다시 올린다', async () => {
    mockDrive.set('fund-backup-v1.json', backupOf(1, 2)); // 옛 파일만 있음
    await saveFunds([]);
    expect(await connectAndRestore(NOW)).toEqual({ status: 'restored', addedFunds: 2, skippedFunds: 0, mergedPoints: 0 });
    expect((await loadFunds()).map((f) => f.url)).toEqual([url(1), url(2)]);
    expect(mockDrive.has('fund-backup-v1-u7.json')).toBe(true);
    const s = await loadBackupState();
    expect(s).toMatchObject({ connected: true, email: 'me@gmail.com', lastBackupAt: NOW, lastError: '' });
  });

  it('백업이 없으면 첫 백업만 한다', async () => {
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    expect(await connectAndRestore(NOW)).toEqual({ status: 'fresh' });
    expect(JSON.parse(mockDrive.get('fund-backup-v1-u7.json')!).funds).toHaveLength(1);
  });

  it('Drive 파일을 읽을 수 없으면 연결만 유지하고 올리지 않는다', async () => {
    mockDrive.set('fund-backup-v1-u7.json', '깨진 파일');
    await saveFunds([]);
    expect(await connectAndRestore(NOW)).toEqual({ status: 'invalid' });
    expect(mockDriveCalls.some((c) => c.startsWith('put:'))).toBe(false);
    expect((await loadBackupState()).connected).toBe(true);
  });

  it('복원 뒤 백업이 실패해도 복원 결과를 돌려주고 오류는 상태에 남긴다', async () => {
    mockDrive.set('fund-backup-v1-u7.json', backupOf(1));
    await saveFunds([]);
    mockGoogle.failUpload = true;
    expect(await connectAndRestore(NOW)).toMatchObject({ status: 'restored', addedFunds: 1 });
    expect((await loadBackupState()).lastError).toBe('네트워크 문제로 백업하지 못했어요');
  });

  it('백업이 없는데 첫 백업이 실패하면 오류를 던진다', async () => {
    await saveFunds([{ id: 'a', name: 'A', url: url(1) }]);
    mockGoogle.failUpload = true;
    await expect(connectAndRestore(NOW)).rejects.toThrow('업로드 실패(테스트)');
  });
});
```

- [ ] **3단계: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/backup-service`
Expected: FAIL — `connectAndRestore is not a function`

- [ ] **4단계: 구현** — `backup-service.ts`
  - google-auth import에 `connect`를 더한다: `import { accessToken, connect, currentGoogleEmail, isBackupConfigured } from './google-auth';`
  - `restoreFromDrive` 함수 아래에 추가:

```ts
export type ConnectResult =
  | { status: 'cancelled' }
  | { status: 'fresh' }
  | { status: 'invalid' }
  | { status: 'restored'; addedFunds: number; skippedFunds: number; mergedPoints: number };

/**
 * Google 연결 → Drive 에 백업이 있으면 묻지 않고 바로 합친다(합치기라 기기 기록이 사라지지 않는다 — 2026-11-11 설계).
 * 합친 뒤 내 파일로 다시 올린다(옛 파일에서 복원해도 내 파일이 생긴다). 백업이 없으면 첫 백업.
 * 복원 뒤 백업 실패는 상태(lastError)에만 남기고 복원 결과를 돌려준다. 첫 백업 실패는 던진다.
 */
export async function connectAndRestore(now = Date.now()): Promise<ConnectResult> {
  const uid = currentOwnerId();
  const email = await connect();
  if (!email) return { status: 'cancelled' };
  await saveBackupState({ connected: true, email, lastError: '' }, uid);
  const r: RestoreResult = (await hasRemoteBackup()) ? await restoreFromDrive() : { status: 'none' };
  if (r.status === 'invalid') return { status: 'invalid' };
  if (r.status === 'none') {
    await backupNow(now);
    return { status: 'fresh' };
  }
  await backupNow(now).catch(() => {}); // recordFailure 가 lastError 에 남겼다
  return { status: 'restored', addedFunds: r.addedFunds, skippedFunds: r.skippedFunds, mergedPoints: r.mergedPoints };
}
```

- [ ] **5단계: 통과 확인**

Run: `cd mobile && npx jest src/features/fund && npx tsc --noEmit`
Expected: PASS, tsc 오류 없음

- [ ] **6단계: 커밋**

```bash
git add mobile/src/features/fund/backup-service.ts mobile/src/features/fund/backup-service.test.ts
git commit -m "feat(fund): connectAndRestore — Google 연결 뒤 백업이 있으면 바로 합치고 다시 올림

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 4: 위험 판정 `backup-risk.ts` + 안내 "봤음" 저장

**파일:**
- 새로 만듦: `mobile/src/features/fund/backup-risk.ts`, `mobile/src/features/fund/backup-risk.test.ts`
- 새로 만듦: `mobile/src/features/fund/backup-notice.ts`
- 수정: `mobile/src/features/fund/keys.ts`, `mobile/src/features/fund/account-purge.ts`, `mobile/src/features/auth/install-cleanup.ts`
- 테스트: `mobile/src/features/fund/account-purge.test.ts`, `mobile/src/features/auth/install-cleanup.test.ts`

- [ ] **1단계: 실패하는 테스트 작성** — `backup-risk.test.ts`

```ts
import { backupRisk, daysSince, STALE_DAYS } from './backup-risk';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 11, 12).getTime();
const on = (lastBackupAt: number | null) => ({ connected: true, lastBackupAt });

describe('backupRisk', () => {
  it('미설정이거나 펀드가 없으면 none', () => {
    expect(backupRisk({ connected: false, lastBackupAt: null }, false, 3, NOW)).toBe('none');
    expect(backupRisk({ connected: false, lastBackupAt: null }, true, 0, NOW)).toBe('none');
  });
  it('연결 안 됨이면 disconnected', () => {
    expect(backupRisk({ connected: false, lastBackupAt: NOW }, true, 1, NOW)).toBe('disconnected');
  });
  it('연결됐지만 백업한 적 없으면 stale', () => {
    expect(backupRisk(on(null), true, 1, NOW)).toBe('stale');
  });
  it('정확히 7일은 none, 7일을 넘으면 stale', () => {
    expect(backupRisk(on(NOW - STALE_DAYS * DAY), true, 1, NOW)).toBe('none');
    expect(backupRisk(on(NOW - STALE_DAYS * DAY - 1), true, 1, NOW)).toBe('stale');
  });
  it('최근 백업이면 none', () => {
    expect(backupRisk(on(NOW - DAY), true, 1, NOW)).toBe('none');
  });
});

describe('daysSince', () => {
  it('내림한 경과 일수, 미래는 0', () => {
    expect(daysSince(NOW - 8 * DAY - 5, NOW)).toBe(8);
    expect(daysSince(NOW - DAY + 1, NOW)).toBe(0);
    expect(daysSince(NOW + DAY, NOW)).toBe(0);
  });
});
```
  정리 테스트에 새 키를 더한다(기대값은 그대로 — 새 키도 지워져야 통과한다).
  - `account-purge.test.ts`의 첫 테스트에서 `secureMem.set('fund_backup_state_v1_u7', …)` 줄 아래에 추가: `secureMem.set('fund_backup_notice_seen_v1_u7', '1');`
  - `install-cleanup.test.ts`의 `seedLeftovers()`에서 `secureMem.set('fund_backup_state_v1_u7', '{}');` 줄 아래에 추가: `secureMem.set('fund_backup_notice_seen_v1_u7', '1');`

- [ ] **2단계: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/backup-risk src/features/fund/account-purge src/features/auth/install-cleanup`
Expected: FAIL — `backup-risk` 모듈 없음, 정리 테스트에 `fund_backup_notice_seen_v1_u7`가 남음

- [ ] **3단계: `backup-risk.ts` 구현**

```ts
// 펀드 목록 배너 판정(순수) — 기록은 기기에만 있고 allowBackup: false 라 백업 없이 앱을 지우면 되살릴 수 없다(2026-11-11 설계).
// 미연결 = disconnected, 연결됐지만 마지막 백업이 STALE_DAYS 일을 넘었거나 한 번도 없음 = stale.
export type BackupRisk = 'none' | 'disconnected' | 'stale';
export const STALE_DAYS = 7;
const DAY_MS = 86_400_000;

/** 경과 일수(내림, 음수는 0) */
export const daysSince = (ts: number, now: number): number => Math.max(0, Math.floor((now - ts) / DAY_MS));

export function backupRisk(
  s: { connected: boolean; lastBackupAt: number | null },
  configured: boolean,
  fundCount: number,
  now: number,
): BackupRisk {
  if (!configured || fundCount === 0) return 'none';
  if (!s.connected) return 'disconnected';
  if (s.lastBackupAt === null || now - s.lastBackupAt > STALE_DAYS * DAY_MS) return 'stale';
  return 'none';
}
```

- [ ] **4단계: 키와 "봤음" 저장 구현**
  - `keys.ts`의 `backupStateKey` 줄 아래에 추가:

```ts
/** 첫 펀드 등록 뒤 "기록은 이 폰에만" 안내 시트를 본 적 있는지(값 '1') */
export const backupNoticeKey = (uid: number): string => `fund_backup_notice_seen_v1_u${uid}`;
```
  - 새 파일 `backup-notice.ts`:

```ts
// "기록은 이 폰에만 저장돼요" 안내 시트 — 계정마다 한 번(2026-11-11 설계). SecureStore 키는 keys.ts.
import * as SecureStore from 'expo-secure-store';

import { backupNoticeKey, rememberFundOwner } from './keys';

/** 못 읽으면 본 것으로 친다 — 안내가 반복해서 뜨지 않게(목록 배너는 계속 보인다) */
export async function wasBackupNoticeSeen(uid: number): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(backupNoticeKey(uid))) === '1';
  } catch {
    return true;
  }
}

export async function markBackupNoticeSeen(uid: number): Promise<void> {
  await rememberFundOwner(uid); // iOS 재설치 정리가 이 키를 찾을 수 있게
  await SecureStore.setItemAsync(backupNoticeKey(uid), '1').catch(() => {});
}

/** 회원 탈퇴 정리용 */
export async function deleteBackupNotice(uid: number): Promise<void> {
  await SecureStore.deleteItemAsync(backupNoticeKey(uid));
}
```
  - `account-purge.ts`: import에 `import { deleteBackupNotice } from './backup-notice';`를 더하고, `await deleteBackupState(uid).catch(() => {});` 아래에 `await deleteBackupNotice(uid).catch(() => {});`를 추가. 파일 첫 줄 주석의 지우는 목록에 "안내 표시"를 더한다.
  - `install-cleanup.ts`: keys import에 `backupNoticeKey`를 더하고 125줄을 다음처럼 바꾼다.

```ts
  const keys = [
    ...FIXED_SECURE_KEYS,
    ...owners.flatMap((id) => [fundListKey(id), backupStateKey(id), backupNoticeKey(id)]),
  ];
```

- [ ] **5단계: 통과 확인**

Run: `cd mobile && npx jest src/features/fund src/features/auth && npx tsc --noEmit`
Expected: PASS, tsc 오류 없음

- [ ] **6단계: 커밋 후 dev 머지**

```bash
git add mobile/src/features/fund/backup-risk.ts mobile/src/features/fund/backup-risk.test.ts mobile/src/features/fund/backup-notice.ts mobile/src/features/fund/keys.ts mobile/src/features/fund/account-purge.ts mobile/src/features/fund/account-purge.test.ts mobile/src/features/auth/install-cleanup.ts mobile/src/features/auth/install-cleanup.test.ts
git commit -m "feat(fund): 백업 위험 판정(미연결·7일 초과)과 안내 시트 계정별 1회 기록

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
git switch dev && git merge --no-ff feature/fund-backup-restore-ux -m "Merge feature/fund-backup-restore-ux: 펀드 백업 요약·연결 후 복원·위험 판정" && git branch -d feature/fund-backup-restore-ux
```

---

### 작업 5: 문구 모음 `backup-text.ts`

**파일:**
- 새로 만듦: `mobile/src/features/fund/backup-text.ts`, `mobile/src/features/fund/backup-text.test.ts`

- [ ] **1단계: 브랜치 만들기**

```bash
git switch dev && git switch -c ui/fund-backup-restore-ux
```

- [ ] **2단계: 실패하는 테스트 작성** — `backup-text.test.ts`

```ts
import { connectResultText, errorText, riskBannerText, summaryText } from './backup-text';
import { driveError } from './drive-backup';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 11, 12).getTime();

describe('connectResultText', () => {
  it('결과별 문구', () => {
    expect(connectResultText({ status: 'cancelled' })).toBe('');
    expect(connectResultText({ status: 'fresh' })).toBe('불러올 백업이 없어요. 앞으로의 기록은 자동으로 백업돼요');
    expect(connectResultText({ status: 'invalid' })).toBe('Drive 백업 파일을 읽을 수 없어요');
    expect(connectResultText({ status: 'restored', addedFunds: 3, skippedFunds: 0, mergedPoints: 120 })).toBe(
      '펀드 3개, 기록 120건을 불러왔어요',
    );
    expect(connectResultText({ status: 'restored', addedFunds: 10, skippedFunds: 2, mergedPoints: 5 })).toBe(
      '펀드 10개, 기록 5건을 불러왔어요 · 2개는 한도로 건너뛰었어요',
    );
  });
});

describe('summaryText', () => {
  it('마지막 날짜는 M.D', () => {
    expect(summaryText({ funds: 3, points: 120, lastDate: '2026-11-05' })).toBe(
      'Drive 백업 · 펀드 3개 · 기록 120건 · 11.5 기록까지',
    );
    expect(summaryText({ funds: 1, points: 0, lastDate: null })).toBe('Drive 백업 · 펀드 1개 · 기록 0건');
  });
});

describe('riskBannerText', () => {
  it('위험별 제목·본문', () => {
    expect(riskBannerText('none', null, NOW)).toBeNull();
    expect(riskBannerText('disconnected', null, NOW)).toEqual({
      title: '기록은 이 폰에만 있어요',
      body: '백업하지 않고 앱을 지우거나 폰을 바꾸면 기록이 사라져요',
    });
    expect(riskBannerText('stale', NOW - 9 * DAY, NOW)).toEqual({
      title: '마지막 백업이 9일 전이에요',
      body: '지금 백업해 두세요',
    });
    expect(riskBannerText('stale', null, NOW)?.title).toBe('아직 백업하지 못했어요');
  });
});

describe('errorText', () => {
  it('Drive 오류 분류별 문구', () => {
    expect(errorText(driveError('auth', 'x'))).toBe('Google 연결이 끊겼어요. 다시 연결해 주세요.');
    expect(errorText(new Error('x'))).toBe('처리하지 못했어요. 다시 시도해 주세요.');
  });
});
```

- [ ] **3단계: 실패 확인**

Run: `cd mobile && npx jest src/features/fund/backup-text`
Expected: FAIL — 모듈 없음

- [ ] **4단계: 구현** — `backup-text.ts` (`errorText`는 `app/fund/backup.tsx`에서 그대로 옮긴다)

```ts
// 백업·복원 화면 문구(순수) — 백업 화면·펀드 목록·안내 시트가 같이 쓴다.
import type { BackupRisk } from './backup-risk';
import { daysSince } from './backup-risk';
import type { ConnectResult } from './backup-service';
import type { BackupSummary } from './core';
import { isDriveError } from './drive-backup';

export function errorText(e: unknown): string {
  if (isDriveError(e, 'auth')) return 'Google 연결이 끊겼어요. 다시 연결해 주세요.';
  if (isDriveError(e, 'invalid')) return 'Drive 백업 파일을 읽을 수 없어요. 덮어쓰지 않았어요.';
  if (isDriveError(e, 'network')) return '연결을 확인하고 다시 시도해 주세요.';
  if (isDriveError(e, 'unverified')) return 'Google 계정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  return '처리하지 못했어요. 다시 시도해 주세요.';
}

/** 연결+복원 결과. 취소는 빈 문자열(아무것도 띄우지 않음) */
export function connectResultText(r: ConnectResult): string {
  if (r.status === 'cancelled') return '';
  if (r.status === 'fresh') return '불러올 백업이 없어요. 앞으로의 기록은 자동으로 백업돼요';
  if (r.status === 'invalid') return 'Drive 백업 파일을 읽을 수 없어요';
  const skipped = r.skippedFunds ? ` · ${r.skippedFunds}개는 한도로 건너뛰었어요` : '';
  return `펀드 ${r.addedFunds}개, 기록 ${r.mergedPoints}건을 불러왔어요${skipped}`;
}

/** 'YYYY-MM-DD' → 'M.D' */
const md = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}.${Number(d)}`;
};

export function summaryText(s: BackupSummary): string {
  const last = s.lastDate ? ` · ${md(s.lastDate)} 기록까지` : '';
  return `Drive 백업 · 펀드 ${s.funds}개 · 기록 ${s.points}건${last}`;
}

export function riskBannerText(
  risk: BackupRisk,
  lastBackupAt: number | null,
  now: number,
): { title: string; body: string } | null {
  if (risk === 'none') return null;
  if (risk === 'disconnected')
    return { title: '기록은 이 폰에만 있어요', body: '백업하지 않고 앱을 지우거나 폰을 바꾸면 기록이 사라져요' };
  const title = lastBackupAt === null ? '아직 백업하지 못했어요' : `마지막 백업이 ${daysSince(lastBackupAt, now)}일 전이에요`;
  return { title, body: '지금 백업해 두세요' };
}
```

- [ ] **5단계: 통과 확인**

Run: `cd mobile && npx jest src/features/fund/backup-text && npx tsc --noEmit`
Expected: PASS

- [ ] **6단계: 커밋**

```bash
git add mobile/src/features/fund/backup-text.ts mobile/src/features/fund/backup-text.test.ts
git commit -m "feat(fund): 백업 문구 모음(연결 결과·요약·배너·오류)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 6: 백업 화면 — 연결 흐름 교체, 요약, 경고 문구

**파일:**
- 수정: `mobile/src/app/fund/backup.tsx`

- [ ] **1단계: import 정리** — 위쪽 import를 아래처럼 바꾼다(`hasRemoteBackup`, `saveBackupState`, `connect`, `isDriveError`는 더 이상 쓰지 않는다. `Alert`는 연결 해제에서 계속 쓴다).

```ts
import { useAuthStore } from '@/features/auth/store';
import { backupNow, connectAndRestore, restoreFromDrive, type RestoreResult } from '@/features/fund/backup-service';
import { loadBackupState, resetBackupState, type BackupState } from '@/features/fund/backup-state';
import { connectResultText, errorText, summaryText } from '@/features/fund/backup-text';
import { formatChecked } from '@/features/fund/core';
import { disconnect, isBackupConfigured } from '@/features/fund/google-auth';
import { Button, Card, ListState } from '@/ui';
```
  파일 안의 `function errorText(...) {...}` 정의를 지운다(`backup-text.ts`로 옮겼다). `restoreText`는 [복원] 버튼용이라 그대로 둔다.

- [ ] **2단계: 연결 흐름 교체** — `onConnect`를 아래로 바꾼다.

```ts
  // 백업이 있으면 묻지 않고 바로 합친다(합치기라 기기 기록이 사라지지 않는다), 없으면 첫 백업
  const onConnect = () => run('connect', async () => connectResultText(await connectAndRestore()));
```

- [ ] **3단계: 요약 줄과 경고 문구** — 카드 안을 바꾼다.

```tsx
        <Text style={styles.line}>{state.connected ? state.email : '연결 안 됨'}</Text>
        {state.summary ? <Text style={styles.sub}>{summaryText(state.summary)}</Text> : null}
        {state.lastBackupAt ? (
          <Text style={styles.sub}>마지막 백업 {formatChecked(state.lastBackupAt, now)}</Text>
        ) : null}
        {state.lastError ? <Text style={styles.error}>{state.lastError}</Text> : null}
        <Text style={styles.hint}>
          기록은 이 폰에만 저장돼요. 백업하지 않고 앱을 지우거나 폰을 바꾸면 기록을 되살릴 수 없어요.
        </Text>
        <Text style={styles.hint}>
          백업은 내 Google Drive 의 앱 전용 공간에 저장돼요. Drive 목록에는 보이지 않고, 새 기록이 생기면 하루 한 번
          자동으로 백업해요.
        </Text>
```

- [ ] **4단계: 검사**

Run: `cd mobile && npx tsc --noEmit && npx expo lint src/app/fund/backup.tsx && npx jest src/features/fund`
Expected: 오류 없음, PASS

- [ ] **5단계: 커밋**

```bash
git add mobile/src/app/fund/backup.tsx
git commit -m "feat(fund): 백업 화면 — 연결하면 바로 복원, Drive 백업 요약, 기록 사라짐 안내

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 7: 펀드 목록 — 1탭 복원 버튼과 위험 배너

**파일:**
- 새로 만듦: `mobile/src/features/fund/components/backup-risk-banner.tsx`
- 수정: `mobile/src/app/fund/index.tsx`

- [ ] **1단계: 배너 컴포넌트** — `backup-risk-banner.tsx`

```tsx
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { BackupRisk } from '../backup-risk';
import { riskBannerText } from '../backup-text';

/** 백업 미연결·오래됨 경고 — 누르면 백업 화면. 위험할 때만 보이므로 닫기 버튼은 없다(2026-11-11 설계) */
export function BackupRiskBanner({
  risk,
  lastBackupAt,
  now,
  onPress,
}: {
  risk: BackupRisk;
  lastBackupAt: number | null;
  now: number;
  onPress: () => void;
}) {
  const t = riskBannerText(risk, lastBackupAt, now);
  if (!t) return null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${t.title}. ${t.body}`} style={styles.box}>
      <View style={styles.flex}>
        <Text style={styles.title}>{t.title}</Text>
        <Text style={styles.body}>{t.body}</Text>
      </View>
      <Text style={styles.go}>백업 ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1),
    backgroundColor: theme.colors.cautionSoft,
    borderRadius: theme.radius.card,
    padding: theme.gap(1.5),
  },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '700', color: theme.colors.caution },
  body: { fontSize: 13, color: theme.colors.text },
  go: { fontSize: 14, fontWeight: '600', color: theme.colors.caution },
}));
```

- [ ] **2단계: `index.tsx` import 추가**

```ts
import { connectAndRestore } from '@/features/fund/backup-service';
import { loadBackupState, type BackupState } from '@/features/fund/backup-state';
import { backupRisk } from '@/features/fund/backup-risk';
import { connectResultText, errorText } from '@/features/fund/backup-text';
import { BackupRiskBanner } from '@/features/fund/components/backup-risk-banner';
```

- [ ] **3단계: 상태와 포커스 때 백업 상태 읽기** — `const [promptOpen, …]` 줄 아래에 추가.

```ts
  // 배너용 백업 상태 — 백업 화면에서 돌아오면 바로 반영되게 포커스마다 다시 읽는다(계정별)
  const [backup, setBackup] = useState<{ uid: number; state: BackupState; now: number } | null>(null);
  const [restoring, setRestoring] = useState(false);
```
  기존 `useFocusEffect` 아래에 두 번째 `useFocusEffect`를 추가.

```ts
  useFocusEffect(
    useCallback(() => {
      if (ownerId === null) return;
      let alive = true;
      const uid = ownerId;
      void loadBackupState(uid).then((state) => {
        if (alive) setBackup({ uid, state, now: Date.now() });
      });
      return () => {
        alive = false;
      };
    }, [ownerId]),
  );
```
  `if (!user) return <Redirect … />;` 바로 아래에 계산을 추가.

```ts
  const risk =
    backup !== null && backup.uid === ownerId && funds !== null
      ? backupRisk(backup.state, isBackupConfigured(), funds.length, backup.now)
      : 'none';
```

- [ ] **4단계: 목록·백업 상태 다시 읽기를 함수로 묶고 1탭 복원 추가** — 기존 `handleLegacyDone`을 아래 세 함수로 바꾼다.

```ts
  // 목록이 바뀐 뒤(가져오기·버리기·복원) — 목록·백업 상태 다시 읽기, 펀드 수가 바뀌었으니 정기 작업·푸시 등록 동기화
  const reloadAfterChange = () => {
    const uid = user.id;
    loadFunds(uid)
      .then((l) => {
        setData({ uid, list: l });
        setLoadError('');
      })
      .catch(() => setLoadError('저장된 목록을 읽지 못했어요.'));
    void loadBackupState(uid).then((state) => setBackup({ uid, state, now: Date.now() }));
    void syncBackgroundTasks();
    void syncPushRegistration();
  };

  const handleLegacyDone = () => {
    setLegacy(null);
    reloadAfterChange();
  };

  // 새 폰·재설치: Google 계정 선택 한 번으로 바로 복원(확인 창 없음 — 2026-11-11 설계)
  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const text = connectResultText(await connectAndRestore());
      if (text) showToast(text);
    } catch (e) {
      showToast(errorText(e));
    } finally {
      setRestoring(false);
      reloadAfterChange();
    }
  };
```
  (기존 `handleLegacyDone` 본문을 먼저 끝까지 읽는다. 위 `reloadAfterChange`에 없는 처리가 더 있으면 그대로 `handleLegacyDone`에 남긴다.)

- [ ] **5단계: 빈 목록 버튼과 배너 배치** — 빈 목록의 버튼을 바꾼다.

```tsx
          {isBackupConfigured() ? (
            <Button
              label="Google Drive에서 복원"
              variant="secondary"
              onPress={() => void handleRestore()}
              loading={restoring}
              disabled={restoring}
            />
          ) : null}
```
  추가 카드(`</Card>`)와 목록 분기(`{funds === null && loadError ? …`) 사이에 배너를 넣는다.

```tsx
      <BackupRiskBanner
        risk={risk}
        lastBackupAt={backup?.state.lastBackupAt ?? null}
        now={backup?.now ?? 0}
        onPress={() => router.push('/fund/backup')}
      />
```

- [ ] **6단계: 검사**

Run: `cd mobile && npx tsc --noEmit && npx expo lint src/app/fund/index.tsx src/features/fund/components/backup-risk-banner.tsx && npx jest src/features/fund`
Expected: 오류 없음, PASS

- [ ] **7단계: 커밋**

```bash
git add mobile/src/features/fund/components/backup-risk-banner.tsx mobile/src/app/fund/index.tsx
git commit -m "feat(fund): 펀드 목록 — 빈 목록 1탭 복원, 백업 미연결·오래됨 배너

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 8: 첫 펀드 등록 뒤 한 번 안내 시트

**파일:**
- 새로 만듦: `mobile/src/features/fund/components/backup-notice-sheet.tsx`
- 수정: `mobile/src/app/fund/index.tsx`

- [ ] **1단계: 시트 컴포넌트** — `backup-notice-sheet.tsx`

```tsx
import { Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { BottomSheet, Button } from '@/ui';

/** 첫 펀드 등록 뒤 계정마다 한 번 — 기록은 기기에만 있고 백업 없이 앱을 지우면 사라진다(2026-11-11 설계) */
export function BackupNoticeSheet({ onConnect, onClose }: { onConnect: () => void; onClose: () => void }) {
  return (
    <BottomSheet title="기록은 이 폰에만 저장돼요" onClose={onClose}>
      <Text style={styles.text}>Google Drive에 백업해 두면 앱을 지우거나 폰을 바꿔도 기록을 되살릴 수 있어요.</Text>
      <Button label="백업 연결" onPress={onConnect} />
      <Button label="나중에" variant="secondary" onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
}));
```

- [ ] **2단계: `index.tsx` import와 상태**

```ts
import { markBackupNoticeSeen, wasBackupNoticeSeen } from '@/features/fund/backup-notice';
import { BackupNoticeSheet } from '@/features/fund/components/backup-notice-sheet';
```
  `const [restoring, …]` 아래에 추가:

```ts
  // 첫 펀드 등록 뒤 안내 — 그 계정일 때만. 푸시·가져오기 시트가 닫힌 뒤에 연다(겹치지 않게)
  const [noticeUid, setNoticeUid] = useState<number | null>(null);
```

- [ ] **3단계: 등록 때 조건 판단** — `handleAdd`의 `if (offer) setPromptOpen(true);` 줄 아래에 추가.

```ts
      if (funds.length === 0 && next.length === 1 && isBackupConfigured()) {
        const state = await loadBackupState(uid);
        if (backupRisk(state, true, next.length, Date.now()) === 'disconnected' && !(await wasBackupNoticeSeen(uid))) {
          setNoticeUid(uid);
        }
      }
```

- [ ] **4단계: 시트 그리기와 처리** — `{promptOpen ? <PushPromptSheet … /> : null}` 줄 아래에 추가.

```tsx
      {noticeUid !== null && noticeUid === ownerId && !promptOpen && legacyPreview === null ? (
        <BackupNoticeSheet
          onClose={() => {
            void markBackupNoticeSeen(noticeUid);
            setNoticeUid(null);
          }}
          onConnect={() => {
            void markBackupNoticeSeen(noticeUid);
            setNoticeUid(null);
            void handleRestore();
          }}
        />
      ) : null}
```

- [ ] **5단계: 검사**

Run: `cd mobile && npx tsc --noEmit && npx expo lint src/app/fund/index.tsx src/features/fund/components/backup-notice-sheet.tsx && npx jest`
Expected: 오류 없음, 앱 전체 jest PASS

- [ ] **6단계: 커밋**

```bash
git add mobile/src/features/fund/components/backup-notice-sheet.tsx mobile/src/app/fund/index.tsx
git commit -m "feat(fund): 첫 펀드 등록 뒤 '기록은 이 폰에만' 안내 시트(계정별 1회)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### 작업 9: 문서 갱신, 최종 검사, dev 머지

**파일:**
- 수정: `README.md`('펀드 히스토리 · Google Drive 백업' 절, 268줄 부근)
- 수정: `docs/feature-report/app.md`(펀드 목록 설명 171줄 부근, 10절 224줄 부근)

- [ ] **1단계: README** — 그 절의 "백업은 사용자 본인 Google Drive…" 항목 아래에 추가.

```markdown
- **사라짐 안내·1탭 복원(2026-11-11)**: 기록은 기기에만 있고 `allowBackup: false` 라 백업 없이 앱을 지우면 되살릴 수 없다.
  펀드 목록에 백업 미연결·마지막 백업 7일 초과 배너, 첫 펀드 등록 뒤 계정마다 한 번 안내 시트(`fund_backup_notice_seen_v1_u<id>`).
  빈 목록의 "Google Drive에서 복원"·백업 화면 [연결]은 계정 선택 뒤 확인 없이 바로 합치고 다시 올린다(`connectAndRestore`).
  백업 화면에 Drive 백업 요약(펀드 수·기록 수·마지막 기록 날짜). 설계 `docs/superpowers/specs/2026-11-11-fund-backup-restore-ux-design.md`
```

- [ ] **2단계: 기능 보고서** — `docs/feature-report/app.md`
  - 펀드 목록 설명(헤더 ☁️ 아이콘 줄) 아래에 추가: `- 🆕 11-11: 백업을 연결하지 않았거나 마지막 백업이 7일을 넘으면 목록 위에 주황 배너가 뜹니다. 누르면 기록 백업 화면으로 갑니다. 첫 펀드를 등록하면 "기록은 이 폰에만 저장돼요" 안내를 한 번 보여 줍니다. 목록이 비어 있으면 "Google Drive에서 복원" 한 번으로 계정 선택 뒤 바로 복원합니다.`
  - 10절 상태 줄 위에 추가: `- 🆕 11-11: 연결하면 Drive 백업이 있을 때 묻지 않고 바로 합칩니다(합치기라 기기 기록은 사라지지 않음). 카드에 "Drive 백업 · 펀드 N개 · 기록 M건 · M.D 기록까지" 요약을 보여 줍니다.`

- [ ] **3단계: 최종 검사**

```bash
cd mobile && npx jest && npx tsc --noEmit && npx expo lint
cd ../web_client && npx vitest run && npx tsc --noEmit -p .
cd .. && bash scripts/check-fund-core-sync.sh
```
Expected: 모두 통과

- [ ] **4단계: 커밋과 dev 머지**

```bash
git add README.md docs/feature-report/app.md
git commit -m "docs(fund): 백업 사라짐 안내·1탭 복원·백업 요약 문서화

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
git switch dev && git merge --no-ff ui/fund-backup-restore-ux -m "Merge ui/fund-backup-restore-ux: 펀드 백업 사라짐 안내·1탭 복원·요약" && git branch -d ui/fund-backup-restore-ux
```

- [ ] **5단계: 반영 안내(실행하지 않음)** — 배포·OTA는 사용자가 요청할 때만 한다. 실제로 켜지려면 사용자가 Google Cloud 설정과 `mobile/.env.development`의 `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`를 먼저 준비해야 한다(스펙 7절).
