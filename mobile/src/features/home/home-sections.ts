// 홈 3단(내 펀드 → 추천 블로그 글·실전 투자 교육 → 오늘 시장 참고) 판정 — 순수 함수(RN·네트워크 의존 없음, 테스트 대상).
// docs/app_identity_and_nav_redesign_spec.md 2장. 웹(web_client/src/lib/homeSections.ts)과 같은 규칙에
// 모바일만의 '불러오는 중'·'읽기 실패' 상태를 더했다(모바일은 기기 저장소를 비동기로 읽는다).
import type { FundEntry } from '@/features/fund/core';
import type { MarketIndex } from '@/features/market/types';

/** 홈 내 펀드 카드에 한 번에 보여 줄 펀드 수 — 나머지는 '전체 보기'로(웹과 같음) */
export const HOME_FUND_LIMIT = 3;

/** 홈에 보여 줄 추천 블로그 글 수 — 아래 교육 카드·시장 참고가 너무 멀어지지 않게 */
export const HOME_POST_LIMIT = 3;

export type HomeFundCardState =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | { kind: 'funds'; funds: FundEntry[]; more: number };

export type HomeFundCardInput = {
  /** 로그인 상태 복원(SecureStore)이 끝났는가 — 끝나기 전 비로그인은 아직 모른다 */
  hydrated: boolean;
  uid: number | null;
  /** 이 계정에서 읽은 펀드 목록 — 아직 못 읽었으면 null */
  funds: FundEntry[] | null;
  /** 목록 읽기 실패 — '등록된 펀드가 없어요'로 보이면 안 된다 */
  failed: boolean;
};

/**
 * 복원 전 → 로딩 / 비로그인 → 로그인 안내 / 읽기 실패 → 실패 안내 / 읽는 중 → 로딩 /
 * 펀드 없음 → 등록 안내 / 펀드 있음 → 앞에서부터 HOME_FUND_LIMIT 개 + 남은 개수
 */
export function homeFundCardState({ hydrated, uid, funds, failed }: HomeFundCardInput): HomeFundCardState {
  if (uid === null) return hydrated ? { kind: 'guest' } : { kind: 'loading' };
  if (failed) return { kind: 'error' };
  if (funds === null) return { kind: 'loading' };
  if (funds.length === 0) return { kind: 'empty' };
  return { kind: 'funds', funds: funds.slice(0, HOME_FUND_LIMIT), more: Math.max(0, funds.length - HOME_FUND_LIMIT) };
}

const KOSPI = 'KR:0001';
const KOSDAQ = 'KR:1001';
const USD_KRW = 'FX:USDKRW';
/** 미국 대표 지수 우선순위 — S&P500 → 나스닥 종합 → 다우(backend collector/market_indices.py 의 코드) */
const US_HEADLINE = ['US:SPX', 'US:COMP', 'US:DJI'];
const US_NOT_HEADLINE = ['US:VIX', 'US:SOX']; // 변동성·업종 지수는 '대표 지수'가 아니다

/**
 * 홈 하단 '오늘 시장 참고' — 코스피 · 코스닥 · 미국 대표 지수(S&P500 우선, 없으면 나스닥 종합·다우,
 * 그것도 없으면 VIX·반도체를 뺀 US 첫 항목) · 원/달러(FX:USDKRW, 없으면 FX 첫 항목).
 * 없는 것은 건너뛴다(지어내지 않음). 예전 홈 요약의 pickHomeIndices(미국 지수 없음)와는 별개.
 */
export function homeReferenceIndices<T extends Pick<MarketIndex, 'code' | 'region'>>(indices: T[]): T[] {
  const pick = [
    indices.find((i) => i.code === KOSPI),
    indices.find((i) => i.code === KOSDAQ),
    usHeadline(indices),
    indices.find((i) => i.code === USD_KRW) ?? indices.find((i) => i.region === 'FX'),
  ];
  return pick.filter((i): i is T => i != null);
}

function usHeadline<T extends Pick<MarketIndex, 'code' | 'region'>>(indices: T[]): T | undefined {
  for (const code of US_HEADLINE) {
    const hit = indices.find((i) => i.code === code);
    if (hit) return hit;
  }
  return indices.find((i) => i.region === 'US' && !US_NOT_HEADLINE.includes(i.code));
}

/** 시장 참고 칸 표시 — 받아 둔 값이 있으면 표시(재조회 실패해도 유지), 첫 로딩 중이면 자리, 실패면 이 칸만 다시 시도 */
export function marketStripPhase(loading: boolean, hasData: boolean, failed: boolean): 'loading' | 'ready' | 'failed' {
  if (hasData) return 'ready';
  if (failed && !loading) return 'failed';
  return 'loading';
}
