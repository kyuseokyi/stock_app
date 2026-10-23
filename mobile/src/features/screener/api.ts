import { stockRequest } from '@/lib/api';

// stock_api GraphQL 스크리너 탭 보이기 스위치(공개). 쿼리 문자열은 backend/tests/test_screener_features.py 계약 테스트가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.

export const SCREENER_FEATURES_QUERY = `query ScreenerFeatures {
  screenerFeatures { finder patterns }
}`;

export interface ScreenerFeatures {
  finder: boolean;
  patterns: boolean;
}

export async function fetchScreenerFeatures(): Promise<ScreenerFeatures> {
  const r = await stockRequest<{ screenerFeatures: ScreenerFeatures }>(SCREENER_FEATURES_QUERY, {});
  return { finder: r.screenerFeatures.finder === true, patterns: r.screenerFeatures.patterns === true };
}
