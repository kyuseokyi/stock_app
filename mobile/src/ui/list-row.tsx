import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

type Props = {
  title: string;
  subtitle?: string;
  left?: ReactNode; // 아이콘/이모지
  right?: ReactNode; // 값(없으면 chevron만)
  onPress?: () => void;
  disabled?: boolean; // "준비 중" 등 비활성
};

/** 제목+보조문구 좌측, 값+chevron 우측. 높이 ≥56, 구분선 대신 여백. */
export function ListRow({ title, subtitle, left, right, onPress, disabled = false }: Props) {
  const { theme } = useUnistyles();
  const Wrapper = onPress && !disabled ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress && !disabled ? onPress : undefined}
      style={[styles.row, disabled && styles.rowDisabled]}>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.right}>
        {right}
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    paddingVertical: theme.gap(1),
  },
  rowDisabled: { opacity: 0.4 },
  left: { width: 28, alignItems: 'center' },
  center: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  subtitle: { fontSize: 13, color: theme.colors.textSecondary },
  right: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.5) },
}));
