// 펀드 히스토리 저장 = 앱 문서 폴더의 펀드별 JSON 파일(fund-history-<id>.json). 병합·검증은 core/history.
import { File, Paths } from 'expo-file-system';

import {
  emptyHistory,
  mergePoint,
  parseHistory,
  snapshotOf,
  type FundEntry,
  type FundHistory,
  type FundReport,
  type HistoryAccounts,
} from './core';

const historyFile = (id: string): File => new File(Paths.document, `fund-history-${id}.json`);

/** 읽기 실패는 던진다 — 기록·백업이 빈 값으로 덮어쓰지 않도록. 깨진 내용은 core 가 비운다. */
async function readHistory(f: FundEntry): Promise<FundHistory> {
  const file = historyFile(f.id);
  return parseHistory(file.exists ? await file.text() : null, f.url);
}

/** 화면용 — 실패하면 빈 기록 */
export async function loadHistory(f: FundEntry): Promise<FundHistory> {
  try {
    return await readHistory(f);
  } catch {
    return emptyHistory(f.url);
  }
}

function writeHistory(id: string, h: FundHistory): void {
  const file = historyFile(id);
  if (!file.exists) file.create();
  file.write(JSON.stringify(h));
}

/** 새로 가져온 리포트를 기록. 새 날짜가 생겼으면 true(자동 백업 신호). 실패는 false — 리포트 표시는 막지 않는다. */
export async function recordSnapshot(f: FundEntry, report: FundReport, recordedAt: number): Promise<boolean> {
  const snap = snapshotOf(report, recordedAt);
  if (!snap) return false;
  try {
    const { history, added } = mergePoint(await readHistory(f), snap);
    writeHistory(f.id, history);
    return added;
  } catch {
    return false;
  }
}

/** 백업·복원용 — url → 기록. 하나라도 못 읽으면 던진다(빈 기록으로 Drive 를 덮지 않도록). */
export async function loadAllHistories(funds: FundEntry[]): Promise<Record<string, HistoryAccounts>> {
  const out: Record<string, HistoryAccounts> = {};
  for (const f of funds) out[f.url] = (await readHistory(f)).accounts;
  return out;
}

/** 복원 결과 쓰기 — funds 의 id 로 각 파일을 쓴다 */
export function writeHistories(funds: FundEntry[], histories: Record<string, HistoryAccounts>): void {
  for (const f of funds) {
    const accounts = histories[f.url];
    if (accounts) writeHistory(f.id, { v: 1, url: f.url, accounts });
  }
}

export function deleteHistory(id: string): void {
  try {
    const file = historyFile(id);
    if (file.exists) file.delete();
  } catch {
    // 지우지 못해도 목록에서 빠졌으니 다시 읽히지 않는다
  }
}
