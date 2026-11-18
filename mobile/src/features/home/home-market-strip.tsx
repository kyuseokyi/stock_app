import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { fetchMarketOverview } from '@/features/market/api';
import { formatChg, formatIndex } from '@/features/market/format';
import { indexTone } from '@/features/market/overview-groups';
import type { MarketIndex } from '@/features/market/types';
import { useAutoRefresh } from '@/features/market/use-auto-refresh';
import { useRestResource } from '@/features/market/use-rest-resource';
import { Card } from '@/ui';

import { homeReferenceIndices, marketStripPhase } from './home-sections';

/**
 * 홈 최하단 '오늘 시장 참고' 데이터 — 시장 개요 1건만 받는다(예전 홈 요약의 브리핑·급등락 조회는 하지 않음).
 * 지수는 홈이 포커스·앱이 앞에 있을 때 30초마다 조용히 갱신(예전 홈과 같은 주기).
 * 홈 화면이 들고 당겨서 새로고침에 함께 넘긴다 — 실패해도 throw 하지 않는다(이 칸만 다시 시도).
 */
export function useHomeMarketStrip() {
  const overview = useRestResource(fetchMarketOverview);
  const indices = useMemo(() => homeReferenceIndices(overview.data?.indices ?? []), [overview.data]);

  // 첫 로딩 중이면 자동 갱신을 건너뛰어 개요를 두 번 받지 않게(use-home-summary 와 같은 방식)
  const loadingRef = useRef(true);
  useEffect(() => {
    loadingRef.current = overview.loading;
  }, [overview.loading]);
  const silent = overview.silentRefresh;
  useAutoRefresh(useCallback(async () => (loadingRef.current ? undefined : silent()), [silent]));

  // 당겨서 새로고침은 reload — throw 하지 않고, 실패하면 error 를 남겨 '다시 시도'로 이어진다
  // (refresh 는 실패 시 상태를 안 써서 첫 로딩과 겹치면 자리 표시에서 멈출 수 있다). 받아 둔 값은 유지된다
  const { reload } = overview;
  const refresh = reload;

  return {
    indices,
    phase: marketStripPhase(overview.loading, overview.data !== null, overview.error !== null),
    reload,
    refresh,
  };
}

export type HomeMarketStripData = ReturnType<typeof useHomeMarketStrip>;

/**
 * 홈 최하단 '오늘 시장 참고' — 코스피 · 코스닥 · 미국 대표 지수 · 원/달러만 2×2 로 작게. 전체 시장은 시장 탭(/market).
 * 이 칸만 따로 불러와 실패해도 위 펀드·교육 카드는 그대로 보이고, 이 칸에서만 다시 시도한다.
 * (예전 홈 요약 home-summary·home-indices 등은 지우지 않고 보존 — 다시 켤 때 홈에서 바꿔 끼우면 된다)
 */
export function HomeMarketStrip({ strip }: { strip: HomeMarketStripData }) {
  const router = useRouter();
  const goMarket = () => router.push('/market');
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">오늘 시장 참고</Text>
        <Pressable onPress={goMarket} style={styles.more} accessibilityRole="link" accessibilityLabel="시장 더보기">
          <Text style={styles.moreText}>시장 더보기 ›</Text>
        </Pressable>
      </View>

      {strip.phase === 'loading' ? (
        <View style={styles.grid} accessibilityLabel="오늘 시장을 불러오고 있어요">
          {[0, 1, 2, 3].map((i) => <View key={i} style={[styles.tile, styles.placeholder]} />)}
        </View>
      ) : null}

      {strip.phase === 'failed' ? (
        <Card style={styles.failed}>
          <Text style={styles.failedText}>시장 지수를 불러오지 못했어요</Text>
          <Pressable onPress={() => void strip.reload()} style={styles.retry} accessibilityRole="button">
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </Card>
      ) : null}

      {strip.phase === 'ready' ? (
        strip.indices.length === 0 ? (
          <Card>
            <Text style={styles.failedText}>시장 데이터는 매일 장 마감 후 갱신돼요.</Text>
          </Card>
        ) : (
          <View style={styles.grid}>
            {strip.indices.map((ix) => <IndexTile key={ix.code} index={ix} onPress={goMarket} />)}
          </View>
        )
      ) : null}

      <Text style={styles.note}>ⓘ 실시간 시세가 아니어서 실제 값과 차이가 있을 수 있어요. 투자 판단의 참고 자료예요.</Text>
    </View>
  );
}

function IndexTile({ index, onPress }: { index: MarketIndex; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${index.name} ${formatIndex(index.close)}, 전일 대비 ${formatChg(index.chg1d)}`}
      accessibilityHint="시장 탭에서 보기">
      <Text style={styles.name} numberOfLines={1}>{index.name}</Text>
      <View style={styles.values}>
        <Text style={styles.close} numberOfLines={1}>{formatIndex(index.close)}</Text>
        <Text style={[styles.chg, styles[indexTone(index)]]} numberOfLines={1}>{formatChg(index.chg1d)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.gap(1.5) },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text },
  more: { minHeight: 44, justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  tile: {
    // 2열 — gap(1)=8 의 절반만큼 뺀다
    width: '48.5%',
    flexGrow: 1,
    minHeight: 64,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(1.25),
    gap: 2,
  },
  placeholder: { backgroundColor: theme.colors.fill },
  pressed: { opacity: 0.7 },
  name: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
  values: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: theme.gap(0.75) },
  close: { fontSize: 16, fontWeight: '800', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  chg: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  failed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1) },
  failedText: { flexShrink: 1, fontSize: 14, color: theme.colors.textSecondary },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.gap(2), borderRadius: theme.radius.button, backgroundColor: theme.colors.fill },
  retryText: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  note: { fontSize: 12, lineHeight: 17, color: theme.colors.textSecondary },
}));
