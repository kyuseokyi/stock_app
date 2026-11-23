import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Card, formatPct } from '@/ui';

import type { EduLeaderboard, EduLeaderRow } from '../types';

const SHOW_TOP = 10;

/** 시즌 수익률 순위(상위 10명 + 내 순위). 불러오기 전·실패면 그리지 않는다 */
export function EduLeaderboardCard({ board }: { board: EduLeaderboard | null }) {
  if (!board) return null;
  const top = board.top.slice(0, SHOW_TOP);
  const mine = board.my_rank;
  const mineShown = mine !== null && top.some((r) => r.rank === mine.rank);
  return (
    <Card>
      <Text style={styles.title} accessibilityRole="header">🏆 시즌 수익률 순위</Text>
      {top.length === 0 ? <Text style={styles.empty}>아직 순위가 없어요. 첫 참가자가 되어 보세요!</Text> : null}
      {top.map((r) => (
        <Row key={r.rank} row={r} mine={mine !== null && r.rank === mine.rank} />
      ))}
      {mine !== null && !mineShown ? (
        <>
          <View style={styles.divider} />
          <Row row={mine} mine />
        </>
      ) : null}
    </Card>
  );
}

function Row({ row, mine }: { row: EduLeaderRow; mine: boolean }) {
  const tone = row.current_roi > 0 ? styles.up : row.current_roi < 0 ? styles.down : null;
  return (
    <View style={[styles.row, mine && styles.rowMine]}>
      <Text style={styles.rank}>{row.rank}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {mine ? '나' : (row.nickname ?? '익명')}
      </Text>
      <Text style={styles.days}>{row.participation_days}일</Text>
      <Text style={[styles.roi, tone]}>{formatPct(row.current_roi)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: { fontSize: 17, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(1) },
  empty: { fontSize: 14, color: theme.colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.gap(0.75),
    paddingHorizontal: theme.gap(1),
    borderRadius: theme.radius.input,
    gap: theme.gap(1),
  },
  rowMine: { backgroundColor: theme.colors.primarySoft },
  rank: { width: 24, fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary },
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.colors.text },
  days: { fontSize: 12, color: theme.colors.textSecondary },
  roi: { minWidth: 64, textAlign: 'right', fontSize: 14, fontWeight: '700', color: theme.colors.text },
  up: { color: theme.colors.up },
  down: { color: theme.colors.down },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.gap(0.5) },
}));
