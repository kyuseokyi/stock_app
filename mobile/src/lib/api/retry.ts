/**
 * 배포·재시작 순간의 짧은 공백(연결 실패·502/503/504)을 가리는 조회 재시도(웹 web_client/src/lib/retry.ts 와 같은 규칙).
 * 조회만 다시 보낸다 — REST GET 과 GraphQL query. 주문·보상·글쓰기 같은 쓰기(POST·mutation)는
 * 서버가 이미 처리했을 수 있어 두 번 실행될 위험이 있으므로 절대 재시도하지 않는다.
 * 우리 타임아웃(REQUEST_TIMEOUT_MS)으로 끊은 요청도 다시 보내지 않는다(이미 오래 기다렸다).
 */

export const RETRY_DELAYS_MS = [1000, 3000, 6000]; // 최대 3번, 합 10초
const RETRY_STATUS = new Set([502, 503, 504]);

/** 일시적 장애인가 — RN fetch 의 연결 실패(TypeError: Network request failed) 또는 502/503/504 응답 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const e = err as { status?: unknown; response?: { status?: unknown } } | null;
  const status = e?.status ?? e?.response?.status;
  return typeof status === 'number' && RETRY_STATUS.has(status);
}

/** GraphQL 문서가 조회(query)인가 — mutation·subscription 이면 false */
export function isGraphqlQuery(document: string): boolean {
  const head = document.replace(/#[^\n]*/g, '').trimStart();
  return !/^(mutation|subscription)\b/.test(head);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** fn 을 실행하고, 일시적 장애면 RETRY_DELAYS_MS 간격으로 다시 시도한다 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isTransientError(err)) throw err;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}
