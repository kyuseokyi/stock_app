import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { parseQuizMarkdown } from '../lib/quiz-markdown';

/** 퀴즈 해설 — ###/-/> 만 해석해 제목·목록·안내로 보여 준다(web QuizExplanation 과 같은 규칙) */
export function QuizExplanation({ markdown }: { markdown: string }) {
  return (
    <View style={styles.box}>
      {parseQuizMarkdown(markdown).map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return (
              <Text key={i} style={[styles.text, styles.heading]}>
                {b.text}
              </Text>
            );
          case 'item':
            return (
              <View key={i} style={styles.item}>
                <Text style={styles.bullet}>•</Text>
                <Text style={[styles.text, styles.flex]}>{b.text}</Text>
              </View>
            );
          case 'quote':
            return (
              <Text key={i} style={styles.quote}>
                {b.text}
              </Text>
            );
          default:
            return (
              <Text key={i} style={styles.text}>
                {b.text}
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    gap: theme.gap(0.75),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.input,
    padding: theme.gap(1.5),
  },
  flex: { flex: 1 },
  text: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  heading: { fontWeight: '700' },
  item: { flexDirection: 'row', gap: theme.gap(0.75) },
  bullet: { fontSize: 14, lineHeight: 21, color: theme.colors.textSecondary },
  quote: {
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
    paddingLeft: theme.gap(1),
  },
}));
