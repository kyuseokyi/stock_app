/**
 * stock_api REST 기본 주소 — GraphQL 주소(VITE_STOCK_API_URL)에서 끝의 '/graphql'(과 끝 슬래시)을 뗀 값.
 * REST 전용 환경변수를 따로 두지 않으려고 같은 서버의 GraphQL 주소에서 만든다(앱 deriveStockApiUrl 과 같은 규칙).
 * 배포 웹은 같은 도메인 프록시라 상대 주소다: '/_api/stock/graphql' → '/_api/stock'
 */
export function deriveStockApiUrl(graphqlUrl: string): string {
  return graphqlUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/graphql$/i, '')
    .replace(/\/+$/, '')
}
