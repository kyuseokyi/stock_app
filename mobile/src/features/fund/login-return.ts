// 로그인 후 돌아갈 곳(1회용) — 내 펀드 로그인 안내(시트·안내 카드)에서 [로그인하러 가기]를 눌렀을 때만 기억하고,
// 내정보(profile)에서 로그인이 성공하는 순간 꺼내 그 화면으로 보낸다. 웹(web_client/src/lib/socialLogin.ts
// rememberLoginReturn·takeLoginReturn)과 같은 개념.
// 메모리 변수로 충분하다 — 간편 로그인은 인앱 브라우저(openAuthSessionAsync)를 기다리는 같은 JS 실행 안에서 끝나고,
// 앱이 종료됐다 다시 열리는 경우는 다루지 않는다(기억도 함께 사라져 그냥 내정보에 머문다).
import { FUNDS_TAB_PATH } from './fund-gate';

/** 기억 유효 시간 — 카카오·네이버에서 아이디·비밀번호를 입력하는 시간까지 감안. 지나면 무효 */
export const LOGIN_RETURN_TTL_MS = 10 * 60 * 1000;

/** 돌아갈 수 있는 경로(허용 목록) — 지금은 내 펀드 탭만 */
const ALLOWED_RETURN_PATHS: readonly string[] = [FUNDS_TAB_PATH];

export function isAllowedReturnPath(path: string | null | undefined): path is string {
  return !!path && ALLOWED_RETURN_PATHS.includes(path);
}

let pending: { path: string; at: number } | null = null;

/** 로그인하러 가기 직전에 돌아갈 곳을 기억 — 허용 목록 밖이면 기억하지 않는다(이전 기억도 비움) */
export function rememberLoginReturn(path: string, now: number = Date.now()): void {
  pending = isAllowedReturnPath(path) ? { path, at: now } : null;
}

/** 기억한 곳을 꺼내고 비운다(1회). 없거나 만료·허용 목록 밖이면 null */
export function takeLoginReturn(now: number = Date.now()): string | null {
  const saved = pending;
  pending = null;
  if (!saved) return null;
  const age = now - saved.at;
  if (age < 0 || age > LOGIN_RETURN_TTL_MS) return null;
  return isAllowedReturnPath(saved.path) ? saved.path : null;
}

/** 기억 취소 — 로그인하지 않고 내정보를 떠났을 때 */
export function clearLoginReturn(): void {
  pending = null;
}
