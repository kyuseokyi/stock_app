import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** 장 마감 후(KST 15:30~24:00)·주말 강조 배너 — 탭하면 야간 차트 퀴즈 시트 */
export function QuizBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.box, pressed && styles.pressed]}>
      <View style={styles.texts}>
        <Text style={styles.title}>🧩 야간 10초 차트 퀴즈 도전!</Text>
        <Text style={styles.sub}>차트만 보고 5일 뒤 방향을 맞혀 보세요</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.card,
    paddingVertical: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
  },
  pressed: { opacity: 0.85 },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },
  sub: { fontSize: 12, color: theme.colors.textSecondary },
  chevron: { fontSize: 20, color: theme.colors.primary },
}));
