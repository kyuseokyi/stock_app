// 알림 탭·표시 처리 — 순수 로직
export const FUND_CHANNEL_ID = 'fund-report';
export const POST_CHANNEL_ID = 'blog-post'; // 서버 collector/tasks/notifications.NEW_POST_CHANNEL_ID 와 같은 값

export type PushRoute = '/fund' | `/blog/${number}`;

const typeOf = (data: unknown): unknown =>
  typeof data === 'object' && data !== null ? (data as { type?: unknown }).type : undefined;

export function isFundNotification(data: unknown): boolean {
  return typeOf(data) === 'fund_report';
}

/** 새 글 알림의 글 id — 양의 정수(플랫폼별 직렬화 차이 대비 숫자 문자열 허용)일 때만, 아니면 null */
export function newPostIdOf(data: unknown): number | null {
  if (typeOf(data) !== 'new_post') return null;
  const raw = (data as { post_id?: unknown }).post_id;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** 탭: 새 글 → /blog/{id}, 펀드 리포트 → /fund + 강제 갱신. 처리했으면 true */
export function handleNotificationResponseWith(
  data: unknown,
  deps: { navigate: (path: PushRoute) => void; refresh: () => void },
): boolean {
  const postId = newPostIdOf(data);
  if (postId !== null) {
    deps.navigate(`/blog/${postId}`);
    return true;
  }
  if (!isFundNotification(data)) return false;
  deps.navigate('/fund');
  deps.refresh();
  return true;
}

/** 앱이 앞에 있을 때 배너: 새 글만(앱엔 새 글 SSE 토스트가 없음). 펀드는 SSE·자동 갱신이 이미 반영 */
export function shouldShowForegroundBanner(data: unknown): boolean {
  return newPostIdOf(data) !== null;
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
