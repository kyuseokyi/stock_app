// 펀드 리포트 갱신 신호(SSE) — 순수 로직. 연결은 로그인 + 앞 화면 + 펀드 ≥1 일 때만.
export const FUND_SIGNAL_JITTER_MS = 30_000;

/** SSE data(JSON) 에서 fund_report_updated 의 날짜만 꺼낸다. 그 외·깨진 값은 null */
export function parseFundSignal(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { type?: unknown; date?: unknown };
    return v.type === 'fund_report_updated' && typeof v.date === 'string' ? v.date : null;
  } catch {
    return null;
  }
}

export type SignalState = { loggedIn: boolean; active: boolean };
export type SignalDeps = {
  /** 연결을 열고, 닫는 함수를 돌려준다 */
  open: () => () => void;
  countFunds: () => Promise<number>;
};

export function createSignalController(deps: SignalDeps) {
  let close: (() => void) | null = null;
  let seq = 0; // 늦게 끝난 countFunds 가 최신 상태를 덮지 않게

  const stop = () => {
    close?.();
    close = null;
  };

  return {
    async update(s: SignalState): Promise<void> {
      const my = ++seq;
      if (!s.loggedIn || !s.active) {
        stop();
        return;
      }
      if (close) return;
      const count = await deps.countFunds().catch(() => 0);
      if (my !== seq || close) return;
      if (count > 0) close = deps.open();
    },
    dispose() {
      seq++; // 대기 중인 countFunds 가 끝나도 open 하지 않게
      stop();
    },
  };
}

export type SchedulerDeps = {
  run: () => void;
  /** 지연(ms) 후 fn 실행을 예약하고 취소 함수를 돌려준다 */
  schedule: (fn: () => void, ms: number) => () => void;
  random?: () => number;
};

/**
 * 신호 → 0~30초 지연 후 force 갱신. 대기 중이면 새 신호 무시(중복 방지).
 * 연결을 닫을 때 대기 중이던 신호는 "놓친 신호"로 기억했다가, 다음 연결 때 지연 없이 바로 실행한다.
 */
export function createSignalScheduler(deps: SchedulerDeps) {
  let cancel: (() => void) | null = null;
  let missed = false;
  const rnd = deps.random ?? Math.random;
  return {
    signal(): void {
      if (cancel) return;
      cancel = deps.schedule(() => {
        cancel = null;
        deps.run();
      }, rnd() * FUND_SIGNAL_JITTER_MS);
    },
    /** 연결을 닫을 때 */
    stop(): void {
      if (cancel) {
        cancel();
        cancel = null;
        missed = true;
      }
    },
    /** 연결을 열 때 */
    start(): void {
      if (missed) {
        missed = false;
        deps.run();
      }
    },
  };
}
