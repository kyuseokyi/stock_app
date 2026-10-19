// Google Drive 백업 파일 모양·검증·합치기(순수 함수). Drive 호출은 앱 drive-backup.ts.
// 펀드 id 는 기기마다 새로 생기므로 백업에서는 URL 이 키. 업로드는 항상 Drive 합본(buildBackup 의 remote).
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import { MAX_FUNDS, MAX_NAME, type FundEntry } from './funds';
import { mergeAccounts, own, parseAccounts, type HistoryAccounts } from './history';
import { isFundUrl } from './url';

export const BACKUP_FILE = 'fund-backup-v1.json';

export type Backup = {
  v: 1;
  exportedAt: number;
  funds: { name: string; url: string }[];
  history: Record<string, HistoryAccounts>; // url → 계좌별 기록
};
/** 기기 데이터 — histories 키는 url */
export type LocalData = { funds: FundEntry[]; histories: Record<string, HistoryAccounts> };
export type MergeResult = LocalData & { addedFunds: number; skippedFunds: number; mergedPoints: number };

/** 올릴 백업 = 로컬 + Drive(remote). Drive 에만 있는 펀드·기록도 남겨 재설치 직후 덮어쓰기를 막는다. */
export function buildBackup(local: LocalData, remote: Backup | null, now: number): Backup {
  const funds = local.funds.map(({ name, url }) => ({ name, url }));
  for (const f of remote?.funds ?? []) if (!funds.some((x) => x.url === f.url)) funds.push(f);
  const history: Record<string, HistoryAccounts> = {};
  for (const { url } of funds) {
    const merged = mergeAccounts((remote && own(remote.history, url)) || {}, own(local.histories, url) ?? {}).accounts;
    if (Object.keys(merged).length) history[url] = merged;
  }
  return { v: 1, exportedAt: now, funds, history };
}

/** Drive 에서 받은 글자 → 검증된 백업. 최상위가 깨졌으면 null, 틀린 항목은 버린다. */
export function parseBackup(raw: string): Backup | null {
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = d as { v?: unknown; exportedAt?: unknown; funds?: unknown; history?: unknown } | null;
  if (!o || typeof o !== 'object' || o.v !== 1 || !Array.isArray(o.funds)) return null;
  const funds: Backup['funds'] = [];
  for (const f of o.funds as unknown[]) {
    const x = f as { name?: unknown; url?: unknown } | null;
    if (!x || typeof x.url !== 'string' || !isFundUrl(x.url) || funds.some((y) => y.url === x.url)) continue;
    funds.push({ name: typeof x.name === 'string' ? x.name.slice(0, MAX_NAME) : '', url: x.url });
  }
  const rawH =
    o.history && typeof o.history === 'object' && !Array.isArray(o.history) ? (o.history as Record<string, unknown>) : {};
  const history: Record<string, HistoryAccounts> = {};
  for (const { url } of funds) {
    const acc = parseAccounts(rawH[url]);
    if (Object.keys(acc).length) history[url] = acc;
  }
  return { v: 1, exportedAt: typeof o.exportedAt === 'number' ? o.exportedAt : 0, funds, history };
}

/** 복원 = 합치기(멱등). 로컬에 없는 URL 만 새 id 로 추가(한도 초과는 건너뜀), 기록은 recordedAt 늦은 쪽. */
export function mergeBackup(local: LocalData, backup: Backup, newId: () => string): MergeResult {
  const funds = [...local.funds];
  let addedFunds = 0;
  let skippedFunds = 0;
  for (const f of backup.funds) {
    if (funds.some((x) => x.url === f.url)) continue;
    if (funds.length >= MAX_FUNDS) {
      skippedFunds++;
      continue;
    }
    funds.push({ id: newId(), name: f.name, url: f.url });
    addedFunds++;
  }
  const histories = { ...local.histories };
  let mergedPoints = 0;
  for (const { url } of funds) {
    const extra = own(backup.history, url);
    if (!extra) continue;
    const r = mergeAccounts(own(histories, url) ?? {}, extra);
    histories[url] = r.accounts;
    mergedPoints += r.changed;
  }
  return { funds, histories, addedFunds, skippedFunds, mergedPoints };
}

/** 기기 로컬 날짜 키(자동 백업 하루 1번 판단용) */
export const localDayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export const shouldAutoBackup = (lastBackupAt: number | null, now: number): boolean =>
  lastBackupAt === null || localDayKey(lastBackupAt) !== localDayKey(now);
