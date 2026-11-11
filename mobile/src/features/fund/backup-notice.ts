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
