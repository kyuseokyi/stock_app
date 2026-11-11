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
