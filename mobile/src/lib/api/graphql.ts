/**
 * stock_api(Strawberry GraphQL) 클라이언트.
 * searchStocks / getChartData 등 주식·지수 데이터 조회에 사용.
 */
import { GraphQLClient, type Variables } from 'graphql-request';

import { ENV } from '@/lib/env';

export const stockGraphqlClient = new GraphQLClient(ENV.stockGraphqlUrl);

/** 타입 지정 요청 헬퍼. document는 gql 문자열 또는 TypedDocumentNode. */
export function stockRequest<T, V extends Variables = Variables>(
  document: string,
  variables?: V,
): Promise<T> {
  return stockGraphqlClient.request<T>(document, variables);
}
