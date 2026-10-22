import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatChg, formatIndex } from '@/features/market/format';

import { breakoutText, patternLabel, pivotDistPct, stageText } from '../patterns';
import type { PatternBase } from '../types';

/** 종목 상세 '차트 패턴' 카드 — 현재 베이스의 패턴·단계·피벗·피벗 대비 %·상태·깊이·길이 */
export function PatternSummary({ base, close, date }: { base: PatternBase; close: number | null; date: string | null }) {
  const pattern = patternLabel(base.patternType);
  const stage = stageText(base.stage, base.label);
  const status = breakoutText(base.isActive, base.daysSinceBreakout);
  const dist = pivotDistPct(close, base.pivot);
  const label = [
    `차트 패턴, ${pattern} ${stage}`,
    status,
    `피벗 ${formatIndex(base.pivot)}원`,
    dist !== null ? `피벗 대비 ${formatChg(dist)}` : '',
    `깊이 ${base.depth.toFixed(0)}%`,
    `길이 ${base.length}일`,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.card} accessible accessibilityLabel={label}>
      <Text style={styles.section}>차트 패턴</Text>
      <Text style={styles.title}>{pattern} · {stage} · {status}</Text>
      <View style={styles.grid}>
        <Cell k="피벗" v={`${formatIndex(base.pivot)}원`} />
        <Cell k="피벗 대비" v={dist !== null ? formatChg(dist) : '–'} />
        <Cell k="깊이" v={`${base.depth.toFixed(0)}%`} />
        <Cell k="길이" v={`${base.length}일`} />
      </View>
      <Text style={styles.note}>{date ? `${date} 종가 기준 · ` : ''}패턴 판정은 참고용이며 투자 권유가 아닙니다.</Text>
    </View>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  section: { fontSize: 16, fontWeight: '700', color: theme.colors.text },
  title: { fontSize: 14, fontWeight: '600', color: theme.colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: theme.gap(1) },
  cell: { width: '50%', gap: 2 },
  k: { fontSize: 12, color: theme.colors.textSecondary },
  v: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  note: { fontSize: 11, color: theme.colors.textSecondary },
}));
