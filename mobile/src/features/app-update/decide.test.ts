import {
  BLOCKING_RECHECK_INTERVAL_MS,
  decideMode,
  effectiveOtaPolicy,
  isBlockingMode,
  RECHECK_INTERVAL_MS,
  defaultStoreUrl,
  MAINTENANCE_POLL_MS,
  resolveStoreUrl,
  shouldPollMaintenance,
  shouldRecheck,
  shouldRunOta,
  STORE_HIDE_MS,
  storeHideKey,
  type DecideInput,
} from './decide';
import { parseVersionCheck, type OtaPolicy, type StoreUpdateType, type VersionCheck } from './parse';

const NOW = 1_800_000_000_000;

function vc(p: { maintenance?: boolean; store?: StoreUpdateType; ota?: OtaPolicy } = {}): VersionCheck {
  return parseVersionCheck({
    maintenance: { is_active: p.maintenance ?? false, message: null },
    store: { update_type: p.store ?? 'NONE', latest_version: '1.1.0', store_url: 'https://play.google.com/x' },
    ota: { policy: p.ota ?? 'SILENT' },
  })!;
}

const base: DecideInput = {
  check: vc(),
  otaReady: false,
  storeHiddenUntil: null,
  storeDismissed: false,
  otaDismissed: false,
  now: NOW,
};

describe('decideMode — 5가지 모드', () => {
  it('업데이트 없음 → null', () => {
    expect(decideMode(base)).toBeNull();
  });
  it('점검', () => {
    expect(decideMode({ ...base, check: vc({ maintenance: true }) })).toBe('MAINTENANCE');
  });
  it('스토어 강제', () => {
    expect(decideMode({ ...base, check: vc({ store: 'FORCE' }) })).toBe('STORE_FORCE');
  });
  it('스토어 권장', () => {
    expect(decideMode({ ...base, check: vc({ store: 'RECOMMENDED' }) })).toBe('STORE_RECOMMENDED');
  });
  it('OTA 필수(번들 준비됨)', () => {
    expect(decideMode({ ...base, check: vc({ ota: 'MANDATORY' }), otaReady: true })).toBe('OTA_MANDATORY');
  });
  it('OTA 선택(번들 준비됨)', () => {
    expect(decideMode({ ...base, check: vc({ ota: 'OPTIONAL' }), otaReady: true })).toBe('OTA_OPTIONAL');
  });
  it('OTA 무음은 번들이 준비돼도 모달 없음', () => {
    expect(decideMode({ ...base, check: vc({ ota: 'SILENT' }), otaReady: true })).toBeNull();
  });
  it('OTA 정책이 있어도 번들이 없으면 모달 없음', () => {
    expect(decideMode({ ...base, check: vc({ ota: 'MANDATORY' }) })).toBeNull();
    expect(decideMode({ ...base, check: vc({ ota: 'OPTIONAL' }) })).toBeNull();
  });
});

describe('decideMode — 우선순위', () => {
  it('점검 > 스토어 강제 > OTA', () => {
    const c = vc({ maintenance: true, store: 'FORCE', ota: 'MANDATORY' });
    expect(decideMode({ ...base, check: c, otaReady: true })).toBe('MAINTENANCE');
  });
  it('스토어 강제 > OTA 필수', () => {
    expect(decideMode({ ...base, check: vc({ store: 'FORCE', ota: 'MANDATORY' }), otaReady: true })).toBe('STORE_FORCE');
  });
  it('OTA 필수 > 스토어 권장', () => {
    expect(decideMode({ ...base, check: vc({ store: 'RECOMMENDED', ota: 'MANDATORY' }), otaReady: true })).toBe(
      'OTA_MANDATORY',
    );
  });
  it('스토어 권장 + OTA 선택 → 스토어 권장 먼저, 닫으면 OTA 선택, 그것도 닫으면 없음', () => {
    const i = { ...base, check: vc({ store: 'RECOMMENDED', ota: 'OPTIONAL' }), otaReady: true };
    expect(decideMode(i)).toBe('STORE_RECOMMENDED');
    expect(decideMode({ ...i, storeDismissed: true })).toBe('OTA_OPTIONAL');
    expect(decideMode({ ...i, storeDismissed: true, otaDismissed: true })).toBeNull();
  });
  it('스토어 강제·점검은 닫은 기록과 무관하게 계속', () => {
    const i = { ...base, storeDismissed: true, storeHiddenUntil: NOW + STORE_HIDE_MS };
    expect(decideMode({ ...i, check: vc({ store: 'FORCE' }) })).toBe('STORE_FORCE');
    expect(decideMode({ ...i, check: vc({ maintenance: true }) })).toBe('MAINTENANCE');
  });
});

