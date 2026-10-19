/**
 * stock_api(Strawberry GraphQL) 클라이언트.
 * searchStocks / getChartData 등 주식·지수 데이터 조회에 사용.
 */
import { GraphQLClient, type Variables } from 'graphql-request';

import { ENV } from '@/lib/env';

import { isGraphqlQuery, withRetry } from './retry';

export const stockGraphqlClient = new GraphQLClient(ENV.stockGraphqlUrl);

/** 타입 지정 요청 헬퍼. document는 gql 문자열 또는 TypedDocumentNode. */
export function stockRequest<T, V extends Variables = Variables>(
  document: string,
  variables?: V,
): Promise<T> {
  const run = () => stockGraphqlClient.request<T>(document, variables);
  // 조회(query)만 배포 순간 공백에 짧게 재시도 — mutation 은 그대로(중복 실행 방지)
  return isGraphqlQuery(document) ? withRetry(run) : run();
}
