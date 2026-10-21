// 백그라운드에서 새 기록이 생겼다는 표시 — 다음 앱 복귀 때 Drive 백업. 메모리가 아니라 파일인 이유:
// Android 는 앱이 꺼진 상태에서 태스크만 따로 실행됐다 끝날 수 있고, SecureStore 는 iOS 잠금 중 못 읽을 수 있다.
import { File, Paths } from 'expo-file-system';

const pendingFile = (): File => new File(Paths.document, 'fund-backup-pending.json');

export function markBackupPending(): void {
  try {
    const f = pendingFile();
    if (!f.exists) f.create();
    f.write(String(Date.now()));
  } catch {
    // 못 남겨도 다음 새 기록 때 maybeAutoBackup 이 다시 시도한다
  }
}

/** 표시가 있었으면 지우고 true */
export function takeBackupPending(): boolean {
  try {
    const f = pendingFile();
    if (!f.exists) return false;
    f.delete();
    return true;
  } catch {
    return false;
  }
}
