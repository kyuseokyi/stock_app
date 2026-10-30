/**
 * stock_api REST 기본 주소 — GraphQL 주소(EXPO_PUBLIC_STOCK_GRAPHQL_URL)에서 끝의 '/graphql'(과 끝 슬래시)을 뗀 값.
 * REST 전용 env 키를 따로 두지 않으려고 같은 서버(stock_api)의 GraphQL 주소에서 만든다.
 * 예: 'https://api.example.com/graphql/' → 'https://api.example.com'
 */
export function deriveStockApiUrl(graphqlUrl: string): string {
  return graphqlUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/graphql$/i, '')
    .replace(/\/+$/, '');
}
