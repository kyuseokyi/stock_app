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
