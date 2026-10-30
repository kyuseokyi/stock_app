import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, formatIndex, toneOf } from '../format';
import type { MarketIndex } from '../types';
import { Sparkline } from './sparkline';

/** 원/달러는 오르는 게 좋은 일이 아니라 등락률을 본문색으로(IndexCard 의 hint 와 같은 규칙) */
const NEUTRAL = ['FX:USDKRW', 'US:VIX'];

/** 지수 캐러셀 카드(140×90, surface) — 지수명·현재값·등락률·미니 추세선. 2열 IndexCard 의 가로 스크롤용 변형 */
export function IndexChipCard({ index }: { index: MarketIndex }) {
  const tone = NEUTRAL.includes(index.code) ? 'flat' : toneOf(index.chg1d);
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${index.name} ${formatIndex(index.close)}, 전일 대비 ${formatChg(index.chg1d)}${index.live && index.asOf ? `, 장중 ${index.asOf} 기준` : ''}`}
    >
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>{index.name}</Text>
        {index.live ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.row}>
        <Text style={styles.close} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatIndex(index.close)}</Text>
        <Text style={[styles.chg, styles[tone]]}>{formatChg(index.chg1d)}</Text>
      </View>
      <View style={styles.spark}>
        <Sparkline values={index.spark} height={24} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: 140, height: 90, backgroundColor: theme.colors.surface, borderRadius: theme.radius.card,
    paddingHorizontal: theme.gap(1.5), paddingTop: theme.gap(1.25), paddingBottom: theme.gap(0.75),
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5) },
  name: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.primary },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.5), marginTop: 2 },
  close: { flexShrink: 1, fontSize: 16, fontWeight: '800', color: theme.colors.text },
  chg: { fontSize: 12, fontWeight: '700' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  spark: { marginTop: 'auto' },
}));
