import { Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
};

/** pill 칩. 선택 시 primarySoft 배경 + primary 글씨. 보드/비중/배율 선택에 사용. */
export function Chip({ label, selected = false, onPress }: Props) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.label, selected && styles.labelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    borderRadius: theme.radius.chip,
    paddingVertical: theme.gap(0.75),
    paddingHorizontal: theme.gap(1.5),
    backgroundColor: theme.colors.fill,
  },
  chipOn: { backgroundColor: theme.colors.primarySoft },
  label: { fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary },
  labelOn: { color: theme.colors.primary },
}));
