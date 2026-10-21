// 백그라운드 기록 본문 — push·정기 태스크가 공유. 실제 갱신은 1단계 자동 갱신과 같은 fundRefresher.run().
export type RunReason = "push" | "periodic";
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

const defaultSleep = (ms: number) =>
  new Promise<void>((res) => setTimeout(res, ms));

export async function backgroundRecordWith(
  reason: RunReason,
  d: RunDeps,
): Promise<"skipped" | "done" | "timeout"> {
  // 한도 타이머는 맨 앞에서 시작 — hydrate(저장소 읽기)가 멈춰도 함수가 끝나게 한다
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<"timeout">((res) => {
    timer = setTimeout(() => {
      timedOut = true;
      res("timeout");
    }, d.timeoutMs ?? BACKGROUND_TIMEOUT_MS);
  });

  // 표시(enter)는 hydrate·로그인 확인 뒤, 실제 갱신을 시작하는 시점에 켠다 — hydrate 중에는 갱신이 없으므로 표시할 것이 없고,
  // 멈춘 hydrate 때문에 표시가 영영 켜져 있는 일도 없다. 한도 뒤에 hydrate 가 풀려도 갱신을 시작하지 않는다.
  // 켠 표시는 한도 시점이 아니라 실행이 실제로 끝날 때 끈다(늦게 끝난 실행이 백그라운드에서 백업하지 않게). leave 는 정확히 1회.
  const work = Promise.resolve()
    .then(async (): Promise<"skipped" | "done"> => {
      await d.hydrate(); // 화면 없이 깨어나면 로그인 정보가 아직 안 읽혔을 수 있다
      if (timedOut || !d.isLoggedIn()) return "skipped";
      const leave = d.enter();
      try {
        const jitter =
          reason === "push"
            ? Math.floor((d.random ?? Math.random)() * PUSH_JITTER_MS)
            : 0;
        if (jitter > 0) await (d.sleep ?? defaultSleep)(jitter);
        await d.run({ force: reason === "push" });
      } catch {
        // 실패해도 done
      } finally {
        leave();
      }
      return "done";
    })
    .catch(() => "skipped" as const); // hydrate·isLoggedIn·enter 실패 — 어떤 실패도 reject 로 새지 않는다

  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}
