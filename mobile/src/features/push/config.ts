import Constants from 'expo-constants';

/** app.config.js extra.eas.projectId(env EAS_PROJECT_ID). 없으면 푸시 꺼짐 */
export function getProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId || undefined;
}

export const isPushConfigured = (): boolean => getProjectId() !== undefined;
