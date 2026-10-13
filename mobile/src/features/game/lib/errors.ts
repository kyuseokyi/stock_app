// 게임 API 실패 → 사용자 문구. (web lib/gameErrors.ts 와 같은 문구·규칙, axios 대신 모바일 ApiError)
// detail 이 문자열(주문 409/422 등, 이미 한국어 문장)이면 그대로, 객체 {code, message}(퀘스트·퀴즈·레버리지 잠금)면
// code 별 고정 문구 → 없으면 message. ApiError 가 아니면(fetch TypeError 등) 네트워크 문구.
// 주의: '@/lib/api'(index) 는 graphql-request 를 끌어오므로 http 모듈만 직접 import 한다.
import { ApiError } from '@/lib/api/http';

const NETWORK = '게임 서버에 연결할 수 없어요';
const EXPIRED = '로그인이 만료되었어요. 다시 로그인해 주세요';

const CODE_MESSAGES = new Map<string, string>([
  ['NO_QUIZ_AVAILABLE', '준비된 문제를 모두 풀었어요'],
  ['FEATURE_DISABLED', '지금은 운영하지 않는 기능이에요'],
  ['QUIZ_NOT_SERVED', '이미 제출했거나 만료된 문제예요'],
  ['ALREADY_SUBMITTED', '이미 제출했거나 만료된 문제예요'],
  ['QUEST_NOT_COMPLETED', '아직 완료하지 않은 퀘스트예요'],
  ['ALREADY_CLAIMED', '이미 받은 보상이에요'],
  ['NO_ACTIVE_SEASON', '진행 중인 시즌이 없어요'],
  ['PRICE_UNAVAILABLE', '시세를 확인할 수 없어요. 잠시 후 다시 시도해 주세요'],
  ['LEVERAGE_LOCKED', '5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요'],
  ['NOT_REACHED', '아직 연속 출석 일수가 부족해요'],
  ['UNKNOWN_MILESTONE', '없는 보상이에요'],
]);

/** 응답 본문의 detail(문자열·객체·배열) — ApiError 가 아니거나 detail 이 없으면 undefined */
function errorDetail(err: unknown): unknown {
  if (!(err instanceof ApiError)) return undefined;
  const body = err.body;
  return typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
}

/** 객체 detail 의 code(문자열일 때만), 없으면 null */
export function apiErrorCode(err: unknown): string | null {
  const detail = errorDetail(err);
  if (typeof detail === 'object' && detail !== null && 'code' in detail && typeof detail.code === 'string') {
    return detail.code;
  }
  return null;
}

export function gameErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return NETWORK;
  const { status } = err;
  if (status === 401) return EXPIRED;
  const code = apiErrorCode(err);
  const mapped = code === null ? undefined : CODE_MESSAGES.get(code);
  if (mapped !== undefined) return mapped;
  const detail = errorDetail(err);
  if (typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string') {
    return detail.message;
  }
  if ((status === 403 || status === 404 || status === 409 || status === 422) && typeof detail === 'string') {
    return detail;
  }
  // web 동일 — 422 검증 오류(배열 등 비문자열 detail)
  if (status === 422 && detail !== undefined) return '요청이 올바르지 않아요';
  return NETWORK;
}

/** 주문/청산 실패 — 422 검증 오류(배열 detail)는 '주문 조건이 올바르지 않아요', 나머지는 gameErrorMessage */
export function orderErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 422) {
    const detail = errorDetail(err);
    if (typeof detail !== 'string') return '주문 조건이 올바르지 않아요';
  }
  return gameErrorMessage(err);
}
