// 백업·복원 화면 문구(순수) — 백업 화면·펀드 목록·안내 시트가 같이 쓴다.
import type { BackupRisk } from './backup-risk';
import { daysSince } from './backup-risk';
import type { ConnectResult } from './backup-service';
import type { BackupSummary } from './core';
import { isDriveError } from './drive-backup';

export function errorText(e: unknown): string {
  if (isDriveError(e, 'auth')) return 'Google 연결이 끊겼어요. 다시 연결해 주세요.';
  if (isDriveError(e, 'invalid')) return 'Drive 백업 파일을 읽을 수 없어요. 덮어쓰지 않았어요.';
  if (isDriveError(e, 'network')) return '연결을 확인하고 다시 시도해 주세요.';
  if (isDriveError(e, 'unverified')) return 'Google 계정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
  return '처리하지 못했어요. 다시 시도해 주세요.';
}

/** 연결+복원 결과. 취소는 빈 문자열(아무것도 띄우지 않음) */
export function connectResultText(r: ConnectResult): string {
  if (r.status === 'cancelled') return '';
  if (r.status === 'fresh') return '불러올 백업이 없어요. 앞으로의 기록은 자동으로 백업돼요';
  if (r.status === 'invalid') return 'Drive 백업 파일을 읽을 수 없어요';
  const skipped = r.skippedFunds ? ` · ${r.skippedFunds}개는 한도로 건너뛰었어요` : '';
  return `펀드 ${r.addedFunds}개, 기록 ${r.mergedPoints}건을 불러왔어요${skipped}`;
}

/** 'YYYY-MM-DD' → 'M.D' */
const md = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}.${Number(d)}`;
};

export function summaryText(s: BackupSummary): string {
  const last = s.lastDate ? ` · ${md(s.lastDate)} 기록까지` : '';
  return `Drive 백업 · 펀드 ${s.funds}개 · 기록 ${s.points}건${last}`;
}

export function riskBannerText(
  risk: BackupRisk,
  lastBackupAt: number | null,
  now: number,
): { title: string; body: string } | null {
  if (risk === 'none') return null;
  if (risk === 'disconnected')
    return { title: '기록은 이 폰에만 있어요', body: '백업하지 않고 앱을 지우거나 폰을 바꾸면 기록이 사라져요' };
  const title = lastBackupAt === null ? '아직 백업하지 못했어요' : `마지막 백업이 ${daysSince(lastBackupAt, now)}일 전이에요`;
  return { title, body: '지금 백업해 두세요' };
}
