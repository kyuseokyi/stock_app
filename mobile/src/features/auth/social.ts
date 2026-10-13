/**
 * 간편 로그인(카카오·네이버) — 인앱 브라우저 세션(웹 리다이렉트, 네이티브 SDK 미사용).
 * start URL 을 열고, auth 콜백이 `stockapp[-dev]://auth?code=…` 로 돌려보내면 세션이 닫힌다.
 */
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { exchangeSocialCode, socialStartUrl, type LoginResult, type SocialProvider } from './api';
import { parseAuthReturnUrl } from './return-url';

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
  const returnUrl = Linking.createURL('auth'); // dev build: stockapp-dev://auth, prod: stockapp://auth
  const session = await WebBrowser.openAuthSessionAsync(socialStartUrl(provider, appVariant()), returnUrl);
  if (session.type !== 'success') return { type: 'cancel' }; // cancel·dismiss 등 — 조용히 무시

  const parsed = parseAuthReturnUrl(session.url);
  if (!parsed) return { type: 'error', error: 'provider_failed' };
  if (parsed.type === 'error') {
    return parsed.error === 'cancelled' ? { type: 'cancel' } : { type: 'error', error: parsed.error };
  }
  return { type: 'success', result: await exchangeSocialCode(parsed.code) };
}
