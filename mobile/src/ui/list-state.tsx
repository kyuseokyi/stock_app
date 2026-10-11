import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button } from './button';

type Props =
  | { mode: 'loading' }
  | { mode: 'empty'; emoji?: string; title: string; hint?: string }
  | { mode: 'error'; title?: string; hint?: string; onRetry?: () => void };

/** 화면 중앙 상태 뷰. 토스식 구어체 기본 문구. */
export function ListState(props: Props) {
  return (
    <View style={styles.center}>
      {props.mode === 'loading' && (
        <>
          <ActivityIndicator />
          <Text style={styles.hint}>불러오고 있어요…</Text>
        </>
      )}
      {props.mode === 'empty' && (
        <>
          {props.emoji ? <Text style={styles.emoji}>{props.emoji}</Text> : null}
          <Text style={styles.title}>{props.title}</Text>
          {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
        </>
      )}
      {props.mode === 'error' && (
        <>
          <Text style={styles.title}>{props.title ?? '불러오지 못했어요'}</Text>
          {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
          {props.onRetry ? (
            <View style={styles.retry}>
              <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={props.onRetry} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.gap(1),
    padding: theme.gap(3),
    backgroundColor: theme.colors.background,
  },
  emoji: { fontSize: 40 },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text, textAlign: 'center' },
  hint: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  retry: { marginTop: theme.gap(1) },
}));