describe('스토어 권장 하루 숨김', () => {
  const c = vc({ store: 'RECOMMENDED' });
  it('숨김 만료 전이면 안 보임', () => {
    expect(decideMode({ ...base, check: c, storeHiddenUntil: NOW + 1 })).toBeNull();
  });
  it('만료 시각이 지나면(같은 시각 포함) 다시 보임', () => {
    expect(decideMode({ ...base, check: c, storeHiddenUntil: NOW })).toBe('STORE_RECOMMENDED');
    expect(decideMode({ ...base, check: c, storeHiddenUntil: NOW - 1 })).toBe('STORE_RECOMMENDED');
  });
  it('숨김 중이어도 OTA 선택은 뜬다', () => {
    const c2 = vc({ store: 'RECOMMENDED', ota: 'OPTIONAL' });
    expect(decideMode({ ...base, check: c2, otaReady: true, storeHiddenUntil: NOW + 1000 })).toBe('OTA_OPTIONAL');
  });
  it('키는 플랫폼·버전별, 안전한 문자만', () => {
    expect(storeHideKey('android', '1.1.0')).toBe('app_update_store_hide_android_1.1.0');
    expect(storeHideKey('ios', null)).toBe('app_update_store_hide_ios_unknown');
    expect(storeHideKey('ios', '1.0 beta/2')).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('서버 확인 실패(check=null)', () => {
  it('아무 모달도 없음', () => {
    expect(decideMode({ ...base, check: null })).toBeNull();
  });
  it('번들이 준비돼도 SILENT 로 보고 모달 없음', () => {
    expect(effectiveOtaPolicy(null)).toBe('SILENT');
    expect(decideMode({ ...base, check: null, otaReady: true })).toBeNull();
  });
  it('OTA 내려받기는 진행(모달 없이 다음 실행 적용)', () => {
    expect(shouldRunOta(null)).toBe(true);
  });
});

describe('shouldRunOta', () => {
  it('점검·스토어 강제 중엔 OTA 하지 않음', () => {
    expect(shouldRunOta(vc({ maintenance: true }))).toBe(false);
    expect(shouldRunOta(vc({ store: 'FORCE' }))).toBe(false);
  });
  it('NONE·RECOMMENDED 면 OTA 진행', () => {
    expect(shouldRunOta(vc())).toBe(true);
    expect(shouldRunOta(vc({ store: 'RECOMMENDED' }))).toBe(true);
  });
});

describe('isBlockingMode', () => {
  it('점검·스토어 강제·OTA 필수만 닫기 불가', () => {
    expect(isBlockingMode('MAINTENANCE')).toBe(true);
    expect(isBlockingMode('STORE_FORCE')).toBe(true);
    expect(isBlockingMode('OTA_MANDATORY')).toBe(true);
    expect(isBlockingMode('STORE_RECOMMENDED')).toBe(false);
    expect(isBlockingMode('OTA_OPTIONAL')).toBe(false);
    expect(isBlockingMode(null)).toBe(false);
  });
});

describe('shouldRecheck(포그라운드 복귀)', () => {
  it('평소엔 1시간 지나야 재검사', () => {
    expect(shouldRecheck(null, NOW, NOW + RECHECK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldRecheck(null, NOW, NOW + RECHECK_INTERVAL_MS)).toBe(true);
    expect(shouldRecheck('STORE_RECOMMENDED', NOW, NOW + 60_000)).toBe(false);
  });
  it('점검·스토어 강제 중엔 짧은 간격으로 재검사(관리자가 풀면 곧바로 해제)', () => {
    expect(shouldRecheck('MAINTENANCE', NOW, NOW + BLOCKING_RECHECK_INTERVAL_MS)).toBe(true);
    expect(shouldRecheck('STORE_FORCE', NOW, NOW + BLOCKING_RECHECK_INTERVAL_MS)).toBe(true);
    expect(shouldRecheck('MAINTENANCE', NOW, NOW + 1000)).toBe(false);
  });
  it('OTA 필수도 차단 모드라 짧은 간격(관리자가 정책을 내리면 곧바로 반영)', () => {
    expect(shouldRecheck('OTA_MANDATORY', NOW, NOW + BLOCKING_RECHECK_INTERVAL_MS)).toBe(true);
    expect(shouldRecheck('OTA_OPTIONAL', NOW, NOW + BLOCKING_RECHECK_INTERVAL_MS)).toBe(false);
  });
});

describe('shouldPollMaintenance', () => {
  it('점검일 때만 주기 재검사', () => {
    expect(shouldPollMaintenance('MAINTENANCE')).toBe(true);
    expect(shouldPollMaintenance('STORE_FORCE')).toBe(false);
    expect(shouldPollMaintenance('OTA_MANDATORY')).toBe(false);
    expect(shouldPollMaintenance(null)).toBe(false);
    expect(MAINTENANCE_POLL_MS).toBe(30_000);
  });
});

describe('resolveStoreUrl', () => {
  it('서버 주소가 있으면 그대로', () => {
    expect(resolveStoreUrl('https://x.test/app', 'android', 'com.stockapp')).toBe('https://x.test/app');
  });
  it('없으면 Android 는 패키지 기반 Play 주소', () => {
    expect(resolveStoreUrl(null, 'android', 'com.stockapp.dev')).toBe(
      'https://play.google.com/store/apps/details?id=com.stockapp.dev',
    );
  });
  it('iOS·패키지 모름·이상한 패키지명이면 null(안내만)', () => {
    expect(resolveStoreUrl(null, 'ios', 'com.stockapp')).toBeNull();
    expect(resolveStoreUrl(null, 'android', null)).toBeNull();
    expect(defaultStoreUrl('android', 'com.x&y=1')).toBeNull();
  });
});
