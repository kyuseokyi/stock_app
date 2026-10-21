import * as SecureStore from 'expo-secure-store';

const PROMPT_KEY = 'push_prompt_v1';
const BANNER_KEY = 'push_banner_dismissed_v1';

/** 안내 시트를 이미 보여줬는지(다시 묻지 않음). 읽기 실패는 "물어봤음"으로 — 반복 노출 방지 */
export async function wasPrompted(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PROMPT_KEY)) !== null;
  } catch {
    return true;
  }
}

export const markPrompted = (answer: 'accepted' | 'declined') =>
  SecureStore.setItemAsync(PROMPT_KEY, answer).catch(() => {});

export async function isBannerDismissed(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(BANNER_KEY)) !== null;
  } catch {
    return false;
  }
}

export const dismissBanner = () => SecureStore.setItemAsync(BANNER_KEY, '1').catch(() => {});
