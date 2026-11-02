import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { indexHeaderBasis } from '@/features/market/dashboard';
import { formatChg, formatIndex, indexChipCaption } from '@/features/market/format';
import { indexTone } from '@/features/market/overview-groups';
import type { MarketIndex } from '@/features/market/types';
import { SectionHead } from '@/ui';

/** 홈 지수 3개(코스피·코스닥·원/달러) — 좁은 폭에 맞춘 3열 카드. 국내 확정 지수는 카드 캡션이 없어 머리글에 기준을 적는다 */
export function HomeIndices({ indices, onPress }: { indices: MarketIndex[]; onPress: () => void }) {
  return (
    <View style={styles.section}>
      <SectionHead title="주요 지수" caption={indexHeaderBasis(indices)} />
      <View style={styles.row}>
        {indices.map((ix) => <IndexTile key={ix.code} index={ix} onPress={onPress} />)}
      </View>
    </View>
  );
}

function IndexTile({ index, onPress }: { index: MarketIndex; onPress: () => void }) {
  const caption = indexChipCaption(index);
  return (
    <Pressable
      style={styles.tile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${index.name} ${formatIndex(index.close)}, 전일 대비 ${formatChg(index.chg1d)}${caption ? `, ${caption} 기준` : ''}`}
      accessibilityHint="마켓 탭에서 보기"
    >
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>{index.name}</Text>
        {index.live ? <View style={styles.dot} /> : null}
      </View>
      <Text style={styles.close} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatIndex(index.close)}</Text>
      <Text style={[styles.chg, styles[indexTone(index)]]} numberOfLines={1}>{formatChg(index.chg1d)}</Text>
      {caption ? <Text style={styles.caption} numberOfLines={1}>{caption}</Text> : null}
    </Pressable>
  );
}

/** 첫 로딩 동안 자리만 잡아 둔다 — 지수가 늦게 와도 아래 내용이 크게 밀리지 않게 */
export function HomeIndicesPlaceholder() {
  return <View style={styles.placeholder} />;
}

const styles = StyleSheet.create((theme) => ({
  section: { gap: theme.gap(1.5) },
  row: { flexDirection: 'row', gap: theme.gap(1) },
  tile: {
    flex: 1, minWidth: 0, backgroundColor: theme.colors.surface, borderRadius: theme.radius.card,
    paddingHorizontal: theme.gap(1.5), paddingVertical: theme.gap(1.5), gap: 2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5) },
  name: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.primary },
  close: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  chg: { fontSize: 13, fontWeight: '700' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  caption: { fontSize: 11, lineHeight: 14, color: theme.colors.textSecondary },
  placeholder: { height: 156, borderRadius: theme.radius.card, backgroundColor: theme.colors.fill },
}));
