/**
 * GET /api/v1/app/version-check 응답 → 앱이 쓰는 형태(docs/app_update_management_spec.md 3-2).
 * 순수 함수(네이티브·http import 없음). 형식이 어긋나도 던지지 않는다:
 *  - 본문이 객체가 아니면(404 HTML·빈 응답 등) null → 호출부는 "확인 실패"로 보고 아무 모달도 띄우지 않는다.
 *  - 일부 필드가 빠지거나 모르는 값이면 가장 안전한 기본값(점검 아님·NONE·SILENT)으로 채운다.
 */

export type StoreUpdateType = 'NONE' | 'RECOMMENDED' | 'FORCE';
export type OtaPolicy = 'SILENT' | 'OPTIONAL' | 'MANDATORY';

export type VersionCheck = {
  maintenance: { isActive: boolean; message: string | null };
  store: {
    updateType: StoreUpdateType;
    latestVersion: string | null;
    minSupportedVersion: string | null;
    title: string | null;
    message: string | null;
    storeUrl: string | null;
  };
  ota: { policy: OtaPolicy; title: string | null; message: string | null };
};

const STORE_TYPES: readonly StoreUpdateType[] = ['NONE', 'RECOMMENDED', 'FORCE'];
const OTA_POLICIES: readonly OtaPolicy[] = ['SILENT', 'OPTIONAL', 'MANDATORY'];

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});

/** 비어 있지 않은 문자열만 — 공백·null·숫자 등은 null(→ 기본 문구) */
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== 'string') return fallback;
  const up = v.toUpperCase() as T;
  return allowed.includes(up) ? up : fallback;
}

export function parseVersionCheck(body: unknown): VersionCheck | null {
  if (!isObj(body)) return null;
  const m = obj(body.maintenance);
  const s = obj(body.store);
  const o = obj(body.ota);
  return {
    maintenance: { isActive: m.is_active === true, message: str(m.message) },
    store: {
      updateType: oneOf(s.update_type, STORE_TYPES, 'NONE'),
      latestVersion: str(s.latest_version),
      minSupportedVersion: str(s.min_supported_version),
      title: str(s.title),
      message: str(s.message),
      storeUrl: str(s.store_url),
    },
    ota: { policy: oneOf(o.policy, OTA_POLICIES, 'SILENT'), title: str(o.title), message: str(o.message) },
  };
}
