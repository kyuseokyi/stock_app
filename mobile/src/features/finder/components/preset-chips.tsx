import { ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Chip } from '@/ui';

import { PRESETS } from '../finder';
import type { FinderPreset } from '../types';

/** 프리셋 칩 가로 스크롤(하나만 선택, 다시 누르면 해제) + 고른 프리셋 설명 한 줄 */
export function PresetChips({ value, onToggle }: { value: FinderPreset | null; onToggle: (p: FinderPreset) => void }) {
  const desc = PRESETS.find((p) => p.key === value)?.description ?? '프리셋을 고르거나 필터로 조건을 정해 보세요';
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {PRESETS.map((p) => (
          <Chip key={p.key} label={p.label} selected={value === p.key} onPress={() => onToggle(p.key)} />
        ))}
      </ScrollView>
      <Text style={styles.desc} numberOfLines={2}>{desc}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(0.75), paddingBottom: theme.gap(1) },
  chips: { gap: theme.gap(1), paddingHorizontal: theme.gap(2) },
  desc: { fontSize: 12, color: theme.colors.textSecondary, paddingHorizontal: theme.gap(2) },
}));
