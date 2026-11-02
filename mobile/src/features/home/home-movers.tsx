import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatBasis } from '@/features/market/dashboard';
import { formatChg, toneOf } from '@/features/market/format';
import type { Mover } from '@/features/market/rest-types';
import { Chip, SectionHead } from '@/ui';

import type { MoverSide } from './summary';

type Props = {
  gainers: Mover[];
  losers: Mover[];
  initialSide: MoverSide;
  updatedAt: string | null;
  onOpenStock: (ticker: string, name: string) => void;
  onMore: () => void;
};

/** 홈 급등·급락 상위 3개 + AI 원인 한 줄 — 좁은 폭이라 칩으로 전환. 전체 목록은 마켓 탭에서 */
export function HomeMovers({ gainers, losers, initialSide, updatedAt, onOpenStock, onMore }: Props) {
  const [side, setSide] = useState<MoverSide>(initialSide);
  const items = side === 'gainers' ? gainers : losers;
  return (
    <View style={styles.card}>
      <SectionHead title="급등락 & AI 원인" caption={formatBasis(updatedAt)} />
      <View style={styles.tabs}>
        <Chip label="급등" selected={side === 'gainers'} onPress={() => setSide('gainers')} />
        <Chip label="급락" selected={side === 'losers'} onPress={() => setSide('losers')} />
      </View>
      {items.length === 0 ? (
        <Text style={styles.empty}>아직 {side === 'gainers' ? '급등' : '급락'} 종목이 없어요</Text>
      ) : (
        <View>
          {items.map((m) => <MoverRow key={m.ticker} item={m} onPress={() => onOpenStock(m.ticker, m.stockName)} />)}
        </View>
      )}
      <Pressable style={styles.more} onPress={onMore} hitSlop={8} accessibilityRole="button" accessibilityLabel="마켓에서 급등락 더 보기">
        <Text style={styles.moreText}>마켓에서 더 보기 ›</Text>
      </Pressable>
    </View>
  );
}

function MoverRow({ item, onPress }: { item: Mover; onPress: () => void }) {
  const weak = item.reliability === '하'; // 신뢰도 '하'는 마켓 탭처럼 흐리게 + '확인 필요'
  const label = [item.stockName, formatChg(item.changeRate), item.reasonSummary ? `원인 ${item.reasonSummary}` : '', weak ? '확인 필요' : '']
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="종목 상세 보기">
      <View style={styles.line}>
        <Text style={styles.name} numberOfLines={1}>{item.stockName}</Text>
        <Text style={[styles.chg, styles[toneOf(item.changeRate)]]}>{formatChg(item.changeRate)}</Text>
      </View>
      {item.reasonSummary ? (
        <View style={styles.line}>
          <Text style={[styles.reason, weak && styles.weak]} numberOfLines={1}>
            <Text style={styles.ai}>AI </Text>
            {item.reasonSummary}
          </Text>
          {weak ? <Text style={styles.check}>확인 필요</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/** 첫 로딩 동안 자리만 잡아 둔다 */
export function HomeMoversPlaceholder() {
  return <View style={styles.placeholder} />;
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1.5) },
  tabs: { flexDirection: 'row', gap: theme.gap(1) },
  empty: { fontSize: 14, color: theme.colors.textSecondary, paddingVertical: theme.gap(1) },
  row: { gap: 2, paddingVertical: theme.gap(1) },
  line: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: theme.colors.text },
  chg: { fontSize: 15, fontWeight: '700' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  reason: { flex: 1, fontSize: 13, lineHeight: 19, color: theme.colors.textSecondary },
  weak: { opacity: 0.55 },
  ai: { fontWeight: '800', color: theme.colors.primary },
  check: {
    fontSize: 11, fontWeight: '700', color: theme.colors.textSecondary, backgroundColor: theme.colors.fill,
    borderRadius: theme.radius.chip, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden',
  },
  more: { alignSelf: 'flex-end' },
  moreText: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  placeholder: { height: 280, borderRadius: theme.radius.card, backgroundColor: theme.colors.fill },
}));
