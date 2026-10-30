import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Chip } from '@/ui';

import { formatEok } from '../dashboard';
import type { FlowItem, InvestorFlow } from '../rest-types';

type Who = 'foreign' | 'institution' | 'pension';

/**
 * ⑤-2 투자자별 수급 전광판 — 외국인·기관·연기금(있을 때만) 순매수 Top 10(억), 🔥 쌍끌이, AI 2줄 해설.
 * 연기금이 비면(KIS 폴백 등) 탭을 숨기고, 선택돼 있었다면 외국인으로 되돌린다.
 */
export function FlowBoard({ flow, onOpenStock }: { flow: InvestorFlow; onOpenStock: (ticker: string, name: string) => void }) {
  const [who, setWho] = useState<Who>('foreign');
  const hasPension = flow.pensionTop.length > 0;
  const current: Who = who === 'pension' && !hasPension ? 'foreign' : who;
  const items = current === 'foreign' ? flow.foreignTop : current === 'institution' ? flow.institutionTop : flow.pensionTop;
  return (
    <View style={styles.wrap}>
      {flow.aiComment ? (
        <View style={styles.comment}>
          <Text style={styles.commentBadge}>AI 큰손 자금 해설</Text>
          <Text style={styles.commentText}>{flow.aiComment}</Text>
        </View>
      ) : null}
      <View style={styles.tabs}>
        <Chip label="외국인" selected={current === 'foreign'} onPress={() => setWho('foreign')} />
        <Chip label="기관" selected={current === 'institution'} onPress={() => setWho('institution')} />
        {hasPension ? <Chip label="연기금" selected={current === 'pension'} onPress={() => setWho('pension')} /> : null}
      </View>
      {items.length === 0 ? (
        <Text style={styles.empty}>순매수 데이터가 아직 없어요</Text>
      ) : (
        items.map((x, i) => <FlowRow key={x.ticker} rank={i + 1} item={x} onPress={() => onOpenStock(x.ticker, x.name)} />)
      )}
      {flow.doubleBuy.length > 0 ? (
        <View style={styles.double}>
          <Text style={styles.doubleTitle}>🔥 외국인·기관 쌍끌이</Text>
          {flow.doubleBuy.map((d) => (
            <Pressable
              key={d.ticker}
              style={styles.doubleRow}
              onPress={() => onOpenStock(d.ticker, d.name)}
              accessibilityRole="button"
              accessibilityLabel={`${d.name}, 외국인 ${formatEok(d.foreignAmount)}, 기관 ${formatEok(d.institutionAmount)}`}
              accessibilityHint="종목 상세 보기"
            >
              <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
              <Text style={styles.meta}>
                외 <Text style={styles[tone(d.foreignAmount)]}>{formatEok(d.foreignAmount)}</Text>
                {'  '}기 <Text style={styles[tone(d.institutionAmount)]}>{formatEok(d.institutionAmount)}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

function FlowRow({ rank, item, onPress }: { rank: number; item: FlowItem; onPress: () => void }) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${rank}위 ${item.name}, 순매수 ${formatEok(item.netAmount)}`}
      accessibilityHint="종목 상세 보기"
    >
      <Text style={styles.rank}>{rank}</Text>
      <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
      <Text style={[styles.amount, styles[tone(item.netAmount)]]}>{formatEok(item.netAmount)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(1.5) },
  comment: { backgroundColor: theme.colors.surfaceBlue, borderRadius: theme.radius.button, padding: theme.gap(1.5), gap: theme.gap(0.5) },
  commentBadge: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
  commentText: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  tabs: { flexDirection: 'row', gap: theme.gap(1) },
  empty: { fontSize: 14, color: theme.colors.textSecondary, paddingVertical: theme.gap(1) },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1), minHeight: 40 },
  rank: { width: 20, textAlign: 'center', fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.colors.text },
  amount: { fontSize: 15, fontWeight: '700' },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  flat: { color: theme.colors.text },
  double: { gap: theme.gap(0.5), marginTop: theme.gap(1) },
  doubleTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(0.5) },
  doubleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1), minHeight: 40 },
  meta: { fontSize: 13, color: theme.colors.textSecondary },
}));
