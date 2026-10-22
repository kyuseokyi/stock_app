/** 현재 앱 버전·플랫폼 — 버전 확인 요청 파라미터 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { AppPlatform } from './api';

/** 설치된 바이너리 버전(nativeApplicationVersion), 없으면 app.config 의 version */
export function currentAppVersion(): string {
  try {
    return Application.nativeApplicationVersion || Constants.expoConfig?.version || '0.0.0';
  } catch {
    return Constants.expoConfig?.version || '0.0.0';
  }
}

/** 버전 확인 대상 플랫폼 — 웹 등은 null(확인하지 않음) */
export function currentPlatform(): AppPlatform | null {
  return Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null;
}

/** 설치된 앱의 패키지명(Android applicationId·iOS bundleId) — 기본 스토어 주소용. 모르면 app.config 값, 그래도 없으면 null */
export function currentPackageId(): string | null {
  try {
    if (Application.applicationId) return Application.applicationId;
  } catch {
    // 아래 대체값
  }
  const cfg = Constants.expoConfig;
  return (Platform.OS === 'ios' ? cfg?.ios?.bundleIdentifier : cfg?.android?.package) ?? null;
}
