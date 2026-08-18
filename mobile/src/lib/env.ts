/**
 * 앱 환경변수 단일 접근점.
 * EXPO_PUBLIC_ 변수는 빌드 시 인라인된다(.env.development / .env.production).
 */
export const ENV = {
  appEnv: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8002',
  graphqlUrl: process.env.EXPO_PUBLIC_GRAPHQL_URL ?? 'http://localhost:8002/graphql',
} as const;

export const isDev = ENV.appEnv === 'development';
