import { stockRequest } from '@/lib/api';

// stock_api GraphQL 스크리너 탭 보이기 스위치(공개). 쿼리 문자열은 backend/tests/test_screener_features.py 계약 테스트가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.

export const SCREENER_FEATURES_QUERY = `query ScreenerFeatures {
  screenerFeatures { stockFinder finder patterns marketData marketIndexKr }
}`;

export interface ScreenerFeatures {
  /** 사용자 화면 종목 찾기(주도주·조건검색·패턴) 전체 — 꺼지면 finder·patterns 와 무관하게 모두 숨김(스크리너 탭째 숨김) */
  stockFinder: boolean;
  finder: boolean;
  patterns: boolean;
  /** 요청자 기준 시세 열람 가능(A안 — 스위치 ON·관리자·열람 권한 회원). false 면 시세 섹션·탭 자체를 그리지 않는다 */
  marketData: boolean;
  /** 요청자 기준 국내 지수(코스피·코스닥) 열람 가능 — marketData 이거나 관리자가 '국내 지수 공개'를 켰을 때 */
  marketIndexKr: boolean;
}

export async function fetchScreenerFeatures(): Promise<ScreenerFeatures> {
  const r = await stockRequest<{ screenerFeatures: ScreenerFeatures }>(SCREENER_FEATURES_QUERY, {});
  return {
    stockFinder: r.screenerFeatures.stockFinder === true,
    finder: r.screenerFeatures.finder === true,
    patterns: r.screenerFeatures.patterns === true,
    marketData: r.screenerFeatures.marketData === true,
    marketIndexKr: r.screenerFeatures.marketIndexKr === true,
  };
}
