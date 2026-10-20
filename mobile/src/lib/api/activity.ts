/**
 * 진행 중인 API 요청 수 — 화면 상단 진행 표시줄(<ApiProgressBar/>)이 구독한다.
 * http.ts(REST)·graphql.ts(stock_api) 두 관문에서 감싸므로 모든 API 호출이 잡힌다.
 * 재시도(withRetry)는 바깥에서 한 번만 감싸 대기 시간 동안에도 표시가 이어진다.
 */
type Listener = (busy: boolean) => void;

let pending = 0;
const listeners = new Set<Listener>();

function emit(busy: boolean): void {
  listeners.forEach((l) => l(busy));
}

/** 요청 시작을 알리고, 끝낼 때 부를 함수를 돌려준다(여러 번 불러도 한 번만 반영). */
export function beginRequest(): () => void {
  pending += 1;
  if (pending === 1) emit(true);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending -= 1;
    if (pending === 0) emit(false);
  };
}

/** 프로미스가 끝날 때까지(성공·실패 모두) 진행 중으로 센다. */
export async function trackRequest<T>(run: () => Promise<T>): Promise<T> {
  const end = beginRequest();
  try {
    return await run();
  } finally {
    end();
  }
}

export function isApiBusy(): boolean {
  return pending > 0;
}

/** 진행 여부 변화 구독 — 해제 함수를 돌려준다. */
export function subscribeApiBusy(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
