import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, formatIndex, formatMacro, formatMacroDiff, indexBadge, toneOf } from '../format';
import type { MacroValue, MarketIndex } from '../types';
import { Sparkline } from './sparkline';

/** 지수 카드 — 이름·날짜 자리(장중 배지 / 해외 MM/DD)·종가·등락률·미니 추세선. 2열 배치용(width 48%) */
export function IndexCard({ index }: { index: MarketIndex }) {
  const badge = indexBadge(index);
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${index.name}${badge?.live ? ` ${badge.text} 기준` : ''} ${formatIndex(index.close)}, 전일 대비 ${formatChg(index.chg1d)}`}
    >
      <View style={styles.head}>
        <Text style={styles.name} numberOfLines={1}>{index.name}</Text>
        {badge == null ? null : <Text
            style={badge.live ? styles.live : styles.date}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
          >
            {badge.label}
          </Text>}
      </View>
      <Text style={styles.close} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatIndex(index.close)}</Text>
      <Text style={[styles.chg, styles[toneOf(index.chg1d)]]}>{formatChg(index.chg1d)}</Text>
      <Sparkline values={index.spark} />
    </View>
  );
}

/** 미국 거시 지표 카드 — 값·단위, 직전 대비 */
export function MacroCard({ macro }: { macro: MacroValue }) {
  const diff = macro.prev == null ? null : macro.value - macro.prev;
  const diffText = formatMacroDiff(diff, macro.unit);
  const value = formatMacro(macro.value, macro.unit);
  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={`${macro.name} ${value}, ${macro.date.slice(0, 7)}${diffText ? `, 직전 대비 ${diffText}` : ''}`}
    >
      <Text style={styles.name} numberOfLines={1}>{macro.name}</Text>
      <Text style={styles.close} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Text style={styles.date}>
        {macro.date.slice(0, 7)}
        {diffText ? ` · 직전 대비 ${diffText}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: '48%', backgroundColor: theme.colors.surface, borderRadius: theme.radius.card,
    padding: theme.gap(1.75), gap: 2,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(0.5) },
  name: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: theme.colors.text },
  date: { fontSize: 11, color: theme.colors.textSecondary },
  live: {
    fontSize: 11, fontWeight: '700', color: theme.colors.primary, backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.chip, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
  close: { fontSize: 20, fontWeight: '800', color: theme.colors.text },
  chg: { fontSize: 14, fontWeight: '600' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
}));
