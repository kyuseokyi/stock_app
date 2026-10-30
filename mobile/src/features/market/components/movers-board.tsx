import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatPrice } from '@/features/game/lib/format';
import { Chip } from '@/ui';

import { formatChg, toneOf } from '../format';
import type { Mover } from '../rest-types';

type Side = 'gainers' | 'losers';

/**
 * ⑤ 급등·급락 Top 10 + AI 원인 — 구분선 없는 리스트(여백 위계).
 * 1줄: 순위·종목명·현재가·등락률 / 2줄: AI 원인 칩(fill) / 3줄: 재료 태그·주의 문구.
 * 신뢰도 '하'는 흐리게 + '확인 필요'.
 */
export function MoversBoard({ gainers, losers, onOpenStock }: {
  gainers: Mover[];
  losers: Mover[];
  onOpenStock: (ticker: string, name: string) => void;
}) {
  const [side, setSide] = useState<Side>(gainers.length > 0 || losers.length === 0 ? 'gainers' : 'losers');
  const items = side === 'gainers' ? gainers : losers;
  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        <Chip label="급등 Top 10" selected={side === 'gainers'} onPress={() => setSide('gainers')} />
        <Chip label="급락 Top 10" selected={side === 'losers'} onPress={() => setSide('losers')} />
      </View>
      {items.length === 0 ? (
        <Text style={styles.empty}>아직 {side === 'gainers' ? '급등' : '급락'} 종목이 없어요</Text>
      ) : (
        items.map((m, i) => <MoverRow key={m.ticker} rank={i + 1} item={m} onPress={() => onOpenStock(m.ticker, m.stockName)} />)
      )}
    </View>
  );
}

function MoverRow({ rank, item, onPress }: { rank: number; item: Mover; onPress: () => void }) {
  const weak = item.reliability === '하';
  const label = [
    `${rank}위 ${item.stockName}`,
    item.price != null ? `${formatPrice(item.price)}원` : '',
    formatChg(item.changeRate),
    item.reasonSummary ? `원인 ${item.reasonSummary}` : '',
    weak ? '확인 필요' : '',
    item.category ?? '',
    item.riskWarning ? `주의 ${item.riskWarning}` : '',
  ].filter(Boolean).join(', ');
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="종목 상세 보기">
      <View style={styles.line}>
        <Text style={styles.rank}>{rank}</Text>
        <Text style={styles.name} numberOfLines={1}>{item.stockName}</Text>
        {item.price != null ? <Text style={styles.price}>{formatPrice(item.price)}원</Text> : null}
        <Text style={[styles.chg, styles[toneOf(item.changeRate)]]}>{formatChg(item.changeRate)}</Text>
      </View>
      {item.reasonSummary ? (
        <View style={[styles.indent, weak && styles.weak]}>
          <Text style={styles.reason}>
            <Text style={styles.ai}>AI </Text>
            {item.reasonSummary}
          </Text>
        </View>
      ) : null}
      {item.category || weak || item.riskWarning ? (
        <View style={[styles.indent, styles.tags]}>
          {item.category ? <Text style={styles.tag}>{item.category}</Text> : null}
          {weak ? <Text style={styles.check}>확인 필요</Text> : null}
          {item.riskWarning ? <Text style={styles.warn} numberOfLines={2}>⚠ {item.riskWarning}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(1.5) },
  tabs: { flexDirection: 'row', gap: theme.gap(1) },
  empty: { fontSize: 14, color: theme.colors.textSecondary, paddingVertical: theme.gap(1) },
  row: { gap: theme.gap(0.75), paddingVertical: theme.gap(1) },
  line: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  rank: { width: 20, textAlign: 'center', fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: theme.colors.text },
  price: { marginLeft: 'auto', fontSize: 14, color: theme.colors.textSecondary },
  chg: { minWidth: 56, textAlign: 'right', fontSize: 15, fontWeight: '700' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  indent: { marginLeft: 28 },
  weak: { opacity: 0.55 },
  reason: {
    alignSelf: 'flex-start', fontSize: 13, lineHeight: 19, color: theme.colors.text, backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.input, paddingHorizontal: theme.gap(1.25), paddingVertical: theme.gap(0.75), overflow: 'hidden',
  },
  ai: { fontWeight: '800', color: theme.colors.primary },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap(0.75) },
  tag: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
  check: {
    fontSize: 11, fontWeight: '700', color: theme.colors.textSecondary, backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.chip, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
  warn: { flexShrink: 1, fontSize: 12, color: theme.colors.up },
}));
