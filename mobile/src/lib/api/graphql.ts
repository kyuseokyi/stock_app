/**
 * stock_api(Strawberry GraphQL) 클라이언트.
 * searchStocks / getChartData 등 주식·지수 데이터 조회에 사용.
 * 로그인 상태면 접근 토큰을 붙인다 — A안(시세 비노출)에서 서버는 스위치가 꺼져 있어도 관리자·시세 열람 권한 회원에게는
 * 시세를 준다(설계 docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-2). 비로그인이면 그대로.
 * stock_api 는 토큰이 만료·무효여도 401 을 주지 않고 익명으로 처리하므로 여기서는 401 처리를 하지 않는다.
 * (시세 REST 는 lib/api/http 의 stockApi 가 이미 토큰을 붙인다.)
 */
import { GraphQLClient, type Variables } from 'graphql-request';

import { ENV } from '@/lib/env';

import { trackRequest } from './activity';
import { getAuthToken } from './auth-token';
import { isGraphqlQuery, withRetry } from './retry';
import { getFreshAccessToken } from './token-refresh';

export const stockGraphqlClient = new GraphQLClient(ENV.stockGraphqlUrl);

/** 타입 지정 요청 헬퍼. document는 gql 문자열 또는 TypedDocumentNode. */
/** 요청 직전 토큰 헤더 — 만료 임박이면 먼저 갱신(실패해도 현재 토큰), 로그아웃 상태면 빈 객체 */
async function authHeaders(): Promise<Record<string, string>> {
  let token: string | null;
  try {
    token = await getFreshAccessToken();
  } catch {
    token = getAuthToken();
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function stockRequest<T, V extends Variables = Variables>(
  document: string,
  variables?: V,
): Promise<T> {
  // 재시도 때마다 토큰을 다시 읽는다(그사이 갱신됐으면 새 토큰)
  const run = async () => stockGraphqlClient.request<T>({ document, variables, requestHeaders: await authHeaders() });
  // 조회(query)만 배포 순간 공백에 짧게 재시도 — mutation 은 그대로(중복 실행 방지)
  return trackRequest(() => (isGraphqlQuery(document) ? withRetry(run) : run()));
}
