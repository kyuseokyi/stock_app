import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { Coach } from '../types';

/** 오늘의 코치 한 줄 요약. 본문(content_md)이 있으면 탭해서 제목·본문을 텍스트로 펼친다(마크다운 렌더 없음) */
export function CoachBanner({ coach }: { coach: Coach | null }) {
  const [open, setOpen] = useState(false);
  if (!coach) return null;
  const expandable = coach.content_md !== null && coach.content_md !== '';

  return (
    <View style={styles.box}>
      <Pressable
        onPress={() => {
          if (expandable) setOpen((o) => !o);
        }}
        disabled={!expandable}
        accessibilityState={expandable ? { expanded: open } : undefined}
        style={styles.row}>
        <Text style={styles.icon}>{coach.coach_type === 'EVENING' ? '🌙' : '🌅'}</Text>
        <Text style={styles.summary}>
          <Text style={styles.bold}>오늘의 코치</Text> “{coach.summary_nudge}”
        </Text>
        {expandable ? <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text> : null}
      </Pressable>
      {open && expandable ? (
        <View style={styles.body}>
          <Text style={styles.title}>{coach.title}</Text>
          <Text style={styles.content}>{coach.content_md}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { backgroundColor: theme.colors.surfaceBlue, borderRadius: theme.radius.card, padding: theme.gap(2) },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(1) },
  icon: { fontSize: 16 },
  summary: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.text },
  bold: { fontWeight: '700' },
  chevron: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 },
  body: {
    marginTop: theme.gap(1.5),
    paddingTop: theme.gap(1.5),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.gap(0.5),
  },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  content: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
}));
