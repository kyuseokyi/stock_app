// 알림 탭 처리 — 순수 로직
export const FUND_CHANNEL_ID = 'fund-report';

export function isFundNotification(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'fund_report';
}

export function handleNotificationResponseWith(
  data: unknown,
  deps: { navigate: (path: '/fund') => void; refresh: () => void },
): boolean {
  if (!isFundNotification(data)) return false;
  deps.navigate('/fund');
  deps.refresh();
  return true;
}

/** 같은 알림 응답을 한 번만 처리하게 하는 판정. 저장소는 한 번만 읽고, await 이후 비교·갱신은 동기로 처리한다 */
export function createResponseClaimer(
  load: () => Promise<string | null>,
  save: (id: string) => void,
): (id: string) => Promise<boolean> {
  let loaded: Promise<string | null> | undefined;
  let last: string | null | undefined;
  return async (id) => {
    loaded ??= load().catch(() => null);
    const stored = await loaded;
    if (last === undefined) last = stored;
    if (last === id) return false;
    last = id;
    save(id);
    return true;
  };
}
