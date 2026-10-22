/**
 * 설치된 앱(네이티브 패키지 ID)과 번들에 박힌 EXPO_PUBLIC_APP_ENV 가 어긋나는지 — 순수 함수.
 *
 * 왜: `eas update` 는 production 모드로 export 해서 `.env.production*` 의 EXPO_PUBLIC_* 를 번들에 넣는다.
 *   개발 채널에 그대로 발행하면 개발 앱(com.stockapp.dev)이 운영 서버 주소·운영 설정으로 뜬다(scripts/publish-ota.sh 가 막지만
 *   스크립트를 거치지 않은 발행까지는 못 막는다). 반대로 운영 앱에 개발 env 가 실리면 개발 서버·게스트 로그인이 노출된다.
 *
 * 판정하지 않는 경우(null): 패키지 ID 를 모름(웹·jest), Expo Go(host.exp.exponent 등 우리 패키지가 아님).
 *   로컬 Metro 개발(dev client = com.stockapp.dev + .env.development = development)은 일치하므로 영향 없다.
 */
export const DEV_PACKAGE_ID = 'com.stockapp.dev';
export const PROD_PACKAGE_ID = 'com.stockapp';

export type EnvMismatch = { packageId: string; expected: 'development' | 'production'; bundled: string };

export function detectEnvMismatch(packageId: string | null | undefined, bundledAppEnv: string): EnvMismatch | null {
  if (packageId === DEV_PACKAGE_ID) {
    return bundledAppEnv === 'production' ? { packageId, expected: 'development', bundled: bundledAppEnv } : null;
  }
  if (packageId === PROD_PACKAGE_ID) {
    return bundledAppEnv !== 'production' ? { packageId, expected: 'production', bundled: bundledAppEnv } : null;
  }
  return null;
}
