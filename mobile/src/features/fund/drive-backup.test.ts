import { BACKUP_FILE } from './core';
import {
  accountBackupFile,
  downloadBackup,
  findBackupId,
  isDriveError,
  LEGACY_BACKUP_FILE,
  uploadBackup,
  type DriveDeps,
} from './drive-backup';

type Call = { url: string; init: RequestInit };
type Fake = { status: number; body: string };

const res = (f: Fake) =>
  ({
    ok: f.status >= 200 && f.status < 300,
    status: f.status,
    json: async () => JSON.parse(f.body),
    text: async () => f.body,
  }) as unknown as Response;
const json = (o: unknown, status = 200): Fake => ({ status, body: JSON.stringify(o) });

function mockDrive(routes: Record<string, Fake>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return res(routes[key]);
  }) as unknown as typeof fetch;
  const deps: DriveDeps = { getAccessToken: async () => 'TOKEN', fetchImpl };
  return { calls, deps };
}
const LIST = 'https://www.googleapis.com/drive/v3/files?';

describe('drive-backup', () => {
  it('찾기 — appDataFolder, q 인코딩, fields 지정, Bearer 토큰', async () => {
    const { calls, deps } = mockDrive({ [LIST]: json({ files: [{ id: 'F1' }] }) });
    expect(await findBackupId(deps)).toBe('F1');
    expect(calls[0].url).toContain('spaces=appDataFolder');
    expect(calls[0].url).toContain(`q=${encodeURIComponent(`name='${BACKUP_FILE}' and trashed=false`)}`);
    expect(calls[0].url).toContain(`fields=${encodeURIComponent('files(id)')}`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
  });

  it('받기 — 파일 없으면 null, 있으면 alt=media 본문', async () => {
    expect(await downloadBackup(mockDrive({ [LIST]: json({ files: [] }) }).deps)).toBeNull();
    const { calls, deps } = mockDrive({
      [LIST]: json({ files: [{ id: 'F1' }] }),
      'https://www.googleapis.com/drive/v3/files/F1?alt=media': { status: 200, body: '{"v":1}' },
    });
    expect(await downloadBackup(deps)).toBe('{"v":1}');
    expect(calls[1].url).toBe('https://www.googleapis.com/drive/v3/files/F1?alt=media');
  });

  it('올리기(새 파일) — POST multipart/related, parents=appDataFolder', async () => {
    const { calls, deps } = mockDrive({
      [LIST]: json({ files: [] }),
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart': json({ id: 'NEW' }),
    });
    await uploadBackup(deps, '{"v":1}');
    const up = calls[1];
    expect(up.init.method).toBe('POST');
    expect((up.init.headers as Record<string, string>)['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    const body = String(up.init.body);
    expect(body).toContain(JSON.stringify({ name: BACKUP_FILE, parents: ['appDataFolder'] }));
    expect(body).toContain('{"v":1}');
  });

  it('올리기(기존 파일) — PATCH, parents 없음', async () => {
    const { calls, deps } = mockDrive({
      [LIST]: json({ files: [{ id: 'F1' }] }),
      'https://www.googleapis.com/upload/drive/v3/files/F1?uploadType=multipart': json({ id: 'F1' }),
    });
    await uploadBackup(deps, '{"v":1}');
    expect(calls[1].init.method).toBe('PATCH');
    expect(String(calls[1].init.body)).not.toContain('parents');
  });

  it('401/403 은 auth, 그 외 실패·네트워크는 network', async () => {
    const e401 = await findBackupId(mockDrive({ [LIST]: json({}, 401) }).deps).catch((e: unknown) => e);
    expect(isDriveError(e401, 'auth')).toBe(true);
    const e500 = await findBackupId(mockDrive({ [LIST]: json({}, 500) }).deps).catch((e: unknown) => e);
    expect(isDriveError(e500, 'network')).toBe(true);
    const deps: DriveDeps = {
      getAccessToken: async () => 'T',
      fetchImpl: (async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch,
    };
    expect(isDriveError(await findBackupId(deps).catch((e: unknown) => e), 'network')).toBe(true);
  });
});

describe('drive-backup 파일 이름', () => {
  it('계정별 이름으로 찾고 새로 만든다', async () => {
    const { calls, deps } = mockDrive({
      [LIST]: json({ files: [] }),
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart': json({ id: 'NEW' }),
    });
    await uploadBackup(deps, '{"v":1}', accountBackupFile(7));
    expect(accountBackupFile(7)).toBe('fund-backup-v1-u7.json');
    expect(calls[0].url).toContain(encodeURIComponent(`name='fund-backup-v1-u7.json' and trashed=false`));
    expect(String(calls[1].init.body)).toContain(
      JSON.stringify({ name: 'fund-backup-v1-u7.json', parents: ['appDataFolder'] }),
    );
  });

  it('이름을 안 주면 옛 파일(fund-backup-v1.json)', async () => {
    expect(LEGACY_BACKUP_FILE).toBe('fund-backup-v1.json');
    const { calls, deps } = mockDrive({ [LIST]: json({ files: [] }) });
    expect(await downloadBackup(deps)).toBeNull();
    expect(calls[0].url).toContain(encodeURIComponent(`name='fund-backup-v1.json' and trashed=false`));
  });
});
