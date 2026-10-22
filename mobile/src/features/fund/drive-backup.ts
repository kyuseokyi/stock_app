// Google Drive REST(앱 전용 폴더 appDataFolder) — 백업 파일 하나를 찾고·받고·올린다. 서버 경유 없음.
// 파일 이름은 앱 계정별(accountBackupFile). 이름을 안 주면 계정별 저장 전 옛 파일(core BACKUP_FILE).
// 토큰·fetch 는 주입(테스트에서 네이티브 로그인 모듈을 불러오지 않도록 google-auth 를 import 하지 않는다).
import { BACKUP_FILE } from './core';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
// JSON.stringify 결과엔 줄바꿈이 없어 본문에 "\r\n--경계" 가 생길 수 없다
const BOUNDARY = 'fund_backup_part';

export type DriveErrorCode = 'auth' | 'network' | 'invalid';
export type DriveError = Error & { driveCode: DriveErrorCode };

export const driveError = (code: DriveErrorCode, message: string): DriveError =>
  Object.assign(new Error(message), { driveCode: code });

export function isDriveError(e: unknown, code?: DriveErrorCode): e is DriveError {
  return e instanceof Error && 'driveCode' in e && (code === undefined || (e as DriveError).driveCode === code);
}

/** 앱 계정별 백업 파일 이름 — 같은 Google 계정을 여러 앱 계정이 써도 섞이지 않게 */
export const accountBackupFile = (uid: number): string => `fund-backup-v1-u${uid}.json`;
export const LEGACY_BACKUP_FILE = BACKUP_FILE;

export type DriveDeps = { getAccessToken: () => Promise<string>; fetchImpl?: typeof fetch };

async function call(deps: DriveDeps, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await deps.getAccessToken();
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(url, {
      ...init,
      headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw driveError('network', 'Drive 에 연결하지 못했어요');
  }
  if (res.status === 401 || res.status === 403) throw driveError('auth', `Drive 권한 오류 ${res.status}`);
  if (!res.ok) throw driveError('network', `Drive 응답 ${res.status}`);
  return res;
}

export async function findBackupId(deps: DriveDeps, name: string = BACKUP_FILE): Promise<string | null> {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const fields = encodeURIComponent('files(id)');
  const res = await call(deps, `${FILES}?spaces=appDataFolder&q=${q}&fields=${fields}&pageSize=1`);
  const d = (await res.json()) as { files?: { id?: string }[] };
  return d.files?.[0]?.id ?? null;
}

/** 백업 본문(문자열). 파일이 없으면 null. */
export async function downloadBackup(deps: DriveDeps, name: string = BACKUP_FILE): Promise<string | null> {
  const id = await findBackupId(deps, name);
  if (!id) return null;
  const res = await call(deps, `${FILES}/${encodeURIComponent(id)}?alt=media`);
  return res.text();
}

const multipart = (meta: object, body: string): string =>
  [
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(meta),
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    body,
    `--${BOUNDARY}--`,
    '',
  ].join('\r\n');

/** 있으면 갱신(PATCH), 없으면 appDataFolder 에 생성(POST). parents 를 빠뜨리면 사용자 내 드라이브에 보이게 생긴다. */
export async function uploadBackup(deps: DriveDeps, json: string, name: string = BACKUP_FILE): Promise<void> {
  const id = await findBackupId(deps, name);
  const headers = { 'Content-Type': `multipart/related; boundary=${BOUNDARY}` };
  if (id) {
    await call(deps, `${UPLOAD}/${encodeURIComponent(id)}?uploadType=multipart`, {
      method: 'PATCH',
      headers,
      body: multipart({}, json),
    });
  } else {
    await call(deps, `${UPLOAD}?uploadType=multipart`, {
      method: 'POST',
      headers,
      body: multipart({ name, parents: ['appDataFolder'] }, json),
    });
  }
}
