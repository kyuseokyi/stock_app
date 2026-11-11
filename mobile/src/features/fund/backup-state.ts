// 백업 상태(SecureStore, 토큰 없음) — 연결 여부·계정 이메일·마지막 성공 시각·마지막 오류 문구. 앱 계정별 키.
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

/** 로그인 안 됨이면 초기 상태(연결 안 됨) */
export async function loadBackupState(uid: number | null = currentOwnerIdOrNull()): Promise<BackupState> {
  if (uid === null) return INITIAL_BACKUP_STATE;
  try {
    return parseBackupState(await SecureStore.getItemAsync(backupStateKey(uid)));
  } catch {
    return INITIAL_BACKUP_STATE;
  }
}

/** 로그인 안 됨이면 던진다 — 공용 키에 쓰지 않는다 */
export async function saveBackupState(patch: Partial<BackupState>, uid: number = currentOwnerId()): Promise<BackupState> {
  const next = { ...(await loadBackupState(uid)), ...patch };
  await rememberFundOwner(uid); // iOS 재설치 정리가 이 계정 키를 찾을 수 있게(keys.ts)
  await SecureStore.setItemAsync(backupStateKey(uid), JSON.stringify(next));
  return next;
}

export async function resetBackupState(uid: number = currentOwnerId()): Promise<void> {
  await rememberFundOwner(uid);
  await SecureStore.setItemAsync(backupStateKey(uid), JSON.stringify(INITIAL_BACKUP_STATE));
}

/** 회원 탈퇴 정리용 */
export async function deleteBackupState(uid: number): Promise<void> {
  await SecureStore.deleteItemAsync(backupStateKey(uid));
}
