/**
 * 앱 환경변수 단일 접근점.
 * EXPO_PUBLIC_ 변수는 빌드 시 인라인된다(.env.development / .env.production).
 * MSA라 서비스별 base URL이 분리돼 있다(운영은 Nginx가 한 호스트로 통합).
 */
import * as Application from 'expo-application';

import { detectEnvMismatch, type EnvMismatch } from './env-guard';

const appEnv = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

/**
 * 설치된 앱(패키지 ID)과 번들 env 가 어긋나는지 — OTA 발행 env 함정 방어(자세한 이유는 env-guard.ts).
 * 감지·경고만 하고 값은 바꾸지 않는다:
 *  - 번들에는 잘못 실린 쪽 주소만 들어 있어 되돌아갈 "올바른" 서버 주소가 없다.
 *  - appEnv 를 development 로 뒤집으면 게스트 로그인이 운영 서버에 노출되고 게임 주소가 localhost 로 떨어져 더 위험하다.
 *  따라서 개발자가 알아채도록 콘솔 경고 + ENV.envMismatch 로만 알린다(올바른 발행은 scripts/publish-ota.sh).
 */
function readEnvMismatch(): EnvMismatch | null {
  let packageId: string | null = null;
  try {
    packageId = Application.applicationId ?? null;
  } catch {
    return null; // 네이티브 모듈 없음(웹·테스트) — 판정하지 않음
  }
  const mismatch = detectEnvMismatch(packageId, appEnv);
  if (mismatch) {
    console.warn(
      `[env] 앱(${mismatch.packageId})은 ${mismatch.expected} 인데 번들 env 는 ${mismatch.bundled} 입니다 — ` +
        'OTA 를 scripts/publish-ota.sh 로 다시 발행하세요.',
    );
  }
  return mismatch;
}
const envMismatch = readEnvMismatch();

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
  /** 패키지 ID 와 번들 env 불일치(있으면 경고만 — 값은 바꾸지 않음) */
  envMismatch,
} as const;

export const isDev = ENV.appEnv === 'development';
