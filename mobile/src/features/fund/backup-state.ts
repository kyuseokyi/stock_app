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
