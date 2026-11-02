import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatShortDate } from '@/features/market/dashboard';
import type { MorningBrief } from '@/features/market/rest-types';

/** 홈 AI 브리핑 한 줄(surfaceBlue 배너) — 배지 + 헤드라인 최대 2줄. 자세한 내용은 마켓 탭에서 */
export function HomeBriefBanner({ brief, onPress }: { brief: MorningBrief; onPress: () => void }) {
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`AI 장전 브리핑 ${formatShortDate(brief.date)}, ${brief.headline}`}
      accessibilityHint="마켓 탭에서 보기"
    >
      <View style={styles.badgeRow}>
        <Text style={styles.badge}>AI 장전 브리핑</Text>
        {brief.date ? <Text style={styles.date}>{formatShortDate(brief.date)}</Text> : null}
      </View>
      <Text style={styles.headline} numberOfLines={2}>{brief.headline}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { backgroundColor: theme.colors.surfaceBlue, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  badge: {
    fontSize: 12, fontWeight: '700', color: theme.colors.primary, backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.chip, paddingHorizontal: theme.gap(1), paddingVertical: 3, overflow: 'hidden',
  },
  date: { fontSize: 12, color: theme.colors.textSecondary },
  headline: { fontSize: 16, fontWeight: '700', lineHeight: 23, color: theme.colors.text },
}));
