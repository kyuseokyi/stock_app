import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { StaleNotice } from '@/features/market/components/stale-notice';

import { HomeBriefBanner } from './home-brief-banner';
import { HomeIndices, HomeIndicesPlaceholder } from './home-indices';
import { HomeMovers, HomeMoversPlaceholder } from './home-movers';
import { sectionPhase, showStaleNotice } from './summary';
import type { useHomeSummary } from './use-home-summary';

/**
 * 홈 추천 글 위 요약 — AI 브리핑 → 실시간 아님 안내 → 지수 3개 → 급등락 상위 3개.
 * 데이터는 화면이 내려 준다(목록 머리글이 다시 그려져도 칩 선택이 유지되게 표시만 맡는다).
 */
export function HomeSummary({ summary }: { summary: ReturnType<typeof useHomeSummary> }) {
  const router = useRouter();
  const openMarket = useCallback(() => router.navigate('/market'), [router]);
  const openStock = useCallback(
    (ticker: string, name: string) => router.push({ pathname: '/stock/[ticker]', params: { ticker, name } }),
    [router],
  );

  const { brief, indices, movers, moversUpdatedAt } = summary;
  const moverCount = movers.gainers.length + movers.losers.length;
  const indicesPhase = sectionPhase(summary.indicesLoading, indices.length > 0);
  const moversPhase = sectionPhase(summary.moversLoading, moverCount > 0);

  return (
    <View style={styles.wrap}>
      {brief ? <HomeBriefBanner brief={brief} onPress={openMarket} /> : null}
      {showStaleNotice(indices.length, moverCount) ? <StaleNotice inset={false} /> : null}
      {indicesPhase === 'visible' ? <HomeIndices indices={indices} onPress={openMarket} /> : null}
      {indicesPhase === 'loading' ? <HomeIndicesPlaceholder /> : null}
      {moversPhase === 'visible' ? (
        <HomeMovers
          gainers={movers.gainers}
          losers={movers.losers}
          initialSide={movers.initialSide}
          updatedAt={moversUpdatedAt}
          onOpenStock={openStock}
          onMore={openMarket}
        />
      ) : null}
      {moversPhase === 'loading' ? <HomeMoversPlaceholder /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(3), marginBottom: theme.gap(3) },
}));
