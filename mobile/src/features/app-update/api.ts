/**
 * 앱 버전 확인 API(공개, 인증 불필요) — blog 서비스 GET /api/v1/app/version-check.
 * 어떤 실패(네트워크·타임아웃·4xx/5xx·형식 오류)도 던지지 않고 null — 앱은 평소대로 기동한다.
 * 참고: blogApi 는 로그인 상태면 Bearer 를 붙이지만 공개 엔드포인트라 서버가 보지 않는다.
 */
import { blogApi } from '@/lib/api';

import { parseVersionCheck, type VersionCheck } from './parse';

export type AppPlatform = 'android' | 'ios';

export async function fetchVersionCheck(platform: AppPlatform, currentVersion: string): Promise<VersionCheck | null> {
  try {
    const body = await blogApi.get<unknown>('/api/v1/app/version-check', {
      platform,
      current_version: currentVersion,
    });
    return parseVersionCheck(body);
  } catch {
    return null;
  }
}
