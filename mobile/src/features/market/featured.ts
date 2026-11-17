// 오늘 특징주 카드 — 화면 규칙(순수 함수, 웹 web_client/src/lib/featured.ts 와 같은 규칙). 렌더 러너가 없어
// 카드의 빈 상태·VI 숨김·탭 되돌림은 이 함수들로 테스트한다(featured.test.ts).
import { closeBasis, formatBasis } from './dashboard';
import type { Featured, ViStock } from './rest-types';

export type FeaturedTab = 'highs' | 'lows' | 'vi';

export const FEATURED_TAB_LABEL: Record<FeaturedTab, string> = { highs: '신고가', lows: '신저가', vi: 'VI 발동' };

/** 빈 상태 문구 — 신고저가 계산 전(date 없음)과 오늘 0종목을 구분 */
export function featuredEmptyText(tab: FeaturedTab, f: Featured): string {
  if (tab === 'vi') return '오늘 VI 발동 종목이 아직 없어요';
  if (!f.date) return '신고가·신저가는 매일 저녁 장 마감 뒤 계산돼요';
  return tab === 'highs' ? '오늘 신고가 종목이 없어요' : '오늘 신저가 종목이 없어요';
}

/** 보이는 탭 — VI 는 데이터(vi)가 있을 때만(키움 미연결·수집 전이면 숨김) */
export function featuredTabs(f: Featured): FeaturedTab[] {
  return f.vi ? ['highs', 'lows', 'vi'] : ['highs', 'lows'];
}

/** 고른 탭이 사라졌으면(VI 숨김) 신고가로 */
export function currentFeaturedTab(selected: FeaturedTab, f: Featured): FeaturedTab {
  return featuredTabs(f).includes(selected) ? selected : 'highs';
}

/** 카드를 띄울지 — 신고저가 스냅숏도 VI 도 없으면(첫 계산 전) 숨김 */
export function hasFeatured(f: Featured | null | undefined): f is Featured {
  return f != null && (f.date != null || f.vi != null);
}

/** 탭 칩 글자 — 개수가 있으면 붙인다(신고가 12) */
export function featuredTabText(tab: FeaturedTab, f: Featured): string {
  const n = tab === 'vi' ? (f.vi?.count ?? 0) : f[tab].count;
  return n > 0 ? `${FEATURED_TAB_LABEL[tab]} ${n}` : FEATURED_TAB_LABEL[tab];
}

/** 탭별 기준 — 신고저가는 '11.16 종가 기준'(오늘이 아니면 '전 거래일(11.16) 종가 기준'), VI 는 '11.17 10:05 기준' */
export function featuredCaption(tab: FeaturedTab, f: Featured, today?: string): string | null {
  if (tab === 'vi') return formatBasis(f.vi?.updatedAt);
  return closeBasis(f.date, today);
}

/** 보이는 목록과 전체 개수 */
export function featuredRows(tab: FeaturedTab, f: Featured): { total: number; shown: number } {
  if (tab === 'vi') return { total: f.vi?.count ?? 0, shown: f.vi?.items.length ?? 0 };
  return { total: f[tab].count, shown: f[tab].items.length };
}

/** 목록이 잘렸을 때 안내 — '전체 35종목 중 20종목' */
export function featuredMoreText(count: number, shown: number): string | null {
  return count > shown ? `전체 ${count}종목 중 ${shown}종목` : null;
}

/** VI 한 줄 보조 글자 — '동적 · 상승 · 2회' */
export function viMeta(x: ViStock): string {
  const dir = x.direction === 'up' ? '상승' : x.direction === 'down' ? '하락' : null;
  return [x.kind || null, dir, x.count > 1 ? `${x.count}회` : null].filter(Boolean).join(' · ');
}
