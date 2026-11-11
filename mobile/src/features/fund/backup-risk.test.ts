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
