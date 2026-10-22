// 백그라운드에서 새 기록이 생겼다는 표시 — 다음 앱 복귀 때 Drive 백업. 메모리가 아니라 파일인 이유:
// Android 는 앱이 꺼진 상태에서 태스크만 따로 실행됐다 끝날 수 있고, SecureStore 는 iOS 잠금 중 못 읽을 수 있다.
// 앱 계정별 파일 — 다른 계정으로 바뀐 뒤 그 계정 Drive 로 백업이 새지 않게. 로그인 안 됨이면 아무것도 안 한다.
import { File, Paths } from 'expo-file-system';

import { currentOwnerIdOrNull } from '../owner';

export const pendingFileName = (uid: number): string => `fund-backup-pending-u${uid}.json`;
/** 계정별 저장 전 옛 파일 — 가져오기·버리기에서만 쓴다 */
export const LEGACY_PENDING_FILE = 'fund-backup-pending.json';

const fileOf = (name: string): File => new File(Paths.document, name);

export function markBackupPending(uid: number | null = currentOwnerIdOrNull()): void {
  if (uid === null) return;
  try {
    const f = fileOf(pendingFileName(uid));
    if (!f.exists) f.create();
    f.write(String(Date.now()));
  } catch {
    // 못 남겨도 다음 새 기록 때 maybeAutoBackup 이 다시 시도한다
  }
}

/** 표시가 있었으면 지우고 true */
export function takeBackupPending(uid: number | null = currentOwnerIdOrNull()): boolean {
  if (uid === null) return false;
  return removeFile(pendingFileName(uid));
}

/** 파일이 있었으면 지우고 true(가져오기·버리기·탈퇴 정리용) */
export function removeFile(name: string): boolean {
  try {
    const f = fileOf(name);
    if (!f.exists) return false;
    f.delete();
    return true;
  } catch {
    return false;
  }
}
