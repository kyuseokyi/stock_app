/** 세션 종료 사유 판정·안내 문구·확인 간격 — http 클라이언트·auth store·게임 소켓이 공유(web store/auth.ts 와 같은 규칙) */
export type SessionEndReason = 'expired' | 'replaced';

export const VALIDATE_INTERVAL_MS = 60_000;

/** 401 응답 본문 → 사유. {detail:{code:'SESSION_REPLACED'}} 만 replaced */
export function reasonFromBody(body: unknown): SessionEndReason {
  const detail = typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
  return typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'SESSION_REPLACED'
    ? 'replaced'
    : 'expired';
}

export function sessionEndMessage(reason: SessionEndReason): string {
  return reason === 'replaced'
    ? '다른 기기에서 로그인되어 로그아웃됐어요'
    : '로그인이 만료되었어요. 다시 로그인해 주세요';
}

/** 시작(force)은 항상, 포그라운드 복귀는 마지막 확인 후 60초가 지났을 때만 */
export function shouldValidate(lastAt: number, now: number, force: boolean): boolean {
  return force || now - lastAt >= VALIDATE_INTERVAL_MS;
}
