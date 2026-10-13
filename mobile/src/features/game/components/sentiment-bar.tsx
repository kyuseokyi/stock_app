import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { Sentiment } from '../types';

/** 유저 베팅 심리(WS 5초 주기). 미수신이면 숨김, 0/0 이면 안내 문구 */
export function SentimentBar({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return null;
  const empty = sentiment.long_pct === 0 && sentiment.short_pct === 0;

  return (
    <View style={styles.box}>
      <Text style={styles.caption}>📊 유저 베팅 심리</Text>
      {empty ? (
        <Text style={styles.muted}>아직 포지션이 없어요</Text>
      ) : (
        <>
          <View style={styles.track}>
            <View style={[styles.long, { flex: sentiment.long_pct }]} />
            <View style={[styles.short, { flex: sentiment.short_pct }]} />
          </View>
          <View style={styles.labels}>
            <Text style={styles.longLabel}>🔴 Long {sentiment.long_pct}%</Text>
            <Text style={styles.shortLabel}>🔵 Short {sentiment.short_pct}%</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { backgroundColor: theme.colors.surfacePink, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  caption: { fontSize: 12, fontWeight: '500', color: theme.colors.textSecondary },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  track: {
    flexDirection: 'row',
    height: 10,
    borderRadius: theme.radius.chip,
    overflow: 'hidden',
    backgroundColor: theme.colors.border,
  },
  long: { backgroundColor: theme.colors.up },
  short: { backgroundColor: theme.colors.down },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  longLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.up },
  shortLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.down },
}));
