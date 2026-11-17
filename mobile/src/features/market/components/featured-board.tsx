import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatPrice } from '@/features/game/lib/format';
import { Chip } from '@/ui';

import {
  currentFeaturedTab,
  featuredCaption,
  featuredEmptyText,
  featuredMoreText,
  featuredRows,
  featuredTabText,
  featuredTabs,
  viMeta,
  type FeaturedTab,
} from '../featured';
import { formatChg, toneOf } from '../format';
import type { Featured, FeaturedStock, ViStock } from '../rest-types';

type Props = { featured: Featured; today?: string; onOpenStock: (ticker: string, name: string) => void };

/**
 * 오늘 특징주 — 탭(신고가 / 신저가 / VI 발동) + 상위 목록, 종목을 누르면 종목 상세.
 * VI 탭은 데이터가 있을 때만(키움 미연결·수집 전이면 숨김), 사라지면 신고가로 되돌린다.
 */
export function FeaturedBoard({ featured, today, onOpenStock }: Props) {
  const [tab, setTab] = useState<FeaturedTab>('highs');
  const current = currentFeaturedTab(tab, featured);
  const caption = featuredCaption(current, featured, today);
  const { total, shown } = featuredRows(current, featured);
  const more = featuredMoreText(total, shown);
  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {featuredTabs(featured).map((t) => (
          <Chip key={t} label={featuredTabText(t, featured)} selected={current === t} onPress={() => setTab(t)} />
        ))}
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      {shown === 0 ? (
        <Text style={styles.empty}>{featuredEmptyText(current, featured)}</Text>
      ) : current === 'vi' ? (
        featured.vi?.items.map((x) => <ViRow key={x.ticker} item={x} onPress={() => onOpenStock(x.ticker, x.name)} />)
      ) : (
        featured[current].items.map((x, i) => (
          <StockRow key={x.ticker} rank={i + 1} item={x} onPress={() => onOpenStock(x.ticker, x.name)} />
        ))
      )}
      {more ? <Text style={styles.more}>{more}</Text> : null}
    </View>
  );
}

function StockRow({ rank, item, onPress }: { rank: number; item: FeaturedStock; onPress: () => void }) {
  const label = [`${rank}위 ${item.name}`, item.close != null ? `${formatPrice(item.close)}원` : '', formatChg(item.changeRate)]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="종목 상세 보기">
      <Text style={styles.rank}>{rank}</Text>
      <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
      {item.close != null ? <Text style={styles.price}>{formatPrice(item.close)}원</Text> : null}
      <Text style={[styles.chg, styles[toneOf(item.changeRate)]]}>{formatChg(item.changeRate)}</Text>
    </Pressable>
  );
}

function ViRow({ item, onPress }: { item: ViStock; onPress: () => void }) {
  const meta = viMeta(item);
  const time = item.time.slice(0, 5);
  const label = [time ? `${time} 발동` : '', item.name, meta, item.rate != null ? `괴리율 ${formatChg(item.rate)}` : '']
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="종목 상세 보기">
      <Text style={styles.time}>{time || '–'}</Text>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
      </View>
      <View style={styles.right}>
        {item.price != null ? <Text style={styles.price}>{formatPrice(item.price)}원</Text> : null}
        {item.rate != null ? <Text style={[styles.rate, styles[toneOf(item.rate)]]}>괴리 {formatChg(item.rate)}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(1.25) },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  caption: { fontSize: 13, color: theme.colors.textSecondary },
  empty: { fontSize: 14, color: theme.colors.textSecondary, paddingVertical: theme.gap(1) },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1), minHeight: 44 },
  rank: { width: 20, textAlign: 'center', fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  time: { width: 44, fontSize: 13, fontVariant: ['tabular-nums'], color: theme.colors.textSecondary },
  body: { flex: 1, gap: 2 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: theme.colors.text },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
  right: { marginLeft: 'auto', alignItems: 'flex-end', gap: 2 },
  price: { marginLeft: 'auto', fontSize: 14, color: theme.colors.textSecondary },
  chg: { minWidth: 56, textAlign: 'right', fontSize: 15, fontWeight: '700' },
  rate: { fontSize: 12, fontWeight: '700' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  more: { fontSize: 12, color: theme.colors.textSecondary, textAlign: 'right' },
}));
