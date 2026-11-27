import { QueryClient } from '@tanstack/react-query';

/**
 * 앱 공용 TanStack Query 클라이언트(웹 web_client/src/lib/queryClient.ts 와 같은 기본값, RN 에 맞춘 차이만 둠).
 * - 재시도 0: lib/api/retry.ts 가 조회를 502/503/504·네트워크 오류에 최대 3번(합 10초) 이미 재시도한다.
 *   Query 까지 재시도하면 곱해져 실패 안내가 늦어진다.
 * - 창 포커스·재연결 재조회 끔: 앱은 복귀 재조회(useReturnRefresh)·자동 갱신을 따로 한다.
 * - networkMode 'always': NetInfo(네이티브 → APK 재빌드 필요)를 붙이지 않았으니 온라인 판정에 기대지 않고
 *   요청을 그냥 보내 실패하게 둔다(Query 도입 전 fetch 와 같은 동작). 'online' 이면 오프라인 추정 시 요청이 멈춘 채 대기한다.
 * - 401 은 lib/api/http.ts(토큰 갱신·세션 종료)가 처리한다.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
        staleTime: 30_000,
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

let client: QueryClient | undefined;

/** 앱 전체에서 하나를 쓴다(RN 은 서버 렌더가 없어 요청별 분리가 필요 없다). */
export function getQueryClient(): QueryClient {
  return (client ??= makeQueryClient());
}
