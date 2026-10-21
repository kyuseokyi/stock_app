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
