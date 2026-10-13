/**
 * 앱 환경변수 단일 접근점.
 * EXPO_PUBLIC_ 변수는 빌드 시 인라인된다(.env.development / .env.production).
 * MSA라 서비스별 base URL이 분리돼 있다(운영은 Nginx가 한 호스트로 통합).
 */
const appEnv = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

/**
 * trading_game(8003) REST·WS — 선택 변수.
 * 미설정 시 dev 는 localhost, production 이면 undefined → 게임 탭 "시즌을 준비하고 있어요".
 */
const gameApiUrl: string | undefined =
  process.env.EXPO_PUBLIC_GAME_API_URL ||
  (appEnv !== 'production' ? 'http://localhost:8003' : undefined);

/**
 * 닉네임(게스트) 로그인 노출 — 개발·테스트용.
 * EXPO_PUBLIC_ENABLE_GUEST_LOGIN 'true'/'false' 우선, 미설정이면 production 이 아닐 때만 노출.
 */
const guestFlag = process.env.EXPO_PUBLIC_ENABLE_GUEST_LOGIN;
const enableGuestLogin: boolean = guestFlag ? guestFlag === 'true' : appEnv !== 'production';

export const ENV = {
  appEnv,
  stockGraphqlUrl: process.env.EXPO_PUBLIC_STOCK_GRAPHQL_URL ?? 'http://localhost:8002/graphql',
  blogApiUrl: process.env.EXPO_PUBLIC_BLOG_API_URL ?? 'http://localhost:8000',
  authApiUrl: process.env.EXPO_PUBLIC_AUTH_API_URL ?? 'http://localhost:8001',
  gameApiUrl,
  enableGuestLogin,
} as const;

export const isDev = ENV.appEnv === 'development';
