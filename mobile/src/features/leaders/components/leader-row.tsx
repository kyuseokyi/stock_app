import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, formatIndex } from '@/features/market/format';

import type { CanslimItem } from '../types';
import { LetterBadges } from './letter-badges';

/** 주도주 목록 한 줄 — 점수 상자·종목명/티커·C~M 배지·업종(없으면 시장)·RS·종가·고점 대비. 누르면 onPress */
export function LeaderRow({ item, onPress }: { item: CanslimItem; onPress: () => void }) {
  // 라벨이 자식 글자를 덮으므로 화면 낭독기가 들을 값을 모두 담는다
  const label = [
    `${item.name} ${item.ticker}`,
    `${item.score}점`,
    `7개 중 ${item.passCount}개 통과`,
    item.sectorName ?? item.market,
    item.rs !== null ? `RS ${item.rs}` : '',
    `종가 ${formatIndex(item.close)}원`,
    item.pctFromHigh !== null ? `고점 대비 ${formatChg(item.pctFromHigh)}` : '',
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
      <View style={styles.scoreBox}>
        <Text style={styles.score}>{item.score}</Text>
        <Text style={styles.unit}>점</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.ticker}>{item.ticker}</Text>
        </View>
        <LetterBadges letters={item.letters} />
        <Text style={styles.meta} numberOfLines={1}>
          {item.sectorName ?? item.market}
          {item.rs !== null ? ` · RS ${item.rs}` : ''}
        </Text>
      </View>
      <View style={styles.nums}>
        <Text style={styles.price}>{formatIndex(item.close)}</Text>
        {item.pctFromHigh !== null ? <Text style={styles.meta}>고점 {formatChg(item.pctFromHigh)}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), paddingVertical: theme.gap(1.25) },
  pressed: { opacity: 0.6 },
  scoreBox: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: theme.colors.fill,
    alignItems: 'center', justifyContent: 'center',
  },
  score: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  unit: { fontSize: 10, color: theme.colors.textSecondary },
  body: { flex: 1, gap: theme.gap(0.5) },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75) },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  ticker: { fontSize: 12, color: theme.colors.textSecondary },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  nums: { alignItems: 'flex-end', gap: 2 },
  price: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
}));
