// 푸시 기기 토큰 API — fetch 직접 호출: 백그라운드 등록에 상단 진행바를 띄우지 않고, 로그아웃 직전 토큰을 인자로 받기 위해
import { ENV } from '@/lib/env';

const BASE = `${ENV.blogApiUrl}/api/v1/push-devices`;

export async function putPushDevice(authToken: string, pushToken: string, platform: 'android' | 'ios'): Promise<void> {
  const res = await fetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ token: pushToken, platform, fund_notice: true }),
  });
  if (!res.ok) throw new Error(`push-devices PUT ${res.status}`);
}

export async function deletePushDevice(authToken: string, pushToken: string): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(pushToken)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error(`push-devices DELETE ${res.status}`);
}
