import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { BackupRisk } from '../backup-risk';
import { riskBannerText } from '../backup-text';

/** 백업 미연결·오래됨 경고 — 누르면 백업 화면. 위험할 때만 보이므로 닫기 버튼은 없다(2026-11-11 설계) */
export function BackupRiskBanner({
  risk,
  lastBackupAt,
  now,
  onPress,
}: {
  risk: BackupRisk;
  lastBackupAt: number | null;
  now: number;
  onPress: () => void;
}) {
  const t = riskBannerText(risk, lastBackupAt, now);
  if (!t) return null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${t.title}. ${t.body}`} style={styles.box}>
      <View style={styles.flex}>
        <Text style={styles.title}>{t.title}</Text>
        <Text style={styles.body}>{t.body}</Text>
      </View>
      <Text style={styles.go}>백업 ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1),
    backgroundColor: theme.colors.cautionSoft,
    borderRadius: theme.radius.card,
    padding: theme.gap(1.5),
  },
  flex: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '700', color: theme.colors.caution },
  body: { fontSize: 13, color: theme.colors.text },
  go: { fontSize: 14, fontWeight: '600', color: theme.colors.caution },
}));
