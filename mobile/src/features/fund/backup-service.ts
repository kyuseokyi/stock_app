// 백업·복원 흐름 — 업로드는 항상 "Drive 받기 → 합치기 → 올리기"(재설치 직후 덮어쓰기 보호).
// 받기가 '파일 없음' 외 이유로 실패하면 올리지 않는다(downloadBackup 이 던지면 업로드 전에 빠져나간다).
// 앱 계정 경계(2026-10-23): 작업 시작 때 소유자(uid)를 한 번 잡아 목록·상태·Drive 파일 이름을 끝까지 그 계정으로 쓴다.
// Drive 호출 직전마다 지금 Google 로그인 이메일 = 이 계정 백업 상태 email 인지 확인 — 다르면 호출하지 않고 연결 안 됨.
import { buildBackup, mergeBackup, newFundId, parseBackup, shouldAutoBackup } from './core';
import { loadBackupState, saveBackupState } from './backup-state';
import {
  accountBackupFile,
  downloadBackup,
  driveError,
  findBackupId,
  isDriveError,
  LEGACY_BACKUP_FILE,
  uploadBackup,
  type DriveDeps,
} from './drive-backup';
import { loadFunds, saveFunds } from './fund-store';
import { accessToken, currentGoogleEmail, isBackupConfigured } from './google-auth';
import { loadAllHistories, writeHistories } from './history-store';
import { currentOwnerId, currentOwnerIdOrNull } from './owner';

const sameEmail = (a: string | null, b: string): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** 이 계정의 Drive 의존성 — 토큰을 받을 때마다 Google 계정이 이 계정이 연결한 것인지 확인 */
async function driveDepsFor(uid: number): Promise<DriveDeps> {
  const { email } = await loadBackupState(uid);
  return {
    getAccessToken: async () => {
      const token = await accessToken();
      if (!sameEmail(currentGoogleEmail(), email)) throw driveError('auth', '이 계정이 연결한 Google 계정이 아니에요');
      return token;
    },
  };
}

// Drive 작업(백업·복원)은 한 번에 하나씩 — 수동/자동/Alert 복원이 겹치지 않게
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/** Drive 오류를 이 계정 상태에 남기고 다시 던진다(401/403·Google 계정 불일치면 연결 해제 상태로) */
async function recordFailure(uid: number, e: unknown): Promise<never> {
  if (isDriveError(e, 'auth')) await saveBackupState({ connected: false, lastError: '다시 연결해 주세요' }, uid);
  else if (isDriveError(e, 'invalid'))
    await saveBackupState({ lastError: 'Drive 백업 파일을 읽을 수 없어 올리지 않았어요' }, uid);
  else if (isDriveError(e, 'network')) await saveBackupState({ lastError: '네트워크 문제로 백업하지 못했어요' }, uid);
  throw e;
}

/** 내 파일, 없으면 옛 파일(계정별 저장 전 백업 — 같은 Google 계정 = 본인 Drive 라 이어서 쓴다) */
async function downloadMineOrLegacy(deps: DriveDeps, uid: number): Promise<string | null> {
  return (await downloadBackup(deps, accountBackupFile(uid))) ?? (await downloadBackup(deps, LEGACY_BACKUP_FILE));
}

/** 복원할 백업이 있는지 — 내 파일 또는 옛 파일 */
export async function hasRemoteBackup(): Promise<boolean> {
  const uid = currentOwnerId();
  const deps = await driveDepsFor(uid);
  try {
    return (
      (await findBackupId(deps, accountBackupFile(uid))) !== null ||
      (await findBackupId(deps, LEGACY_BACKUP_FILE)) !== null
    );
  } catch (e) {
    return recordFailure(uid, e);
  }
}

export async function backupNow(now = Date.now()): Promise<void> {
  const uid = currentOwnerId();
  return exclusive(() => doBackup(uid, now));
}

async function doBackup(uid: number, now: number): Promise<void> {
  const funds = await loadFunds(uid);
  const histories = await loadAllHistories(funds); // 못 읽으면 던진다 — 빈 기록으로 올리지 않는다
  const deps = await driveDepsFor(uid);
  try {
    // 내 파일이 아직 없으면 옛 파일을 합치기 기준으로(옛 백업에만 있는 펀드·기록이 내 파일로 이어지게). 올리기는 항상 내 파일.
    const raw = await downloadMineOrLegacy(deps, uid);
    const remote = raw === null ? null : parseBackup(raw);
    // 파일은 있는데 읽을 수 없으면(깨짐·새 버전) 덮어쓰지 않는다
    if (raw !== null && remote === null) throw driveError('invalid', 'Drive 백업 파일을 읽을 수 없어요');
    await uploadBackup(deps, JSON.stringify(buildBackup({ funds, histories }, remote, now)), accountBackupFile(uid));
  } catch (e) {
    return recordFailure(uid, e);
  }
  await saveBackupState({ lastBackupAt: now, lastError: '' }, uid);
}

export type RestoreResult =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; addedFunds: number; skippedFunds: number; mergedPoints: number };

export async function restoreFromDrive(): Promise<RestoreResult> {
  const uid = currentOwnerId();
  return exclusive(() => doRestore(uid));
}

async function doRestore(uid: number): Promise<RestoreResult> {
  const deps = await driveDepsFor(uid);
  let raw: string | null;
  try {
    raw = await downloadMineOrLegacy(deps, uid);
  } catch (e) {
    return recordFailure(uid, e);
  }
  if (raw === null) return { status: 'none' };
  const backup = parseBackup(raw);
  if (!backup) return { status: 'invalid' };
  const funds = await loadFunds(uid); // 목록을 못 읽으면 던진다 — 빈 목록으로 덮지 않도록
  const histories = await loadAllHistories(funds);
  const r = mergeBackup({ funds, histories }, backup, newFundId);
  writeHistories(r.funds, r.histories); // 기록 먼저, 목록은 한 번에 저장
  await saveFunds(r.funds, uid);
  return { status: 'ok', addedFunds: r.addedFunds, skippedFunds: r.skippedFunds, mergedPoints: r.mergedPoints };
}

let running = false;

/** 새 날짜가 기록됐을 때 — 로그인·연결돼 있고 오늘(기기 날짜) 아직 안 했으면 백업. 실패는 상태에만 남긴다. */
export async function maybeAutoBackup(now = Date.now()): Promise<void> {
  if (running || !isBackupConfigured()) return;
  const uid = currentOwnerIdOrNull();
  if (uid === null) return; // 로그인 안 됨 — 백업 작업 안 함
  running = true;
  try {
    const s = await loadBackupState(uid);
    if (s.connected && shouldAutoBackup(s.lastBackupAt, now)) await exclusive(() => doBackup(uid, now));
  } catch {
    // 상태(lastError)에 남았다 — 다음 새 기록 때 다시 시도
  } finally {
    running = false;
  }
}
