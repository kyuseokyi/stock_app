// 푸시 기기 토큰 API — fetch 직접 호출: 백그라운드 등록에 상단 진행바를 띄우지 않고, 로그아웃 직전 토큰을 인자로 받기 위해
import { ENV } from '@/lib/env';

import { PUSH_TIMEOUT_MS, type PushFlags } from './registration-core';

const BASE = `${ENV.blogApiUrl}/api/v1/push-devices`;

/** 응답이 없으면 10초 뒤 abort — 멈춘 요청이 등록·해제 큐를 막지 않게 */
/** 실패 응답 → 오류(status·본문 포함 — 401 만료면 호출부가 토큰을 한 번 갱신해 재시도할 수 있게) */
async function httpError(res: Response, label: string): Promise<Error> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return Object.assign(new Error(`${label} ${res.status}`), { status: res.status, body });
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PUSH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function putPushDevice(
  authToken: string,
  pushToken: string,
  platform: 'android' | 'ios',
  flags: PushFlags,
): Promise<void> {
  const res = await timedFetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      token: pushToken,
      platform,
      fund_notice: flags.fundNotice,
      post_notice: flags.postNotice,
    }),
  });
  if (!res.ok) throw await httpError(res, 'push-devices PUT');
}

export async function deletePushDevice(authToken: string, pushToken: string): Promise<void> {
  const res = await timedFetch(`${BASE}/${encodeURIComponent(pushToken)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw await httpError(res, 'push-devices DELETE');
}
