// 정기 백그라운드 작업 등록·해제 판단(로그인 + 펀드 ≥1 일 때만). 푸시 설정·권한과는 무관.
export type PeriodicDeps = {
  want: boolean;
  available: () => Promise<boolean>; // OS 가 백그라운드 작업을 허용하는지
  isRegistered: () => Promise<boolean>;
  register: () => Promise<void>;
  unregister: () => Promise<void>;
};

export type PeriodicResult =
  'registered' | 'unregistered' | 'unchanged' | 'unavailable' | 'failed';

export async function syncPeriodicTaskWith(
  d: PeriodicDeps,
): Promise<PeriodicResult> {
  try {
    const has = await d.isRegistered();
    if (!d.want) {
      if (!has) return 'unchanged';
      await d.unregister();
      return 'unregistered';
    }
    if (has) return 'unchanged';
    if (!(await d.available())) return 'unavailable';
    await d.register();
    return 'registered';
  } catch {
    return 'failed'; // 다음 동기화 시점(앱 실행·펀드 추가/삭제·로그인)에 다시
  }
}
