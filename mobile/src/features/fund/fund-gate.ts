// '내 펀드' 로그인 게이트 — 순수 판정 함수·문구·안내 시트 열림 상태(docs/app_identity_and_nav_redesign_spec.md 1-2).
// 펀드 목록은 로그인 계정별로 이 기기에만 저장하므로(fund-store) 로그인 전에는 보여 줄 목록이 없다.
// 웹(web_client/src/lib/fundGate.ts)과 같은 판정·문구를 쓴다.
import { create } from 'zustand';

/** 하단 탭 '내 펀드' 화면 경로 — 펀드 리포트·히스토리·백업은 지금처럼 /fund/... 스택 경로(푸시 딥링크 포함) */
export const FUNDS_TAB_PATH = '/funds';
/** 로그인 화면(내정보) — 탭바에서는 숨겼지만 라우트는 그대로 */
export const LOGIN_PATH = '/profile';

export const FUND_LOGIN_TITLE = '로그인이 필요해요';
export const FUND_LOGIN_DESCRIPTION = '내 펀드 수익률을 확인하고 기기에 안전하게 보관하려면 먼저 로그인해 주세요.';

/** 탭·홈 카드 터치 판정 — 로그인했으면 그대로 이동, 아니면 이동을 막고 로그인 안내 시트 */
export type FundNavAction = 'navigate' | 'login';

export function fundNavAction(loggedIn: boolean): FundNavAction {
  return loggedIn ? 'navigate' : 'login';
}

/** 내 펀드 화면 본문 — 로그인 복원 전(hydrated=false)은 로딩, 비로그인은 안내 카드, 로그인은 목록.
 *  복원 전에 안내 카드를 그리면 로그인 사용자가 푸시로 앱을 열 때 카드가 잠깐 깜박인다 */
export type FundScreenGate = 'loading' | 'login' | 'list';

export function fundScreenGate(hydrated: boolean, loggedIn: boolean): FundScreenGate {
  if (loggedIn) return 'list';
  return hydrated ? 'login' : 'loading';
}

/** 로그인 안내 시트 열림 상태 — 탭 레이아웃이 한 번만 그리고, 탭바·홈 카드가 같은 시트를 연다 */
type FundLoginSheetState = { open: boolean; show: () => void; hide: () => void };

export const useFundLoginSheet = create<FundLoginSheetState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export const openFundLoginSheet = () => useFundLoginSheet.getState().show();
export const closeFundLoginSheet = () => useFundLoginSheet.getState().hide();
