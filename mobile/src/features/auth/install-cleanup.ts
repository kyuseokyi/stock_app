// iOS 첫 실행 정리(2026-10-23 계정별 저장 설계 '앱 삭제') — 앱을 지워도 iOS 키체인(SecureStore)은 남아,
// 재설치하면 로그인·펀드 목록·백업 상태가 되살아난다. 앱 문서 폴더는 삭제와 함께 지워지므로 거기 둔 표식 파일이
// 없으면 "새로 설치됨"으로 보고 이 앱이 쓰는 SecureStore 키를 모두 지운다.
// - iOS 에서만: Android 는 앱 삭제 시 SecureStore 도 지워지고(allowBackup=false 로 자동 백업 복원도 막음),
//   업데이트 첫 실행에 기존 사용자가 로그아웃되면 안 된다(표식 없이 업데이트되는 사용자 = 전원).
// - 인증 hydrate 보다 먼저(store.ts 의 hydrate·persist 가 ensureInstallCleanup 을 기다림) — 앱 시작·백그라운드 태스크 모두.
// - 이 모듈은 인증 스토어·owner.ts 를 import 하지 않는다(순환 import 방지).
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  backupStateKey,
  FUND_OWNERS_KEY,
  fundListKey,
  LEGACY_BACKUP_STATE_KEY,
  LEGACY_FUND_LIST_KEY,
  loadFundOwners,
} from '@/features/fund/keys';

export const INSTALL_MARKER_FILE = 'install-marker-v1';
const MARKER_PENDING = 'pending';
const MARKER_DONE = 'done';

/**
 * 고정 이름 SecureStore 키 — 새 키를 추가하면 여기에도 넣는다(install-cleanup.test.ts 가 소스를 훑어 빠진 키를 잡는다).
 * 버전별 동적 키인 app-update 의 storeHideKey(스토어 업데이트 "나중에 하기", 하루 만료)는 나열할 수 없어 제외 — 남아도 무해.
 */
export const FIXED_SECURE_KEYS: readonly string[] = [
  'auth_token', // auth/store.ts TOKEN_KEY
  'auth_user', // auth/store.ts USER_KEY
  'auth_refresh', // auth/store.ts REFRESH_KEY
  LEGACY_FUND_LIST_KEY,
  LEGACY_BACKUP_STATE_KEY,
  'game.chartPrefs.v1', // game/lib/chart-prefs.ts CHART_PREFS_KEY
  'push_post_notice_v1', // push/post-notice.ts
  'push_prompt_v1', // push/prompt.ts
  'push_banner_dismissed_v1', // push/prompt.ts
  'push_last_handled_v1', // push/handlers.ts
  'push_device_v1', // push/registration.ts
];

export type MarkerPort = {
  /** 표식 내용(없으면 null). 읽기 실패는 던진다. */
  read(): Promise<string | null>;
  /** 표식 쓰기. 실패는 던진다. */
  write(value: string): void;
};

export type InstallCleanupDeps = {
  platform: string;
  marker: MarkerPort;
  deleteKey: (key: string) => Promise<void>;
  loadOwners: () => Promise<number[]>;
  log: (msg: string, e?: unknown) => void;
};

export type InstallCleanupResult = 'not-ios' | 'already' | 'marker-unwritable' | 'failed' | 'cleaned';

const fileMarker: MarkerPort = {
  async read() {
    const f = new File(Paths.document, INSTALL_MARKER_FILE);
    return f.exists ? await f.text() : null;
  },
  write(value) {
    const f = new File(Paths.document, INSTALL_MARKER_FILE);
    if (!f.exists) f.create();
    f.write(value);
  },
};

const defaultDeps = (): InstallCleanupDeps => ({
  platform: Platform.OS,
  marker: fileMarker,
  deleteKey: (k) => SecureStore.deleteItemAsync(k),
  loadOwners: loadFundOwners,
  log: (msg, e) => console.warn(`[install-cleanup] ${msg}`, e ?? ''),
});

/**
 * 표식 실패 처리 원칙: "정리했다는 사실을 기록할 수 없는 실행에서는 지우지 않는다".
 *  1) 표식을 먼저 'pending' 으로 쓴다 — 실패하면(문서 폴더에 쓸 수 없음) 정리하지 않고 로그만. 매 실행마다 로그아웃되는 것을 막는 대가로,
 *     그런 기기에서는 옛 키체인 값이 남을 수 있다(드문 경우라 감수).
 *  2) 키를 모두 지운다 — 하나라도 실패하면 표식은 'pending' 으로 남아 다음 실행에 다시 정리한다(지우기 자체가 계속 실패할 때만 반복).
 *  3) 성공하면 'done' 으로 바꾼다. 방금 'pending' 을 쓴 같은 파일이라 여기서 실패할 일은 드물다(실패하면 다음 실행에 한 번 더 정리).
 */
export async function runInstallCleanup(over: Partial<InstallCleanupDeps> = {}): Promise<InstallCleanupResult> {
  const d = { ...defaultDeps(), ...over };
  if (d.platform !== 'ios') return 'not-ios';

  let current: string | null;
  try {
    current = await d.marker.read();
  } catch (e) {
    d.log('표식 읽기 실패 — 정리하지 않음', e);
    return 'marker-unwritable';
  }
  if (current === MARKER_DONE) return 'already';

  try {
    d.marker.write(MARKER_PENDING);
  } catch (e) {
    d.log('표식 쓰기 실패 — 정리하지 않음(반복 로그아웃 방지)', e);
    return 'marker-unwritable';
  }

  let owners: number[] = [];
  let ok = true;
  try {
    owners = await d.loadOwners();
  } catch (e) {
    ok = false; // 계정별 키를 못 찾았다 — 고정 키는 지우되 다음 실행에 다시 시도
    d.log('소유자 목록 읽기 실패', e);
  }
  const keys = [...FIXED_SECURE_KEYS, ...owners.flatMap((id) => [fundListKey(id), backupStateKey(id)])];
  const results = await Promise.allSettled(keys.map((k) => d.deleteKey(k)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    ok = false;
    d.log(`키 삭제 실패 ${failed}개`);
  }
  // 목록 키는 계정별 키를 모두 지운 뒤 마지막에 — 도중 실패 시 다음 실행이 같은 목록으로 다시 찾을 수 있게
  if (ok) {
    try {
      await d.deleteKey(FUND_OWNERS_KEY);
    } catch (e) {
      ok = false;
      d.log('소유자 목록 키 삭제 실패', e);
    }
  }
  if (!ok) return 'failed';

  try {
    d.marker.write(MARKER_DONE);
  } catch (e) {
    d.log('완료 표식 쓰기 실패 — 다음 실행에 다시 정리', e);
  }
  return 'cleaned';
}

let once: Promise<void> | null = null;

/** 실행(프로세스)당 한 번. 절대 던지지 않는다 — 정리 실패가 앱 시작·로그인 복원을 막지 않게. */
export function ensureInstallCleanup(): Promise<void> {
  once ??= runInstallCleanup().then(
    () => {},
    (e: unknown) => console.warn('[install-cleanup] 정리 중 오류', e),
  );
  return once;
}

/** 테스트 전용 */
export function resetInstallCleanupForTest(): void {
  once = null;
}
