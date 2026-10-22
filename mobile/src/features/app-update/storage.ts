/**
 * 스토어 권장 업데이트 "나중에 하기" 숨김 기록(버전별 만료 시각) — SecureStore(앱 저장 관례, push/prompt.ts 와 같음).
 * 읽기·쓰기 실패는 조용히: 읽기 실패면 숨김 없음(안내가 한 번 더 뜨는 쪽이 안전).
 */
import * as SecureStore from 'expo-secure-store';

import { STORE_HIDE_MS, storeHideKey } from './decide';

export async function readStoreHiddenUntil(platform: string, latestVersion: string | null): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(storeHideKey(platform, latestVersion));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** 지금부터 하루 숨김. 저장한 만료 시각을 돌려준다(저장 실패해도 이번 실행에선 숨김) */
export async function hideStoreForADay(platform: string, latestVersion: string | null, now: number): Promise<number> {
  const until = now + STORE_HIDE_MS;
  await SecureStore.setItemAsync(storeHideKey(platform, latestVersion), String(until)).catch(() => {});
  return until;
}
