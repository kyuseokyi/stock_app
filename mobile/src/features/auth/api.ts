import { authApi } from '@/lib/api';

import type { User } from './types';

// 서버(FastAPI) 원응답 형태(snake_case) — backend/apps/auth/schemas.py TokenResponse/UserOut
type RawUser = {
  id: number;
  email: string | null;
  nickname: string | null;
  role: string;
};

type RawTokenResponse = {
  access_token: string;
  token_type: string;
  user: RawUser;
};

function toUser(r: RawUser): User {
  return {
    id: r.id,
    email: r.email,
    nickname: r.nickname,
    role: r.role,
  };
}

export type GuestLoginResult = {
  accessToken: string;
  user: User;
};

/** 게스트(닉네임) 로그인 — 비밀번호 없이 닉네임만으로 발급. POST /api/v1/auth/guest (auth 서비스, 포트 8001) */
export async function guestLogin(nickname: string): Promise<GuestLoginResult> {
  const raw = await authApi.post<RawTokenResponse>('/api/v1/auth/guest', { nickname });
  return { accessToken: raw.access_token, user: toUser(raw.user) };
}
