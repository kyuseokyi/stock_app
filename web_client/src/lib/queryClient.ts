import { QueryClient } from '@tanstack/react-query'

// HTTP 상태 — axios 오류는 response.status, 그 밖(네트워크·시간 초과)은 undefined
function statusOf(err: unknown): number | undefined {
  const s = (err as { response?: { status?: unknown } } | null)?.response?.status
  return typeof s === 'number' ? s : undefined
}

/** 4xx(시세 비노출 403·404·검증 422 등)는 다시 물어도 같은 답이라 재시도하지 않는다. 5xx·네트워크는 maxRetries 회(기본 1). */
export function shouldRetry(failureCount: number, err: unknown, maxRetries = 1): boolean {
  const s = statusOf(err)
  if (s !== undefined && s >= 400 && s < 500) return false
  return failureCount < maxRetries
}

// web 은 main.tsx 의 axios installRetry 가 조회(GET·GraphQL query)를 502/503/504·네트워크 오류에 최대 3번(합 10초) 이미 재시도한다.
// Query 까지 재시도하면 곱해져(최대 8요청·약 20초) 실패 안내가 늦게 뜨므로 Query 재시도는 끈다(4xx·5xx·네트워크 모두 0회).
const QUERY_MAX_RETRIES = 0

/** 요청마다 새 클라이언트 — SSR(서버)에서는 요청 간 캐시가 섞이지 않게 매번 새로 만든다. 401 은 axios 인터셉터가 처리한다. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, err) => shouldRetry(failureCount, err, QUERY_MAX_RETRIES),
        refetchOnWindowFocus: false,
        // Query 도입 전에는 네트워크 재연결 때 다시 받지 않았다 — 같은 동작으로 끈다
        refetchOnReconnect: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  })
}

let browserClient: QueryClient | undefined

/** 서버(window 없음)는 매번 새로, 브라우저는 하나를 재사용 — 나중에 HydrationBoundary 를 붙일 때 그대로 쓴다. */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient()
  return (browserClient ??= makeQueryClient())
}
