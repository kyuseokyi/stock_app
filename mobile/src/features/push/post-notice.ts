// 내정보 "새 글 알림" 설정 — 기기 저장(기본 켜짐). 서버에는 등록 동기화 때 post_notice 로 함께 간다
import * as SecureStore from 'expo-secure-store';

import { parsePostNotice } from './registration-core';

const POST_NOTICE_KEY = 'push_post_notice_v1';

/** 읽기 실패는 기본값(켜짐) */
export async function loadPostNotice(): Promise<boolean> {
  try {
    return parsePostNotice(await SecureStore.getItemAsync(POST_NOTICE_KEY));
  } catch {
    return true;
  }
}

/** 저장 성공 여부를 돌려준다 — 실패하면 호출부가 표시값을 되돌리고 동기화하지 않는다 */
export const savePostNotice = (on: boolean): Promise<boolean> =>
  SecureStore.setItemAsync(POST_NOTICE_KEY, on ? '1' : '0').then(
    () => true,
    () => false,
  );
