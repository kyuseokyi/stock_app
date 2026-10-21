/**
 * Expo 권한 응답 → 실제 의미. Android 13+ 는 한 번도 안 물은 알림 권한도 status 'denied' 로 준다
 * (areNotificationsEnabled()=false 면 무조건 denied). 다시 물을 수 있으면(canAskAgain) 아직 미결정이다.
 */
export function effectivePermission(p: { status: string; canAskAgain: boolean }): 'granted' | 'denied' | 'undetermined' {
  if (p.status === 'granted') return 'granted';
  if (p.status === 'denied' && !p.canAskAgain) return 'denied';
  return 'undetermined';
}

/** 펀드 첫 등록(0→1) 직후, 푸시가 설정돼 있고 아직 물어본 적 없을 때만 안내 시트를 띄운다 */
export function shouldOfferPrompt(s: {
  prevCount: number;
  nextCount: number;
  configured: boolean;
  prompted: boolean;
}): boolean {
  return s.configured && !s.prompted && s.prevCount === 0 && s.nextCount > 0;
}

/** 펀드 화면 진입 시: 펀드가 이미 있고 한 번도 안 물어봤으며 OS 권한이 미결정일 때만 안내 시트를 띄운다 */
export function shouldPromptOnEnter(s: {
  fundCount: number;
  prompted: boolean;
  permission: string;
  configured: boolean;
}): boolean {
  return s.configured && s.fundCount >= 1 && !s.prompted && s.permission === 'undetermined';
}

/** 내정보 스위치에 보일 값 — 설정이 켜져 있어도 OS 권한이 없으면 실제로 못 받으므로 꺼짐으로 보인다 */
export function postNoticeSwitchValue(saved: boolean, permission: 'granted' | 'denied' | 'undetermined'): boolean {
  return saved && permission === 'granted';
}

/** 내정보 "새 글 알림"을 켤 때 할 일: 허용됨 → 저장만, 미결정 → OS 권한 요청, 다시 물을 수 없는 거부 → 설정 앱 안내 */
export function postNoticeEnableAction(
  permission: 'granted' | 'denied' | 'undetermined',
): 'none' | 'request' | 'open-settings' {
  if (permission === 'granted') return 'none';
  if (permission === 'undetermined') return 'request';
  return 'open-settings';
}

/** 로그인 후 홈 탭: 푸시 설정됨 + 아직 안 물어봄 + OS 권한 미결정이면 안내 시트(펀드 없어도). 기록은 펀드 경로와 공유 */
export function shouldPromptOnHome(s: {
  loggedIn: boolean;
  prompted: boolean;
  permission: string;
  configured: boolean;
}): boolean {
  return s.configured && s.loggedIn && !s.prompted && s.permission === 'undetermined';
}
