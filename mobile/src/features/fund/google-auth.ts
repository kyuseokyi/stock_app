// 네이티브 Google 로그인(기기 계정 선택) — Drive 앱 전용 폴더(drive.appdata) 권한만 받는다.
// 토큰은 모듈이 관리하고 호출할 때마다 받아 쓴다(우리 저장소에 토큰을 두지 않는다). dev build 전용.
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { driveError } from './drive-backup';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

/** OAuth 클라이언트 ID 가 빌드에 들어갔는지 — 없으면 백업 화면은 '설정 필요'만 보여준다 */
export const isBackupConfigured = (): boolean => WEB_CLIENT_ID !== '';

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: [DRIVE_SCOPE] });
  configured = true;
}

/** 계정 선택 → drive.appdata 권한 확인. 취소·거절하면 null, 성공하면 이메일. */
export async function connect(): Promise<string | null> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  if (res.type !== 'success') return null;
  if (!res.data.scopes.includes(DRIVE_SCOPE)) {
    // addScopes 는 취소 시 { type: 'cancelled' }, 진행 불가 시 null
    const added = await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
    if (!added || added.type !== 'success') return null;
  }
  return res.data.user.email;
}

/** Drive 호출용 access token. 로그인 정보가 없거나 끊겼으면 DriveError('auth'). */
export async function accessToken(): Promise<string> {
  ensureConfigured();
  try {
    if (!GoogleSignin.getCurrentUser()) {
      const r = await GoogleSignin.signInSilently();
      if (r.type !== 'success') throw new Error('no saved credential');
    }
    return (await GoogleSignin.getTokens()).accessToken;
  } catch {
    throw driveError('auth', 'Google 로그인이 필요해요');
  }
}

/** 연결 해제 — 권한 반납 + 로그아웃. Drive 의 백업 파일은 남는다. */
export async function disconnect(): Promise<void> {
  ensureConfigured();
  try {
    await GoogleSignin.revokeAccess();
  } catch {
    // 이미 끊겼어도 로그아웃은 진행
  }
  await GoogleSignin.signOut();
}
