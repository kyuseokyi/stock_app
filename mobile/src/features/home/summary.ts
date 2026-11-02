// 앱 홈 요약 표시용 순수 함수 — 지수 3개 고르기·급등락 상위 자르기·섹션 표시 판정. RN·네트워크 의존 없음(테스트 대상).
import type { Mover, Movers } from '@/features/market/rest-types';
import type { MarketIndex } from '@/features/market/types';

/** 홈에 보이는 지수 — 코스피·코스닥·원/달러 순서 */
export const HOME_INDEX_CODES = ['KR:0001', 'KR:1001', 'FX:USDKRW'];

/** 홈 급등·급락 한 묶음에 보이는 종목 수 */
export const HOME_MOVER_COUNT = 3;

export type MoverSide = 'gainers' | 'losers';

/** 정해진 순서로 3개를 고른다. 응답에 없는 지수는 건너뛴다 */
export function pickHomeIndices<T extends Pick<MarketIndex, 'code'>>(indices: T[]): T[] {
  return HOME_INDEX_CODES.map((c) => indices.find((i) => i.code === c)).filter((i): i is T => i != null);
}

/** 급등·급락을 상위 n 개로 자른다. 처음 고를 쪽은 급등 — 급등이 없고 급락만 있으면 급락 */
export function topMovers(
  movers: Pick<Movers, 'gainers' | 'losers'> | null,
  n = HOME_MOVER_COUNT,
): { gainers: Mover[]; losers: Mover[]; initialSide: MoverSide } {
  const gainers = movers?.gainers.slice(0, n) ?? [];
  const losers = movers?.losers.slice(0, n) ?? [];
  return { gainers, losers, initialSide: gainers.length > 0 || losers.length === 0 ? 'gainers' : 'losers' };
}

/** 첫 로딩 중에는 자리만 잡고, 보여 줄 값이 있으면 표시, 실패·빈 응답이면 조용히 숨긴다(받아 둔 값이 있으면 재조회 중에도 표시) */
export function sectionPhase(loading: boolean, hasContent: boolean): 'loading' | 'visible' | 'hidden' {
  if (hasContent) return 'visible';
  return loading ? 'loading' : 'hidden';
}

/** 실시간 아님 안내 — 시세(지수·급등락)가 화면에 보일 때만 */
export function showStaleNotice(indexCount: number, moverCount: number): boolean {
  return indexCount + moverCount > 0;
}
