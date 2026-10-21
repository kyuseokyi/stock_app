// 백그라운드 기록 본문 — push·정기 태스크가 공유. 실제 갱신은 1단계 자동 갱신과 같은 fundRefresher.run().
export type RunReason = 'push' | 'periodic';
export type RunDeps = {
  hydrate: () => Promise<void>;
  isLoggedIn: () => boolean;
  run: (opts: { force: boolean }) => Promise<void>;
  enter: () => () => void; // 백그라운드 표시 켜기 → 끄기 함수
  timeoutMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export const BACKGROUND_TIMEOUT_MS = 25_000; // iOS 는 약 30초 안에 끝내야 한다
// 관리자 발송 한 번에 모든 기기가 깨어나므로 원본 사이트 부하를 나눈다(SSE 는 0~30초, 여기선 25초 한도 안에서 0~10초)
export const PUSH_JITTER_MS = 10_000;

const defaultSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export async function backgroundRecordWith(
  reason: RunReason,
  d: RunDeps,
): Promise<'skipped' | 'done' | 'timeout'> {
  try {
    await d.hydrate(); // 화면 없이 깨어나면 로그인 정보가 아직 안 읽혔을 수 있다
  } catch {
    return 'skipped';
  }
  if (!d.isLoggedIn()) return 'skipped';

  const leave = d.enter();
  const jitter = reason === 'push' ? Math.floor((d.random ?? Math.random)() * PUSH_JITTER_MS) : 0;
  // 표시는 한도 시점이 아니라 실행이 실제로 끝날 때 끈다 — 늦게 끝난 실행이 백그라운드에서 백업하지 않게
  const work = (jitter > 0 ? (d.sleep ?? defaultSleep)(jitter) : Promise.resolve())
    .then(() => d.run({ force: reason === 'push' }))
    .catch(() => {})
    .finally(leave)
    .then(() => 'done' as const);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<'timeout'>((res) => {
    timer = setTimeout(() => res('timeout'), d.timeoutMs ?? BACKGROUND_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}
