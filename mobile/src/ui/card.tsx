import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** surface 배경 카드. radius 20, padding gap(2). 강조 정보에만 사용. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.card,
    padding: theme.gap(2),
    gap: theme.gap(0.5),
  },
}));
