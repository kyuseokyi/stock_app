import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { sideLabel } from '../lib/side';
import type { Sentiment } from '../types';
import { useGameRules } from '../use-game-rules';


/** 유저 베팅 심리(WS 주기 갱신) — 상승/하락 인원 비율 + 보유 인원. 미수신이면 숨김, 0/0 이면 안내 문구 */
export function SentimentBar({ sentiment }: { sentiment: Sentiment | null }) {
  const { rules } = useGameRules();
  if (!sentiment) return null;
  // 갱신 주기는 규칙(/rules) 값 — 아직 못 받았으면 인원만 표시
  const interval = rules ? ` · ${rules.sentiment_interval_sec}초마다 갱신` : '';
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
            <Text style={styles.longLabel}>🔴 {sideLabel('LONG')} {sentiment.long_pct}%</Text>
            <Text style={styles.shortLabel}>🔵 {sideLabel('SHORT')} {sentiment.short_pct}%</Text>
          </View>
          {sentiment.total !== undefined && sentiment.total > 0 ? (
            <Text style={styles.meta}>보유 중 {sentiment.total}명 기준{interval}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
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
  meta: { fontSize: 12, color: theme.colors.textSecondary },
}));
