// 회원 탈퇴 성공 뒤 그 계정의 펀드 데이터를 기기에서 지운다(2026-10-23 설계) — 목록·캐시·기록·백업 상태·대기 파일 + Google 로그아웃.
// 탈퇴가 실패하면 부르지 않는다(호출부 delete-account-sheet 가 성공 뒤에만). 탈퇴 직후엔 이미 로그아웃이라 uid 를 받아 쓴다.
import { pendingFileName, removeFile } from './background/backup-pending';
import { deleteBackupState } from './backup-state';
import { deleteCache, deleteFundList, loadFunds } from './fund-store';
import { disconnect } from './google-auth';
import { deleteHistory } from './history-store';

export async function purgeFundAccount(uid: number, deps = { disconnect }): Promise<void> {
  const funds = await loadFunds(uid).catch(() => []);
  for (const f of funds) {
    deleteCache(f.id);
    deleteHistory(f.id);
  }
  await deleteFundList(uid).catch(() => {});
  await deleteBackupState(uid).catch(() => {});
  removeFile(pendingFileName(uid));
  try {
    await deps.disconnect();
  } catch {
    // Google 로그아웃 실패는 무시 — 로컬 정리는 끝났다
  }
}
