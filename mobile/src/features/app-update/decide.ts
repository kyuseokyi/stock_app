/**
 * 앱 업데이트 모달 판정 — 순수 함수(docs/app_update_management_spec.md 2·5-2).
 *
 * 우선순위: MAINTENANCE > STORE_FORCE > OTA_MANDATORY > STORE_RECOMMENDED > OTA_OPTIONAL
 *  - 점검·스토어 강제면 OTA 자체를 하지 않는다(shouldRunOta).
 *  - OTA 필수는 차단 모달이라 권장 스토어 안내보다 먼저(재시작 후 다음 판정에서 스토어 권장이 나온다).
 *  - 스토어 권장과 OTA 선택이 둘 다면 스토어 권장 먼저, 닫으면 OTA 선택.
 *  - 버전 확인 실패(check=null)면 OTA 정책은 SILENT 로 본다 — 모달 없이 내려받기만(다음 실행 적용).
 *    백엔드 장애 중에도 긴급 수정 번들이 전달되게.
 */
import type { OtaPolicy, VersionCheck } from './parse';

export type UpdateMode = 'MAINTENANCE' | 'STORE_FORCE' | 'STORE_RECOMMENDED' | 'OTA_MANDATORY' | 'OTA_OPTIONAL';

/** 스토어 권장 "나중에 하기" 숨김 기간 */
export const STORE_HIDE_MS = 24 * 60 * 60 * 1000;
/** 포그라운드 복귀 재검사 간격(평소) — Expo 업데이트 서버 과호출 방지 */
export const RECHECK_INTERVAL_MS = 60 * 60 * 1000;
/** 점검·스토어 강제가 떠 있을 때 재검사 간격 — 관리자가 풀면 곧바로 내려가게(연타만 막는다) */
export const BLOCKING_RECHECK_INTERVAL_MS = 10 * 1000;

export type DecideInput = {
  check: VersionCheck | null;
  /** 새 OTA 번들을 내려받아 재시작하면 적용되는 상태 */
  otaReady: boolean;
  /** 스토어 권장 숨김 만료 시각(ms) — 저장된 값, 없으면 null */
  storeHiddenUntil: number | null;
  /** 이번 실행에서 스토어 권장을 닫음(업데이트 버튼으로 스토어 이동 포함) */
  storeDismissed: boolean;
  /** 이번 실행에서 OTA 선택을 "나중에 하기" — 다음 실행 때 자동 적용 */
  otaDismissed: boolean;
  now: number;
};

export function effectiveOtaPolicy(check: VersionCheck | null): OtaPolicy {
  return check?.ota.policy ?? 'SILENT';
}

/** OTA 확인·다운로드를 해도 되는가 — 점검·스토어 강제 중엔 하지 않는다(실패=null 은 진행) */
export function shouldRunOta(check: VersionCheck | null): boolean {
  if (!check) return true;
  return !check.maintenance.isActive && check.store.updateType !== 'FORCE';
}

export function isStoreHidden(hiddenUntil: number | null, now: number): boolean {
  return hiddenUntil !== null && hiddenUntil > now;
}

export function decideMode(i: DecideInput): UpdateMode | null {
  const { check } = i;
  if (check?.maintenance.isActive) return 'MAINTENANCE';
  if (check?.store.updateType === 'FORCE') return 'STORE_FORCE';

  const policy = effectiveOtaPolicy(check);
  if (i.otaReady && policy === 'MANDATORY') return 'OTA_MANDATORY';

  if (check?.store.updateType === 'RECOMMENDED' && !i.storeDismissed && !isStoreHidden(i.storeHiddenUntil, i.now)) {
    return 'STORE_RECOMMENDED';
  }
  if (i.otaReady && policy === 'OPTIONAL' && !i.otaDismissed) return 'OTA_OPTIONAL';
  return null;
}

/** 닫을 수 없는(뒤로가기·배경 탭 차단) 모드 */
export function isBlockingMode(mode: UpdateMode | null): boolean {
  return mode === 'MAINTENANCE' || mode === 'STORE_FORCE' || mode === 'OTA_MANDATORY';
}

/** 포그라운드 복귀 시 재검사할지 — 점검·스토어 강제 중엔 짧은 간격, 평소엔 1시간 */
export function shouldRecheck(mode: UpdateMode | null, lastCheckedAt: number, now: number): boolean {
  const interval = mode === 'MAINTENANCE' || mode === 'STORE_FORCE' ? BLOCKING_RECHECK_INTERVAL_MS : RECHECK_INTERVAL_MS;
  return now - lastCheckedAt >= interval;
}

/** 스토어 권장 숨김 기록 키 — 버전별(새 버전이 나오면 다시 안내). SecureStore 키 문자셋 [A-Za-z0-9._-] 로 정리 */
export function storeHideKey(platform: string, latestVersion: string | null): string {
  const safe = (v: string) => v.replace(/[^A-Za-z0-9._-]/g, '_');
  return `app_update_store_hide_${safe(platform)}_${safe(latestVersion ?? 'unknown')}`;
}
