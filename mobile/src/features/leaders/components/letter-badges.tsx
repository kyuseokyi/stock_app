import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { LETTER_KEYS, LETTER_NAMES, letterStatusText, letterTone } from '../canslim';
import type { CanslimLetters, LetterKey, LetterStatus } from '../types';

type Size = 'sm' | 'lg';

/** C~M 배지 하나 — 통과=primary 바탕 흰 글자, 미달=fill 바탕, 부족·준비 중=점선 테두리 */
export function LetterBadge({ letter, status, size = 'sm' }: { letter: LetterKey; status: LetterStatus; size?: Size }) {
  const tone = letterTone(status);
  return (
    <View
      style={[styles.badge, styles[size], styles[tone]]}
      accessible
      accessibilityLabel={`${letter.toUpperCase()} ${LETTER_NAMES[letter]} ${letterStatusText(status)}`}
    >
      <Text style={[styles.text, styles[`${size}Text`], styles[`${tone}Text`]]} allowFontScaling={false}>
        {letter.toUpperCase()}
      </Text>
    </View>
  );
}

/** 목록 행의 배지 7개(C A N S L I M 순서) */
export function LetterBadges({ letters }: { letters: CanslimLetters }) {
  return (
    <View style={styles.row}>
      {LETTER_KEYS.map((k) => (
        <LetterBadge key={k} letter={k} status={letters[k]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', gap: 3 },
  badge: { alignItems: 'center', justifyContent: 'center' },
  sm: { width: 18, height: 18, borderRadius: 5 },
  lg: { width: 32, height: 32, borderRadius: 8 },
  text: { fontWeight: '800' },
  smText: { fontSize: 10 },
  lgText: { fontSize: 15 },
  pass: { backgroundColor: theme.colors.primary },
  fail: { backgroundColor: theme.colors.fill },
  none: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.textSecondary },
  passText: { color: theme.colors.onPrimary },
  failText: { color: theme.colors.textSecondary },
  noneText: { color: theme.colors.textSecondary },
}));
