/**
 * 간편 로그인(카카오·네이버) — 인앱 브라우저 세션(웹 리다이렉트, 네이티브 SDK 미사용).
 * start URL 을 열고, auth 콜백이 `stockapp[-dev]://auth?code=…` 로 돌려보내면 세션이 닫힌다.
 * verifier 는 이 함수의 지역 변수로만 두고 교환 때 보낸다 — 같은 스킴을 가로챈 다른 앱은
 * 교환 코드를 받아도 verifier 가 없어 토큰을 받을 수 없다.
 */
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { exchangeSocialCode, socialStartUrl, type LoginResult, type SocialProvider } from './api';
import { parseAuthReturnUrl } from './return-url';
import { createVerifierPair } from './verifier';

export type SocialLoginOutcome =
  | { type: 'success'; result: LoginResult }
  | { type: 'cancel' }
  | { type: 'error'; error: string };

/** 앱 변형 — app.config.js 의 스킴과 같은 출처(APP_ENV → extra.appEnv)로 판단해야 복귀 스킴이 맞는다. */
function appVariant(): 'dev' | 'prod' {
  const appEnv: unknown = Constants.expoConfig?.extra?.appEnv ?? 'development';
  return appEnv === 'development' ? 'dev' : 'prod';
}

export async function startSocialLogin(provider: SocialProvider): Promise<SocialLoginOutcome> {
  let pair: { verifier: string; cc: string };
  try {
    pair = createVerifierPair();
  } catch {
    return { type: 'error', error: 'provider_failed' }; // 보안 난수원 없음 — 시작하지 않는다
  }
  const { verifier, cc } = pair;
  const returnUrl = Linking.createURL('auth'); // dev build: stockapp-dev://auth, prod: stockapp://auth
  const session = await WebBrowser.openAuthSessionAsync(socialStartUrl(provider, appVariant(), cc), returnUrl);
  if (session.type !== 'success') return { type: 'cancel' }; // cancel·dismiss 등 — 조용히 무시

  const parsed = parseAuthReturnUrl(session.url);
  if (!parsed) return { type: 'error', error: 'provider_failed' };
  if (parsed.type === 'error') {
    return parsed.error === 'cancelled' ? { type: 'cancel' } : { type: 'error', error: parsed.error };
  }
  return { type: 'success', result: await exchangeSocialCode(parsed.code, verifier) };
}
