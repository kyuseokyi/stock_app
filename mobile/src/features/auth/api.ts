import { authApi } from '@/lib/api';
import { ENV } from '@/lib/env';

import { TERMS_VERSION } from './terms';

import type { User } from './types';

// 서버(FastAPI) 원응답 형태(snake_case) — backend/apps/auth/schemas.py TokenResponse/UserOut
type RawUser = {
  id: number;
  email: string | null;
  nickname: string | null;
  role: string;
  /** 약관 동의 필요 여부 — 구 서버는 없음 */
  terms_required?: boolean;
};

type RawTokenResponse = {
  access_token: string;
  token_type: string;
  user: RawUser;
  /** 앱 로그인(platform app)일 때만 — 구 서버·웹은 없음 */
  refresh_token?: string | null;
  /** 접근 토큰 수명(초) — 앱 로그인일 때만 */
  expires_in?: number | null;
};

function toUser(r: RawUser): User {
  return {
    id: r.id,
    email: r.email,
    nickname: r.nickname,
    role: r.role,
    // 서버가 줄 때만 담는다(구 서버 응답·기존 비교 결과가 그대로 유지되게)
    ...(typeof r.terms_required === 'boolean' ? { termsRequired: r.terms_required } : {}),
  };
}

export type GuestLoginResult = {
  accessToken: string;
  /** 리프레시 토큰 — 서버가 주지 않으면(구 서버) null: 기존처럼 접근 토큰 만료 시 다시 로그인 */
  refreshToken?: string | null;
  user: User;
};

function toLoginResult(raw: RawTokenResponse): LoginResult {
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === 'string' && raw.refresh_token !== '' ? raw.refresh_token : null,
    user: toUser(raw.user),
  };
}

/** 갱신 응답의 user(검증 전 unknown) → User. 형식이 틀리면 null(기존 사용자 정보 유지) */
export function toUserOrNull(raw: unknown): User | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<RawUser>;
  if (typeof r.id !== 'number' || typeof r.role !== 'string') return null;
  return toUser({
    id: r.id,
    email: r.email ?? null,
    nickname: r.nickname ?? null,
    role: r.role,
    terms_required: r.terms_required,
  });
}

/** 게스트·간편 로그인 공통 결과(서비스 JWT + 사용자) */
export type LoginResult = GuestLoginResult;

export type SocialProvider = 'kakao' | 'naver';
export type SocialProviders = Record<SocialProvider, boolean>;

/** 게스트(닉네임) 로그인 — 비밀번호 없이 닉네임만으로 발급. POST /api/v1/auth/guest (auth 서비스, 포트 8001) */
export async function guestLogin(nickname: string): Promise<GuestLoginResult> {
  const raw = await authApi.post<RawTokenResponse>('/api/v1/auth/guest', { nickname, platform: 'app' });
  return toLoginResult(raw);
}

/** 현재 사용자(세션 확인용) — GET /api/v1/auth/me. 401 은 http 클라이언트가 notifyUnauthorized 로 처리 */
export async function fetchMe(): Promise<User> {
  return toUser(await authApi.get<RawUser>('/api/v1/auth/me'));
}

/** 간편 로그인 공급자 활성 여부 — GET /api/v1/auth/social/providers (키 미설정 공급자는 false) */
export async function getSocialProviders(): Promise<SocialProviders> {
  const raw = await authApi.get<Partial<SocialProviders>>('/api/v1/auth/social/providers');
  return { kakao: raw.kakao === true, naver: raw.naver === true };
}

/**
 * 인앱 브라우저로 여는 시작 URL. app=dev|prod 로 서버가 복귀 스킴(stockapp-dev/stockapp)을 고른다.
 * cc = base64url(sha256(verifier)) — 교환 코드를 이 앱 인스턴스에 묶는다(verifier.ts).
 */
export function socialStartUrl(provider: SocialProvider, appVariant: 'dev' | 'prod', cc: string): string {
  const base = ENV.authApiUrl.replace(/\/$/, '');
  return `${base}/api/v1/auth/social/${provider}/start?client=app&app=${appVariant}&cc=${encodeURIComponent(cc)}`;
}

/** 일회용 교환 코드 + verifier → 서비스 JWT. POST /api/v1/auth/social/exchange */
export async function exchangeSocialCode(code: string, codeVerifier: string): Promise<LoginResult> {
  const raw = await authApi.post<RawTokenResponse>('/api/v1/auth/social/exchange', {
    code,
    code_verifier: codeVerifier,
  });
  return toLoginResult(raw);
}

/** 탈퇴 확인 문구 — 서버(DELETE /api/v1/auth/me)가 정확히 이 값을 요구한다 */
export const DELETE_CONFIRM_TEXT = '탈퇴';

/** 회원 탈퇴 — DELETE /api/v1/auth/me (204). 실패는 ApiError(status, body.detail.code) */
export async function deleteAccount(): Promise<void> {
  await authApi.del<void>('/api/v1/auth/me', { confirm: DELETE_CONFIRM_TEXT });
}

/** 현재 약관 동의 — POST /api/v1/auth/me/terms (멱등). 실패는 ApiError(409 TERMS_VERSION_MISMATCH·401) */
export async function agreeTerms(): Promise<User> {
  return toUser(await authApi.post<RawUser>('/api/v1/auth/me/terms', { version: TERMS_VERSION }));
}

/** 심사 전용 로그인 — POST /api/v1/auth/review-login(앱이면 리프레시 포함). 404 꺼짐·401 불일치·403 비활성 */
export async function reviewLogin(email: string, password: string): Promise<LoginResult> {
  const raw = await authApi.post<RawTokenResponse>('/api/v1/auth/review-login', { email, password, platform: 'app' });
  return toLoginResult(raw);
}
