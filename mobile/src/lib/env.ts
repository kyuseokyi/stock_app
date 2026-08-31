/**
 * 앱 환경변수 단일 접근점.
 * EXPO_PUBLIC_ 변수는 빌드 시 인라인된다(.env.development / .env.production).
 * MSA라 서비스별 base URL이 분리돼 있다(운영은 Nginx가 한 호스트로 통합).
 */
export const ENV = {
  appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
  stockGraphqlUrl: process.env.EXPO_PUBLIC_STOCK_GRAPHQL_URL ?? 'http://localhost:8002/graphql',
  blogApiUrl: process.env.EXPO_PUBLIC_BLOG_API_URL ?? 'http://localhost:8000',
  authApiUrl: process.env.EXPO_PUBLIC_AUTH_API_URL ?? 'http://localhost:8001',
} as const;

export const isDev = ENV.appEnv === 'development';
