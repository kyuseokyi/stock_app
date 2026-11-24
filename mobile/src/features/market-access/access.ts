// A안(시세 비노출) 화면 숨김 판정 — RN 의존 없는 순수 함수(jest 로 검사). 웹 web_client/src/lib/marketAccess.ts 와 같은 규칙.
// 서버가 요청자 기준으로 준 값(screenerFeatures.marketData·marketIndexKr, 게임 seasons/active features.real_market)만 본다.
// 기본은 닫힘: 아직 모름(null)·조회 실패·필드 없음은 모두 숨김. 숨긴 섹션은 빈 칸이 아니라 섹션 자체를 그리지 않는다.
// 설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 3절

export type MarketAccessFlags = { marketData?: boolean; marketIndexKr?: boolean };

/** 국내 지수 공개 스위치로 열리는 지수 — 서버 shared/market_viewer.KR_PUBLIC_INDEX_CODES 와 같다 */
export const KR_PUBLIC_INDEX_CODES: readonly string[] = ['KR:0001', 'KR:1001'];

/** 개별 시세(차트·순위·테마·업종·급등락·수급·특징주·스크리너·대차·패턴)를 그릴지 */
export function marketDataVisible(flags: MarketAccessFlags | null | undefined): boolean {
  return flags?.marketData === true;
}

/** 지수를 하나라도 볼 수 있는가(홈 시장 참고 섹션을 그릴지) */
export function anyIndexVisible(flags: MarketAccessFlags | null | undefined): boolean {
  return marketDataVisible(flags) || flags?.marketIndexKr === true;
}

/** 지수 한 개를 그릴지 — 시세 열람이면 전부, 아니면 국내 지수 공개 스위치일 때 코스피·코스닥만 */
export function indexVisible(flags: MarketAccessFlags | null | undefined, code: string): boolean {
  if (marketDataVisible(flags)) return true;
  return flags?.marketIndexKr === true && KR_PUBLIC_INDEX_CODES.includes(code);
}

/** 지수 목록에서 그릴 것만 — 서버가 이미 거르지만(스위치 변경 직후·이전 응답 대비) 화면도 한 번 더 거른다 */
export function visibleIndices<T extends { code: string }>(flags: MarketAccessFlags | null | undefined, list: readonly T[]): T[] {
  return list.filter((ix) => indexVisible(flags, ix.code));
}

/** 게임 탭·화면 — 요청자 기준 실제 시세 게임 허용(real_market)일 때만. 시즌 없음·조회 실패·옛 서버(필드 없음)는 숨김 */
export function gameVisible(realMarket: boolean | null | undefined): boolean {
  return realMarket === true;
}

/** 시즌 응답 → real_market. 시즌이 없으면(null) false — 판단할 값이 없으므로 닫힘 */
export function realMarketOf(season: { features?: { real_market?: boolean } } | null | undefined): boolean {
  return season?.features?.real_market === true;
}

/** 교육용 합성 종가 게임 상태 응답(GET /api/game/edu/state) → enabled. 응답 없음·필드 없음은 false(닫힘) */
export function eduEnabledOf(state: { enabled?: boolean } | null | undefined): boolean {
  return state?.enabled === true;
}

/** edu/state 응답에서 게임 분기에 쓰는 두 값 */
export type EduGate = { enabled: boolean; realMarketSwitch: boolean };

/** edu/state 응답 → { enabled, realMarketSwitch(관리자 전역 REAL_MARKET) }. 응답·필드 없음은 false(닫힘) */
export function eduGateOf(state: { enabled?: boolean; real_market_switch?: boolean } | null | undefined): EduGate {
  return { enabled: eduEnabledOf(state), realMarketSwitch: state?.real_market_switch === true };
}

/**
 * 하단 게임 탭 노출 — 관리자 전역 스위치(REAL_MARKET, edu/features 의 real_market_switch) 하나로 정한다.
 * 스위치 ON → 실시간 게임만(요청자 기준 real_market 허용일 때), OFF → 가상 데이터 게임만(edu 공개일 때). 스위치 모름·실패는 숨김.
 * 웹 web_client/src/lib/marketAccess.ts 의 gameTabVisible 과 같은 규칙
 */
export function gameTabVisible(
  realMarket: boolean | null | undefined,
  edu: boolean | null | undefined,
  realMarketSwitch: boolean | null | undefined,
): boolean {
  if (realMarketSwitch === true) return realMarket === true;
  if (realMarketSwitch === false) return edu === true;
  return false;
}

/** 게임 탭 화면 — loading: 판단값을 묻는 중(아무 게임도 마운트하지 않음), none: 안내 카드. 두 게임을 함께 보이는 경우는 없다 */
export type GameTabMode = 'loading' | 'real' | 'edu' | 'none';

/**
 * 게임 탭에 무엇을 그릴지 — 스위치 값을 알 때까지 loading.
 * 스위치 ON → real(실시간 허용일 때, 기존 그대로) / none, OFF → edu(가상 데이터 게임 공개일 때) / none
 */
export function gameTabMode(
  realMarket: boolean | null | undefined,
  edu: boolean | null | undefined,
  realMarketSwitch: boolean | null | undefined,
): GameTabMode {
  if (realMarketSwitch == null) return 'loading';
  if (realMarketSwitch) {
    if (realMarket == null) return 'loading';
    return realMarket ? 'real' : 'none';
  }
  return edu === true ? 'edu' : 'none';
}

/** 종목 상세 링크아웃(설계 3-4 "시세는 증권사 앱에서") — 포털 종목 화면 주소(링크만, 내용을 가져오지 않음). 6자리 코드만 */
export function stockLinkOutUrl(ticker: string): string | null {
  return /^[0-9A-Z]{6}$/.test(ticker) ? `https://m.stock.naver.com/domestic/stock/${ticker}/total` : null;
}
