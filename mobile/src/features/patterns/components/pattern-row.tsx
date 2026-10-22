import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { formatChg, formatIndex } from '@/features/market/format';

import { breakoutText, patternLabel, stageText } from '../patterns';
import type { PatternItem } from '../types';

/** 차트 패턴 목록 한 줄 — 종목명/티커·패턴·단계·상태 배지·업종(없으면 시장)·종가·피벗·피벗 대비 %. 누르면 onPress */
export function PatternRow({ item, onPress }: { item: PatternItem; onPress: () => void }) {
  const { theme } = useUnistyles();
  const pattern = patternLabel(item.patternType);
  const stage = stageText(item.stage, item.label);
  const status = breakoutText(item.isActive, item.daysSinceBreakout);
  const dist = item.pivotDistPct;
  const distColor = dist === null || dist === 0 ? theme.colors.textSecondary : dist > 0 ? theme.colors.up : theme.colors.down;
  const label = [
    `${item.name} ${item.ticker}`,
    `${pattern} ${stage}`,
    status,
    item.sectorName ?? item.market,
    `종가 ${formatIndex(item.close)}원`,
    `피벗 ${formatIndex(item.pivot)}원`,
    dist !== null ? `피벗 대비 ${formatChg(dist)}` : '',
    `깊이 ${item.depth.toFixed(0)}%, 길이 ${item.length}일`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="종목 상세 보기"
    >
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.ticker}>{item.ticker}</Text>
        </View>
        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: theme.colors.primarySoft }]}>
            <Text style={[styles.badgeText, { color: theme.colors.primary }]}>{pattern} · {stage}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: item.isActive ? theme.colors.fill : theme.colors.upSoft }]}>
            <Text style={[styles.badgeText, { color: item.isActive ? theme.colors.textSecondary : theme.colors.up }]}>{status}</Text>
          </View>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {item.sectorName ?? item.market} · 깊이 {item.depth.toFixed(0)}% · {item.length}일
        </Text>
      </View>
      <View style={styles.nums}>
        <Text style={styles.price}>{formatIndex(item.close)}</Text>
        <Text style={[styles.dist, { color: distColor }]}>{dist !== null ? formatChg(dist) : '–'}</Text>
        <Text style={styles.meta}>피벗 {formatIndex(item.pivot)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), paddingVertical: theme.gap(1.25) },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: theme.gap(0.5) },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75) },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  ticker: { fontSize: 12, color: theme.colors.textSecondary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(0.5) },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  nums: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  dist: { fontSize: 13, fontWeight: '700' },
}));
