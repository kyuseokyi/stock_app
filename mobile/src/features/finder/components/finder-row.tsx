import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { formatAmount, formatChg, formatIndex, toneOf } from '@/features/market/format';

import { gcLabel, maOrderLabel, rsiTone } from '../finder';
import type { FinderItem } from '../types';

type BadgeTone = 'up' | 'down' | 'flat' | 'primary';
const BADGE_BG = { up: 'upSoft', down: 'downSoft', flat: 'fill', primary: 'primarySoft' } as const;
const BADGE_FG = { up: 'up', down: 'down', flat: 'textSecondary', primary: 'primary' } as const;

function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  const { theme } = useUnistyles();
  return (
    <View style={[styles.badge, { backgroundColor: theme.colors[BADGE_BG[tone]] }]}>
      <Text style={[styles.badgeText, { color: theme.colors[BADGE_FG[tone]] }]}>{label}</Text>
    </View>
  );
}

/** 조건검색 목록 한 줄 — 종목명/티커·지표 배지·업종(없으면 시장)·종가·등락률(상승 빨강·하락 파랑)·거래대금. 누르면 onPress */
export function FinderRow({ item, onPress }: { item: FinderItem; onPress: () => void }) {
  const { theme } = useUnistyles();
  const tone = toneOf(item.chg1d);
  const chgColor = tone === 'up' ? theme.colors.up : tone === 'down' ? theme.colors.down : theme.colors.textSecondary;
  const gc = gcLabel(item.gcDays);
  const order = maOrderLabel(item.maOrder);
  // 라벨이 자식 글자를 덮으므로 화면 낭독기가 들을 값을 모두 담는다
  const label = [
    `${item.name} ${item.ticker}`,
    item.isNewHigh ? '신고가' : '',
    gc ?? '',
    item.rsi14 !== null ? `RSI ${Math.round(item.rsi14)}` : '',
    order ?? '',
    item.sectorName ?? item.market,
    `종가 ${formatIndex(item.close)}원`,
    `등락률 ${formatChg(item.chg1d)}`,
    `거래대금 ${formatAmount(item.value)}`,
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
          {item.isNewHigh ? <Badge label="신고가" tone="up" /> : null}
          {gc ? <Badge label={gc} tone="primary" /> : null}
          {item.rsi14 !== null ? <Badge label={`RSI ${Math.round(item.rsi14)}`} tone={rsiTone(item.rsi14)} /> : null}
          {order ? <Badge label={order} tone={item.maOrder === 1 ? 'up' : 'down'} /> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{item.sectorName ?? item.market}</Text>
      </View>
      <View style={styles.nums}>
        <Text style={styles.price}>{formatIndex(item.close)}</Text>
        <Text style={[styles.chg, { color: chgColor }]}>{formatChg(item.chg1d)}</Text>
        <Text style={styles.meta}>{formatAmount(item.value)}</Text>
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
  chg: { fontSize: 13, fontWeight: '700' },
}));
