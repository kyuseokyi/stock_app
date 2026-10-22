/** 세션 종료 사유 판정·안내 문구·확인 간격 — http 클라이언트·auth store·게임 소켓이 공유(web store/auth.ts 와 같은 규칙) */
/**
 * - expired: 만료·무효(TOKEN_EXPIRED 갱신 실패·TOKEN_INVALID·REFRESH_INVALID/EXPIRED·사유 없음)
 * - replaced: 같은 플랫폼 다른 기기 로그인(SESSION_REPLACED)
 * - ended: 서버에서 세션이 끝남 — 다른 곳에서 로그아웃 등(SESSION_ENDED)
 * - reused: 리프레시 토큰 재사용 감지로 보안 로그아웃(REFRESH_REUSED)
 */
export type SessionEndReason = 'expired' | 'replaced' | 'ended' | 'reused';

export const VALIDATE_INTERVAL_MS = 60_000;

/**
 * 401 응답 본문의 사유 코드 — {detail:{code}} 의 code(TOKEN_EXPIRED·TOKEN_INVALID·SESSION_REPLACED·REFRESH_* 등).
 * 문자열 detail(구 서버)·빈 본문은 null
 */
export function codeFromBody(body: unknown): string | null {
  const detail = typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
  if (typeof detail !== 'object' || detail === null || !('code' in detail)) return null;
  return typeof detail.code === 'string' && detail.code !== '' ? detail.code : null;
}

/** 접근 토큰 갱신을 시도할 401 인가 — 만료(TOKEN_EXPIRED) 또는 사유 없는 401(구 서버 호환). 교체·종료(SESSION_ENDED)·무효는 갱신하지 않는다 */
export function isRefreshable401(body: unknown): boolean {
  const code = codeFromBody(body);
  return code === null || code === 'TOKEN_EXPIRED';
}

/** 서버 사유 코드(REST detail.code·WS close reason) → 사유. 모르는 코드·빈 값은 expired */
export function reasonFromCode(code: string | null | undefined): SessionEndReason {
  switch (code) {
    case 'SESSION_REPLACED':
      return 'replaced';
    case 'SESSION_ENDED':
      return 'ended';
    case 'REFRESH_REUSED':
      return 'reused';
    default:
      return 'expired';
  }
}

/** 401 응답 본문 → 사유(문자열 detail·빈 본문은 expired) */
export function reasonFromBody(body: unknown): SessionEndReason {
  return reasonFromCode(codeFromBody(body));
}

export function sessionEndMessage(reason: SessionEndReason): string {
  switch (reason) {
    case 'replaced':
      return '다른 기기에서 로그인되어 로그아웃됐어요';
    case 'ended':
      return '로그아웃됐어요. 다시 로그인해 주세요';
    case 'reused':
      return '보안을 위해 로그아웃됐어요. 다시 로그인해 주세요';
    default:
      return '로그인이 만료되었어요. 다시 로그인해 주세요';
  }
}

/** 시작(force)은 항상, 포그라운드 복귀는 마지막 확인 후 60초가 지났을 때만 */
export function shouldValidate(lastAt: number, now: number, force: boolean): boolean {
  return force || now - lastAt >= VALIDATE_INTERVAL_MS;
}
