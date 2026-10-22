// 앱 버전(SemVer major.minor.patch) 검증·비교 — 서버(backend/apps/blog/services/app_version.py)와 같은 규칙.
// 각 자리는 숫자, 앞자리 0 금지(0 단독 허용), 전체 20자 이하. "1.10.0" > "1.9.0"(숫자 비교).

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
export const VERSION_MAX_LEN = 20

export function parseSemver(value: string): [number, number, number] | null {
  if (value.length > VERSION_MAX_LEN) return null
  const m = SEMVER.exec(value)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export const isValidSemver = (value: string): boolean => parseSemver(value) !== null

/** a<b → -1, 같음 → 0, a>b → 1. 형식이 틀리면 null */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}
