import { Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { historyPoints } from '../canslim';
import type { CanslimHistoryPoint } from '../types';

/** 점수 추이(최근 거래일들) 미니 그래프 — 점 2개 미만이면 숨김 */
export function ScoreHistory({ history }: { history: CanslimHistoryPoint[] }) {
  const { theme } = useUnistyles();
  const points = historyPoints(history);
  if (!points) return null;
  const first = history[0];
  const last = history[history.length - 1];
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>점수 추이 · 최근 {history.length}거래일</Text>
        <Text style={styles.meta}>
          {first.score}점 → {last.score}점
        </Text>
      </View>
      <Svg
        width="100%"
        height={48}
        viewBox="0 0 240 40"
        preserveAspectRatio="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Polyline points={points} fill="none" stroke={theme.colors.primary} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <Text style={styles.meta}>
        {first.date} ~ {last.date}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.gap(1) },
  title: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
}));
