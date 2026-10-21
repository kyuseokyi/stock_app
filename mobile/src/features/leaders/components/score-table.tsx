import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { letterStatusText } from '../canslim';
import type { CanslimLetter } from '../types';
import { LetterBadge } from './letter-badges';

/** 7항목 점수표 — 배지·이름·상태 글자·근거(display)·설명·기준(threshold). 문구는 모두 서버 값 */
export function ScoreTable({ letters }: { letters: CanslimLetter[] }) {
  return (
    <View style={styles.list}>
      {letters.map((l) => (
        <View key={l.key} style={styles.row}>
          <LetterBadge letter={l.key} status={l.status} size="lg" />
          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={styles.label}>{l.label}</Text>
              <Text style={styles.status}>{letterStatusText(l.status)}</Text>
            </View>
            <Text style={styles.display}>{l.display}</Text>
            <Text style={styles.explain}>
              {l.explanation} 기준: {l.threshold}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { gap: theme.gap(1) },
  row: { flexDirection: 'row', gap: theme.gap(1.5), backgroundColor: theme.colors.fill, borderRadius: 14, padding: theme.gap(1.5) },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.gap(1) },
  label: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: theme.colors.text },
  status: { fontSize: 12, color: theme.colors.textSecondary },
  display: { fontSize: 14, color: theme.colors.text },
  explain: { fontSize: 12, color: theme.colors.textSecondary },
}));
