import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** app.config.js extra.eas.projectId(기본값 + env EAS_PROJECT_ID 로 덮어쓰기). 없으면 푸시 꺼짐 */
export function getProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId || undefined;
}

// 웹(expo start --web)은 Expo 푸시 토큰·백그라운드 태스크 대상이 아니다 — projectId 가 기본값으로 늘 있으므로 플랫폼으로 막는다
export const isPushConfigured = (): boolean => Platform.OS !== 'web' && getProjectId() !== undefined;
