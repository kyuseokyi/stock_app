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
